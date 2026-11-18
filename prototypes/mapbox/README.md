# Prototipo Mapbox GL JS — Dante Remises

Este prototipo está aislado de la aplicación y parte de `main` (commit `190c11f6a4d28a4e6db30217f43070b2bb5e2a60`). No sustituye Leaflet ni modifica los flujos de pasajeros, choferes, Firebase o chat.

## Objetivo de esta etapa

Comprobar únicamente el renderizado vectorial de Mapbox GL JS y el soporte WebGL2 en navegador. El mapa se centra en Santa Rosa de Calamuchita. No incorpora búsqueda de direcciones, geocodificación, rutas, tráfico ni seguimiento GPS.

## Uso

1. Abrir `index.html` desde un servidor HTTP/HTTPS de prueba.
2. Pegar un token público de Mapbox que comience con `pk.`.
3. Pulsar una sola vez **Cargar mapa**.
4. Probar zoom, desplazamiento y controles táctiles.
5. Copiar el bloque de diagnóstico para comparar dispositivos.
6. Cerrar el mapa al terminar. No repetir inicializaciones innecesariamente: cada instancia Mapbox GL JS cuenta como una carga.

No usar nunca un token secreto `sk.` en el cliente. El token ingresado se mantiene en memoria y no se guarda localmente.

## Restricciones económicas conocidas

- Mapbox no ofrece un tope duro de gasto mensual.
- Las alertas de uso no detienen el servicio.
- Al superar el tramo gratuito, el excedente se factura automáticamente al medio de pago registrado.
- No habilitar una cuenta con tarjeta para uso real hasta resolver un control externo de cuota y el mecanismo de corte.
- No confundir token público con token secreto: el público es visible en el navegador y debe restringirse por origen cuando el entorno final esté definido.

## Próximas etapas, todavía no incluidas

- Probar en ZTE Blade V50 Design (Android 13), S17 Pro (Android 14) y Moto G20 (Android 11).
- Evaluar el WebView de Capacitor, no sólo Chrome.
- Mantener LocationIQ u otro proveedor para búsqueda de direcciones hasta resolver cobertura argentina y persistencia.
- Evaluar Directions API por separado.
