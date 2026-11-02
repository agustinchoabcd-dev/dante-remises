# Compilación Android

La APK de depuración se genera automáticamente mediante GitHub Actions.

## Disparadores

- Cada `push` a las ramas `android-capacitor`, `android-photo-test`, `fix/passenger-onboarding-trip-diagnostics` y `fix/passenger-onboarding-camera-flow` ejecuta `.github/workflows/android-apk.yml`.
- El workflow también admite `workflow_dispatch` desde la interfaz de GitHub Actions.

## Artefacto

Cuando el job **Build debug APK** termina correctamente, publica el artefacto `dante-remises-debug-apk` durante 14 días. Dentro del ZIP se encuentra `app-debug.apk`.

## Alcance

Es una compilación `debug` para instalación y pruebas. No es una APK firmada de publicación para Play Store. La compilación exitosa no reemplaza las pruebas en un dispositivo Android real.

## Diagnóstico

Si la ejecución falla, revisar el primer paso fallido en los logs del job antes de modificar código o configuración. No cambiar Firebase Rules para resolver fallos de compilación.
