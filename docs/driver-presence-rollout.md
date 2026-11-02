# Presencia en línea de choferes — preparación

## Objetivo
Distinguir disponibilidad operativa (Libre/Ocupado/Fuera de servicio) de conexión real del chofer.

## Implementación en esta rama
- Cada chofer registra `driverPresence/{carId}` al iniciar sesión.
- La presencia incluye UID, `connected: true` y fecha de conexión.
- Se programa `onDisconnect().remove()` y se elimina la presencia al cerrar sesión.
- El pasajero solo puede elegir coches cuya presencia corresponda al UID asignado y cuyo estado remoto sea `libre`.
- La selección aleatoria y la lectura de ubicación en vivo también requieren conexión.
- La solicitud consulta estado y presencia en Firebase antes de escribir el viaje.
- Las reglas finales preparadas exigen presencia válida al crear viajes y al leer/escribir ubicación pública.

## Despliegue por etapas
1. **Etapa de compatibilidad:** agregar permisos mínimos para el nodo `driverPresence`, sin cambiar todavía la autorización de creación de viajes ni las reglas actuales de ubicación. Esta etapa permite probar el cliente nuevo sin bloquear las versiones anteriores.
2. **Etapa de enforcement:** aplicar las reglas estrictas de presencia cuando la versión nueva esté instalada y probada en los dispositivos que usan los choferes.

## Estado
- Código preparado en `feature/driver-presence`.
- Reglas estrictas preparadas en `feature/driver-presence-rules`.
- Etapa de compatibilidad desplegada mediante GitHub Actions; verificar el resultado final de la ejecución antes de declarar el despliegue confirmado.
- No se integró el código a `main`.
- No se probó todavía en navegador ni en dispositivo físico.
