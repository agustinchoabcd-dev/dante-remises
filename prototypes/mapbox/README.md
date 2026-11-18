# Migración cartográfica — Dante Remises

Esta rama integra la primera capa de migración dentro de la aplicación real, sin modificar `main`, producción, Firebase, Cloudflare Worker ni la PR #12.

## Qué está integrado

- Mapbox GL JS fijado en la versión 3.35.0 para renderizado vectorial.
- Adaptador común en `js/dante-map.js` para inicialización, eventos de toque, marcadores, marcador GPS, rutas GeoJSON, encuadre, resize y destrucción.
- Leaflet 1.9.4 + tiles LocationIQ como fallback cuando no hay token Mapbox, no carga GL JS o WebGL no es compatible.
- Mapbox Directions con el perfil `mapbox/driving`; si la llamada falla o el token no está configurado, el adaptador recurre al endpoint Directions actual de LocationIQ.
- LocationIQ sigue a cargo de autocomplete y reverse geocoding para Argentina.
- Las vistas de pasajero y chofer usan el mismo adaptador. No se cambió el esquema de viajes ni Firebase.
- El cálculo de ruta del pasajero descarta respuestas antiguas si el usuario cambia origen/destino mientras la solicitud está en curso.

## Configuración del token público

El token `pk.` se inyecta mediante `window.DANTE_MAPBOX_TOKEN` desde `js/mapbox-config.js`. El archivo está vacío por defecto para no incluir credenciales en el repositorio.

GitHub Secret Scanning rechazó el token público facilitado para la prueba al clasificarlo como `MAPBOX_SECRET_ACCESS_TOKEN`. No se eludió ese control ni se incluyó el token en el código. Para activar el backend Mapbox, el token público debe incorporarse por un mecanismo de configuración de despliegue fuera del código versionado. Mientras tanto, la aplicación sigue funcionando con Leaflet/LocationIQ.

No hace falta vincular una tarjeta para la etapa de desarrollo con el acceso demo de Mapbox. No se habilitó facturación.

## CI y pruebas

El workflow ejecuta comprobaciones de sintaxis de los adaptadores y pruebas estructurales para verificar:
- CDN Mapbox fijado y Leaflet disponible como alternativa.
- Uso del adaptador en los mapas de pasajero y chofer.
- Selección de Mapbox Directions y fallback LocationIQ.
- Inyección externa del token sin incluirlo en el repositorio.

Estas pruebas son estructurales. No prueban el renderizado WebGL real ni sustituyen las pruebas en navegador y APK.

## Pendiente

1. Configurar el token público mediante un mecanismo de despliegue seguro que no lo escriba en el repositorio.
2. Ejecutar una prueba real de GL JS en Chrome.
3. Generar APK y validar WebView en ZTE Blade V50 Design (Android 13), S17 Pro (Android 14) y Moto G20 (Android 11).
4. Revisar rendimiento, memoria, rotación, segundo plano, atribución y comportamiento sin conexión.
5. Confirmar la política de retención de los resultados del geocoder antes de modificar su uso o persistencia.
6. Mantener la rama experimental sin merge hasta la aprobación explícita de Agustín.
