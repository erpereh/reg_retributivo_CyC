# Matriz de verificación del Asistente

## Navegador (Chromium)

`tests/e2e/assistant.spec.ts` ejecuta el producto real con `ASSISTANT_E2E_MODE=1`, una base vacía por contexto y un adaptador determinista disponible exclusivamente tras `/api/assistant/chat` en el servidor de pruebas, sin red externa.

| Flujo | Evidencia de navegador |
|---|---|
| Conversación, NDJSON simulado, persistencia, recarga y regeneración | Crea una conversación, recibe la respuesta por stream, regenera y comprueba la misma respuesta tras recargar. |
| Detener y reintentar | Detiene tras el primer delta persistido, comprueba estado reintentable y finaliza una ejecución nueva. |
| Fallback y texto parcial | Envía tres POST visibles a `/api/assistant/chat`: parcial y error transitorio del modelo actual, reintento transitorio y continuación del modelo compatible predeterminado; conserva ambos mensajes y modelos tras recargar. |
| General → análisis, múltiples personas | Siembra un `StoredAnalysis` determinista, convierte la conversación y asocia dos matrículas sin duplicarlas. |
| Persona → Asistente | Abre Detalle Persona, reutiliza la conversación, cambia la principal y comprueba cero preguntas/respuestas automáticas. |
| Eliminación conservando conversaciones | Usa el diálogo real de Historial; elimina el análisis y comprueba evidencia histórica y compositor deshabilitado. |
| Eliminación total y reanudación | Usa el diálogo real, comprueba cascada y después reanuda un cleanup job `pending` al recargar. |
| Documentos generales | Acepta la acción estructurada real y comprueba en IndexedDB que solo el documento seleccionado llega al destino explícito con ID remapeado. |
| Fuentes y migración | Siembra esquema 3 antes de inicializar la aplicación, verifica la migración a esquema 4 y diferencia `available`, `historical_unavailable` y `deleted`; la conversación archivada permanece read-only. |
| Clave manual | Introduce una clave efímera, recarga y comprueba que el campo vuelve vacío. |
| Accesibilidad y responsive | Comprueba teclado, foco, Escape, diálogo de drawer, restauración de foco, reduced motion y ausencia de overflow a 1600/1440/1280/1024/768/390 px. |
| Rendimiento | Invoca el `DirectIndexExecutor` de producción con el fixture compartido de 5.200 chunks, un calentamiento y cinco ejecuciones. |

## Matrices deterministas complementarias

- Privacidad y auditoría recursiva: `tests/assistant/privacy.test.ts`, `storage.test.ts`, `chat-route.test.ts`.
- Migraciones, scopes y recuperación léxica: `storage.test.ts`, `storage-v2-search.test.ts`, `phase6-core.test.ts`.
- Proveedores, probes y errores sanitizados: `providers.test.ts`, `models-route.test.ts`, `phase7-verification.test.ts`.
- Contexto, compactación y presupuesto: `context.test.ts`, `phase4-final-review.test.ts`, `phase4-rereview.test.ts`.
- Fallback, cancelación y concurrencia: `fallback.test.ts`, `orchestration.test.ts`, `phase5-*-review.test.tsx`.
- Persona, acciones, snapshots y cleanup transaccional: `phase6-core.test.ts`, `phase6-integration-review.test.tsx`, `person-integration.test.tsx`.

Estas pruebas de bajo nivel no sustituyen los flujos Chromium anteriores: fijan condiciones de carrera, rollbacks y fallos de transacción que un único proceso de navegador no puede provocar de forma reproducible.
