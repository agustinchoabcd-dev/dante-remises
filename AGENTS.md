# Dante Remises — instrucciones para agentes

Estas instrucciones aplican a cualquier agente que trabaje en este repositorio.

## Procedimiento obligatorio

1. Al iniciar una sesión, consultar las Skills habilitadas de Notion y cargar la Skill **Desarrollo y continuidad de Dante Remises**:
   https://app.notion.com/p/40e06849ff6b811abc4ae6d68686023b
2. Leer el punto de continuidad:
   https://app.notion.com/p/40e06849ff6b81a99d5cd2f2ad20e63e
3. Verificar GitHub en vivo. No confiar en SHAs, permisos ni estados históricos escritos en Notion.
4. Si la tarea continúa un trabajo previo, recuperar los resúmenes/conversaciones disponibles y consultar las páginas de Notion pertinentes antes de pedir datos al usuario.

Si Notion MCP no está disponible, no fingir que se cargó la Skill: seguir las reglas de este archivo y dejar constancia de la limitación.

## Repositorios y ramas

- Este repositorio `agustinchoabcd-dev/dante-remises` contiene el cliente web/Android.
- `dante-test` es la única rama aprobada para desarrollo, integración y pruebas del cliente.
- `main` es estable. No editarla, fusionar cambios ni desplegar sin autorización explícita.
- El backend, Firebase Rules, Workers y automatizaciones pertenecen a `agustinchoabcd-dev/dante-remises-private`; no duplicar backend ni secretos aquí.
- No reactivar ramas históricas ni crear ramas paralelas sin justificación y decisión documentada.

## Edición directa por GitHub

- Leer primero la rama, HEAD, archivo y blob SHA actuales.
- Para un archivo existente, usar la operación de actualización con su SHA actual y rama explícita. Para un archivo nuevo, usar creación de archivo.
- No concluir que GitHub carece de permisos por un fallo aislado. Consultar metadata/permisos y leer el error literal.
- No repetir una operación idéntica después de un error. Diagnosticarlo, corregir la condición y limitar los reintentos; si Contents API falla por su endpoint, evaluar Git Data API con commit padre y actualización de referencia protegida por expected SHA, nunca force.
- Después de escribir, verificar commit, diff, archivo y HEAD. Ejecutar sólo pruebas relevantes y asociar resultados al SHA exacto.
- Si una operación falla dos veces por la misma vía sin nueva evidencia, detenerse y reportar el error concreto en lugar de entrar en un bucle.

## Seguridad y alcance

- Las modificaciones ordinarias y reversibles en `dante-test` están autorizadas por el responsable del proyecto.
- No fusionar a `main`, desplegar, modificar servicios reales, Firebase Rules, Workers activos, secretos, permisos, CORS, buckets, Cron, roles, migraciones ni borrar datos sin autorización específica.
- No eliminar ni simplificar funciones existentes sin analizar dependencias y efectos secundarios.
- Mantener el proyecto gratuito y sin tarjeta; no habilitar facturación ni servicios pagos.

## Evidencia y continuidad

Distinguir siempre lectura estática, tests con mocks, emulador, CI, navegador, APK compilada, instalación, prueba física y producción. Un commit o CI verde no demuestra por sí solo funcionamiento real.

Al cerrar un hito, actualizar Notion con repo, rama, SHA, archivos, pruebas, evidencia, límites y siguiente paso. GitHub es la fuente de verdad del código; Notion conserva decisiones y continuidad; Dropbox sólo artefactos y respaldos auxiliares. No declarar acciones completadas sin evidencia.
