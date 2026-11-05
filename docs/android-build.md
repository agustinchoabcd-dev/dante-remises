# Compilación Android

La APK de depuración se genera automáticamente mediante GitHub Actions.

## Disparadores

- Cada `push` a las ramas `android-capacitor`, `android-photo-test`, `fix/passenger-onboarding-trip-diagnostics`, `fix/passenger-onboarding-camera-flow` y `dante-test` ejecuta `.github/workflows/android-apk.yml`.
- El workflow también admite `workflow_dispatch` desde la interfaz de GitHub Actions.

## Firma de depuración persistente

Para que las APK sucesivas puedan instalarse como actualizaciones entre sí, el repositorio debe tener configurado el secret de Actions `DANTE_DEBUG_KEYSTORE_BASE64`.

- El valor es el contenido Base64 completo del keystore privado. No debe publicarse, versionarse ni incluirse en documentación.
- El workflow restaura el keystore en el runner, valida el alias `androiddebugkey` y registra la huella SHA-256 del certificado en el resumen de la ejecución.
- Huella esperada del certificado persistente: `79:38:11:E8:65:54:28:3D:1D:02:B4:8A:29:DE:00:14:1C:21:34:7E:78:EB:0E:08:AE:79:E3:9D:F9:A3:38:4C`.
- Si falta el secret o no puede validarse, la compilación falla en vez de generar una APK con una clave efímera.

Las APK históricas generadas antes de esta configuración pueden tener otra firma. Si el certificado de la APK instalada no coincide con el persistente, Android exige desinstalar esa versión una sola vez antes de instalar la primera APK con la nueva firma. Las APK posteriores firmadas con el mismo certificado podrán instalarse encima.

## Artefacto

Cuando el job **Build debug APK** termina correctamente, publica el artefacto `dante-remises-debug-apk` durante 14 días. Dentro del ZIP se encuentra `app-debug.apk`.

## Alcance

Es una compilación `debug` para instalación y pruebas. No es una APK firmada de publicación para Play Store. La compilación exitosa no reemplaza las pruebas en un dispositivo Android real.

## Diagnóstico

Si la ejecución falla, revisar el primer paso fallido en los logs del job antes de modificar código o configuración. No cambiar Firebase Rules para resolver fallos de compilación.
