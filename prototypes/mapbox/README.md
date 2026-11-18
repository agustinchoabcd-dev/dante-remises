# Migración cartográfica — Dante Remises

Esta rama integra la primera capa de migración dentro de la aplicación real, sin modificar `main`, producción, Firebase, Cloudflare Worker ni la PR #12.

## Qué está integrado

- Mapbox GL JS fijado en la versión 3.35.0 para renderizado vectorial.
- Adaptador común en `js/dante-map.js` para inicialización, eventos de toque, marcadores, marcador GPS, rutas GeoJSON, encuadre, resize y destrucción.
- Leaflet 1.9.4 + tiles LocationIQ como fallback cuando no hay token Mapbox, no carga GL JS o WebGL no es compatible.
- Mapbox Directions con el perfil `mapbox/driving` es ahora el único motor de rutas. Si falta el token o falla la API, la aplicación informa que no pudo calcular la ruta; no consume LocationIQ como respaldo.
- Geoapify se encarga de autocomplete y geocodificación inversa en Argentina, con sesgo de búsqueda hacia Santa Rosa de Calamuchita.
- Los puntos elegidos por toque o GPS reciben una dirección legible por geocodificación inversa; nunca se muestran coordenadas como texto de dirección.
- LocationIQ queda sólo como proveedor de tiles para el fallback Leaflet mientras se verifica WebGL2.
- Las vistas de pasajero y chofer usan el mismo adaptador. No se cambió el esquema de viajes ni Firebase.
- El cálculo de ruta del pasajero descarta respuestas antiguas si el usuario cambia origen/destino mientras la solicitud está en curso.

## Configuración del token público

El token público `pk.` se inyecta mediante `window.DANTE_MAPBOX_TOKEN` en `js/mapbox-config.js` durante el build experimental de Android. El archivo versionado permanece vacío por defecto. Los workflows de APK y de Cloudflare Pages staging requieren los secretos de repositorio `MAPBOX_PUBLIC_TOKEN` y `GEOAPIFY_API_KEY`; los inyectan durante el build, no los imprimen ni los guardan en Git. El paso de copia de Capacitor incluye `js/dante-map.js` y `js/mapbox-config.js` dentro de `www/js/`. La vista web experimental se publica como preview aislado en el proyecto Pages `dante-remises-staging`, usando el nombre de rama `mapbox-migration-prototype`; no apunta a producción.

GitHub Secret Scanning rechazó el token público facilitado para la prueba al clasificarlo como `MAPBOX_SECRET_ACCESS_TOKEN`. No se eludió ese control ni se incluyó el token en el código. El mecanismo de inyección quedó implementado, pero todavía requiere que exista el secreto `MAPBOX_PUBLIC_TOKEN` en Settings → Secrets and variables → Actions. Sin esos secretos, el build experimental se detiene antes de empaquetar la APK. El fallback Leaflet/LocationIQ se conserva temporalmente sólo para no romper dispositivos hasta verificar WebGL2 en los teléfonos reales.

No hace falta vincular una tarjeta para la etapa de desarrollo con el acceso demo de Mapbox. No se habilitó facturación.

## CI y pruebas

El workflow ejecuta comprobaciones de sintaxis de los adaptadores y pruebas estructurales para verificar:
- CDN Mapbox fijado y Leaflet disponible como alternativa.
- Uso del adaptador en los mapas de pasajero y chofer.
- Uso exclusivo de Mapbox Directions para rutas.
- Inclusión de los módulos cartográficos en el paquete web de Capacitor.
- Configuración externa de las claves Mapbox y Geoapify sin incluirlas en el repositorio.
- Uso de Geoapify para búsqueda y geocodificación inversa; no se usa LocationIQ para guardar nuevas etiquetas de direcciones.

Estas pruebas son estructurales. No prueban el renderizado WebGL real ni sustituyen las pruebas en navegador y APK.

## Pendiente

1. Configurar `MAPBOX_PUBLIC_TOKEN` y `GEOAPIFY_API_KEY` en GitHub Actions Secrets sin habilitar facturación.
2. Ejecutar una prueba real de GL JS en Chrome.
3. Generar APK y validar WebView en ZTE Blade V50 Design (Android 13), S17 Pro (Android 14) y Moto G20 (Android 11).
4. Revisar rendimiento, memoria, rotación, segundo plano, atribución y comportamiento sin conexión.
5. Confirmar la política de retención de los resultados del geocoder antes de modificar su uso o persistencia.
6. Mantener la rama experimental sin merge hasta la aprobación explícita de Agustín.
7. Validar la calidad real de Geoapify en direcciones de Santa Rosa de Calamuchita y localidades cercanas; su cobertura local debe probarse.
