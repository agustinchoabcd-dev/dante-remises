# Dante Remises — chat Worker candidate

**Estado: candidato aislado; no desplegado ni integrado en el Worker activo.**

Este directorio contiene el módulo de mensajería de texto y sus pruebas. Está versionado en `dante-test`; no forma parte de `index.html`, no cambia GitHub Pages y no despliega infraestructura.

La política CORS admite el origen heredado `APP_ORIGIN` y una lista opcional separada por comas en `APP_ORIGINS`. Para el Android actual con Capacitor 8, el origen local predeterminado es `https://localhost`; debe incluirse explícitamente en `APP_ORIGINS` al configurar el Worker de pruebas. No se usa comodín y las rutas siguen exigiendo Firebase ID token.

## Funciones implementadas

- Los bloques nacen `pending`, sin reloj de retención. El primer mensaje persistido activa el bloque.
- Retención: 24 horas desde el primer mensaje aceptado y 14 días adicionales.
- Reintentos idempotentes mediante `clientMessageId` y escrituras condicionales ETag/If-Match.
- Administrador único puede usar el chat contextual de viaje como chofer del coche 144 conservando `role: admin`.
- Paginación cronológica con cursor en conversaciones e historial de mensajes; cada página devuelve hasta 100 elementos.
- Índices temporales separados por usuario, operador, administrador, conversación y bloque de mensajes.
- Limpieza de bloques vencidos elimina también mensajes, recibos de idempotencia e índices cronológicos asociados.
- Si la última vista previa pertenece al bloque vencido, la limpieza la borra mediante actualización ETag; conserva la vista previa si pertenece a un bloque posterior.
- La lista de conversaciones elimina índices cronológicos obsoletos cuando detecta que ya no apuntan a la versión vigente.
- La limpieza descarta índices de expiración malformados o inconsistentes para que no bloqueen los registros válidos que siguen en la cola.
- Rate limiting por UID, con contadores ETag para controlar concurrencia.

## Límites actuales

| Operación | Límite |
|---|---:|
| Envío de mensajes | 8 cada 10 segundos por UID |
| Crear conversaciones | 5 por minuto por UID |
| Listar conversaciones | 60 por minuto por UID |
| Leer historial | 60 por minuto por UID |

Al exceder un límite, el Worker devuelve HTTP `429` y `Retry-After`; CORS expone ese encabezado para que el cliente web pueda leerlo. Los contadores se guardan en RTDB y se sobrescriben al cambiar la ventana; no crean un registro nuevo por cada intervalo. Este mecanismo es global por UID gracias a ETag/If-Match, pero añade una lectura y una escritura por comprobación. No limita por IP y debe medirse en el entorno de pruebas antes de producción.

## Contrato de paginación

- `GET /v1/chat/conversations?cursor=<nextCursor>`
- `GET /v1/chat/messages?conversationId=<id>&cursor=<nextCursor>`

Las respuestas conservan las propiedades `conversations` o `messages` y agregan `nextCursor` y `hasMore`. La primera página omite `cursor`. El cliente debe reenviar el cursor recibido sin modificarlo.

Los índices temporales nuevos son `userConversationTimeline`, `operatorTimeline`, `adminTimeline`, `messageTimeline` y `messageTimelineByBlock`. Los registros anteriores a esta versión necesitarían backfill si hubiera conversaciones persistentes reales; no se debe asumir que ya están indexados.

## Pruebas

```sh
node --check chat-worker/chat-module-candidate-dynamic.js
node --test chat-worker/chat-module-candidate-dynamic.test.mjs
```

El workflow `.github/workflows/chat-candidate-tests.yml` ejecuta las pruebas en GitHub Actions. La última ejecución verificada contiene 38 pruebas aprobadas y 0 fallidas: https://github.com/agustinchoabcd-dev/dante-remises/actions/runs/41590243335. Incluye CORS para Android y limpieza condicional de vistas previas con protección ETag.

Las pruebas usan mocks de Firebase RTDB/JWT. No prueban Firebase real, Rules desplegadas, Cloudflare, B2, FCM ni dispositivos Android.

## Pendientes antes de integración

- Probar los cursores e incrementos ETag contra Firebase Emulator Suite o un proyecto de pruebas.
- Preparar backfill de índices si se confirma que hay conversaciones persistentes anteriores.
- Evaluar límites por IP/abuso distribuido y costo de las comprobaciones en RTDB.
- Probar fallos y reintentos del Cron de limpieza contra Firebase Emulator Suite o un proyecto aislado.
- Integrar el router en el Worker vigente sólo después de inspeccionar su código actual y obtener autorización expresa.

## Auditoría de integración con el Worker B2 existente

Se localizó en los archivos aportados por el usuario una copia de 1.147 líneas del Worker de prueba `dante-remises-b2-test`. Incluye las rutas `/test/*`, `/health` y `/v1/profile-photo/*`, la autenticación de pasajeros y la integración B2. Es una copia proporcionada por el usuario; todavía no se verificó que coincida byte por byte con la versión desplegada actualmente en Cloudflare.

Hallazgos de integración:
- El Worker B2 existente resuelve `OPTIONS` globalmente antes del enrutamiento. El router de chat debe ejecutarse antes de esa respuesta genérica para aplicar su allowlist CORS propia a `/v1/chat/*`.
- El Worker B2 y el módulo de chat declaran helpers Firebase con nombres coincidentes (`verifyFirebaseIdToken`, `getFirebasePublicKeys`, `decodeJson`, `base64UrlToBytes`, `base64UrlEncode`) y la constante `FIREBASE_JWKS_URL`. Antes de unirlos hay que reutilizar o renombrar esas funciones; concatenar ambos archivos produciría declaraciones duplicadas.
- El módulo de chat necesita exportar el handler programado `scheduled`; la copia B2 recuperada no contiene un handler Cron. La configuración de un Cron Trigger será un paso separado y no se hará durante la integración de código.
- El chat requiere `FIREBASE_SERVICE_ACCOUNT_EMAIL`, `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` y `ADMIN_UID`, además de los datos de Firebase existentes. No se copiaron secretos ni se modificó configuración de Cloudflare.

### Bloqueador de compatibilidad de perfiles

La versión actual de `index.html` en `main` y `dante-test` todavía declara el personal en `USER_ROLES` (UID → rol/nombre/coche). En `onAuthStateChanged`, primero consulta ese mapa y sólo lee `profiles/{uid}` cuando el UID no aparece allí. El registro normal crea perfiles de pasajeros con `role: passenger`; no se observó una migración de los perfiles de choferes, operadores y administrador al esquema dinámico que espera el Worker.

Las Rules actuales también limitan la validación de `profiles/{uid}/role` a pasajero o administrador y mantienen autorizaciones de coches/viajes mediante UID fijos. Por tanto, el Worker de chat basado en perfiles dinámicos no es todavía compatible con el conjunto actual de cuentas y reglas sin una migración coordinada.

**Orden obligatorio antes de conectar el frontend al chat:**
1. Diseñar y probar la migración de perfiles de personal a `profiles/{uid}` con `role`, `active` y `carId` cuando corresponda.
2. Adaptar autenticación/UI para que los perfiles sean la fuente de verdad, preservando temporalmente el acceso del personal actual.
3. Preparar Rules que permitan al administrador gestionar roles y asignaciones, sin permitir autoelevación ni lectura global de datos privados.
4. Alinear las asignaciones de coche y la autorización de viajes entre perfiles, aplicación y Rules.
5. Ejecutar pruebas de regresión para pasajero, chofer, operador y administrador en un entorno Firebase aislado.
6. Recién entonces unir el router de chat con el Worker B2, preservando las rutas existentes y validando el Cron.
