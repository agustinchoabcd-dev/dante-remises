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

El workflow `.github/workflows/chat-candidate-tests.yml` ejecuta las pruebas en GitHub Actions. La última ejecución verificada contiene **35 pruebas aprobadas y 0 fallidas**: [GitHub Actions](https://github.com/agustinchoabcd-dev/dante-remises/actions/runs/41589983357). La prueba cubre preflight y respuesta autenticada desde el origen Android de Capacitor.

Las pruebas usan mocks de Firebase RTDB/JWT. No prueban Firebase real, Rules desplegadas, Cloudflare, B2, FCM ni dispositivos Android.

## Pendientes antes de integración

- Probar los cursores e incrementos ETag contra Firebase Emulator Suite o un proyecto de pruebas.
- Preparar backfill de índices si se confirma que hay conversaciones persistentes anteriores.
- Evaluar límites por IP/abuso distribuido y costo de las comprobaciones en RTDB.
- Probar fallos y reintentos del Cron de limpieza contra Firebase Emulator Suite o un proyecto aislado.
- Integrar el router en el Worker vigente sólo después de inspeccionar su código actual y obtener autorización expresa.
