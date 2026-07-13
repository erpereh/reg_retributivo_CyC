# Asistente Retributivo — guía operativa

## Arquitectura y fronteras

El análisis retributivo conserva su flujo y su `AnalysisResult`. El Asistente es una proyección posterior e independiente: el cliente extrae, identifica información sensible, anonimiza, comprueba, fragmenta, indexa y persiste. Un fallo de ingestión deja el contexto en estado parcial o de error, pero no revierte el análisis.

El navegador gestiona conversaciones, mensajes, herramientas locales, búsqueda, presupuesto y la base `retributivo-assistant-v1`. Las rutas internas se limitan a `/api/assistant/models` y `/api/assistant/chat`; reciben únicamente preguntas y contexto sanitizados. Ningún documento original se envía a un proveedor, se registra o se conserva en el servidor. Las herramientas leen cifras ya calculadas por el dominio y no vuelven a implementar fórmulas retributivas.

## Variables y proveedores

Las credenciales configuradas son variables exclusivas del servidor: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY` y `GROQ_API_KEY`. `GEMINI_MODEL` y `ENABLE_AI_REVIEW` mantienen la integración histórica. Los archivos de entorno del repositorio contienen solo nombres, nunca valores.

Un endpoint OpenAI-compatible manual usa una clave efímera guardada en una clausura del cliente. No se incluye en estado React serializable, IndexedDB, Web Storage, URL, caché, trazas o errores; se pierde al recargar. La ruta la mantiene únicamente en una variable local durante la petición.

`ASSISTANT_E2E_MODE=1` está reservado al servidor de desarrollo o test que ejecuta Playwright. Activa un adaptador determinista sin red ni claves reales únicamente cuando `NODE_ENV` es `development` o `test`; en producción falla cerrado aunque la variable esté presente. Cualquier otro valor conserva los adaptadores de producción. No debe configurarse en un despliegue real.

## Persistencia local y migraciones

La base IndexedDB está en versión 4 y contiene stores separados para conversaciones, mensajes, eventos, acciones, fuentes, documentos, chunks, términos, snapshots, caché, versiones, jobs, perfiles y ajustes. Los repositorios aíslan el dominio para permitir otra implementación futura. Las migraciones son aditivas, crean stores e índices faltantes y cierran conexiones ante `versionchange`.

IndexedDB no es almacenamiento cifrado ni una frontera de seguridad. La interfaz muestra literalmente:

> Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador. Cualquier persona con acceso al perfil del navegador podría acceder a estos datos.

Por ello, la auditoría recursiva de privacidad se ejecuta antes de cada escritura incluso cuando el contenido nunca sale del dispositivo. No se usa `localStorage` como fallback.

## Privacidad y fuentes

El orden no intercambiable es extracción → identificación → anonimización → comprobación → fragmentación → indexación → transacción. Los nombres locales de archivo existen solo para mostrar al usuario; proveedor, corpus, hashes y cachés reciben etiquetas de fuente sanitizadas. Los snippets se derivan del texto ya anonimizado. Se bloquean NIF/NIE, IBAN, Seguridad Social, teléfonos, correos, cuentas, rutas, autoría y metadata original.

Las fuentes `available` pueden participar en recuperación. Al conservar una conversación de un análisis eliminado, la evidencia citada pasa a `historical_unavailable`, queda solo para lectura y no permite búsqueda o navegación. Una fuente `deleted` tampoco se recupera. Los documentos generales pertenecen a una conversación; `copy_document_context` exige destino explícito, remapea IDs y vuelve a auditar únicamente el corpus sanitizado.

## Acciones, versiones y limpieza

Las acciones son una unión estructurada validada con Zod. Solo la allowlist local puede navegar, asociar personas, mostrar comparaciones y timelines, crear conversaciones o copiar contexto. La aceptación se resuelve con compare-and-set transaccional para impedir efectos duplicados.

`analysisVersion` es SHA-256 de una representación canónica sanitizada con claves ordenadas y números normalizados. Los snapshots preservan el linaje de mensajes anteriores y permiten avisar de cambios sin reescribir la conversación.

Los cleanup jobs son idempotentes y reanudables: `pending → running → completed|failed`, con etapas `pending → assistant_cleaned → functional_deleted`. En borrado total se elimina el corpus en cascada. En conservación se mantienen mensajes, eventos, acciones y evidencia citada; la conversación pasa a solo lectura y se eliminan documentos, chunks, términos, caché y snapshots. Los jobs pendientes, en curso o fallidos se reanudan al inicializar. Un error público es sanitizado; para recuperar, se vuelve a ejecutar la operación desde Historial sin editar directamente IndexedDB.

## Verificación y rendimiento

La suite E2E usa únicamente Chromium. Cubre persistencia, conversación, streaming simulado, recarga, regeneración, teclado, drawers, foco, movimiento reducido y la advertencia local. El fixture de rendimiento contiene 5.200 chunks sanitizados; se descarta un calentamiento y se registran cinco ejecuciones, mediana, p95 y tareas largas. `DirectIndexExecutor` sigue siendo la implementación predeterminada. Solo se justifica un Worker si una medición de navegador demuestra una tarea principal superior a 50 ms o pérdida de respuesta por encima de 5.000 chunks.

Dependencia de pruebas añadida: `@playwright/test@1.61.1`, exacta y solo de desarrollo. No entra en el bundle del navegador; aporta runner, aserciones y control Chromium. No había runner E2E equivalente en el proyecto.

## Limitaciones

- La búsqueda es léxica local; no hay embeddings, OCR ni almacenamiento externos.
- La calidad de respuestas reales depende del proveedor y de la ventana comprobada.
- La compatibilidad manual no garantiza herramientas, streaming o salida estructurada.
- Borrar datos del navegador, usar navegación privada o cambiar de perfil elimina o aísla la base local.
- El modo E2E no representa latencia, límites ni fallos de un proveedor real.
