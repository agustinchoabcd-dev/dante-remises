# Dante Remises — chat Worker candidate

**Estado: candidato aislado; no desplegado ni integrado en el Worker activo.**

Este directorio contiene el módulo de mensajería de texto y sus pruebas automatizadas. Se guarda en `dante-test` para versionar el trabajo y ejecutar CI, pero no forma parte de `index.html`, no cambia GitHub Pages y no despliega infraestructura.

## Cambios incluidos

- Los bloques nacen como `pending`, sin `startedAt`, `closesAt` ni `deleteAt`.
- El primer mensaje que queda persistido activa el bloque. La retención se calcula desde el `createdAt` del primer mensaje aceptado.
- Los reintentos usan `clientMessageId` estable. Reutilizarlo con contenido distinto devuelve conflicto.
- La reserva de bloques y de identificadores de mensaje usa ETags/If-Match; los mensajes y su recibo de idempotencia se guardan mediante una actualización multipath.
- El UID raíz de administración puede iniciar chat contextual de viaje como chofer únicamente para el coche 144, manteniendo `role: admin`.

## Contrato nuevo de envío

`POST /v1/chat/messages` requiere:

```json
{
  "conversationId": "c_...",
  "clientMessageId": "id-estable-generado-por-el-cliente",
  "text": "Mensaje"
}
```

El cliente debe generar `clientMessageId` una sola vez por mensaje lógico y reutilizarlo en cada reintento. No debe generar un ID nuevo al reintentar la misma operación.

## Pruebas

Ejecutar:

```sh
node --check chat-worker/chat-module-candidate-dynamic.js
node --test chat-worker/chat-module-candidate-dynamic.test.mjs
```

El workflow `.github/workflows/chat-candidate-tests.yml` ejecuta ambos comandos en GitHub Actions al cambiar este directorio en `dante-test`.

Las pruebas usan Firebase/Google simulados; **no prueban Firebase real, reglas desplegadas, Cloudflare, B2 ni dispositivos Android**.

## Pendientes antes de integración

- Ejecutar y revisar todas las pruebas CI.
- Probar recuperación ante caída entre persistencia del mensaje y activación del bloque.
- Revisar el índice/paginación cronológica y límites antiabuso.
- Añadir pruebas de cierre exacto al límite de 24 horas y limpieza a los 14 días.
- Revisar migración de conversaciones/índices previos.
- Integrar el router en el Worker vigente solo después de obtener su código actual y autorización explícita.
