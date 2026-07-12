# Asistente Retributivo — Especificación de diseño

**Estado:** aprobado para implementación
**Fecha:** 2026-07-12
**Última corrección incorporada:** 2026-07-13

## 1. Objetivo y criterios de éxito

El Asistente permite conversar sobre un análisis retributivo, personas, Cuadre Reg., conceptos, agrupaciones y documentación adicional, además de mantener conversaciones generales sin análisis. Sus respuestas deben ser privadas, trazables y numéricamente idénticas a los resultados calculados por Retributivo.

La primera entrega funcional es este recorrido vertical, en este orden: crear una conversación general, persistirla en IndexedDB, seleccionar un modelo falso, enviar una pregunta, recibir NDJSON simulado en streaming, recargar y recuperar conversación y mensajes, convertirla al análisis activo, asociar una persona, ejecutar `getPersonProfile()` y mostrar una respuesta con una fuente sanitizada. Este recorrido debe funcionar antes de ampliar formatos documentales, proveedores reales, herramientas o interfaz avanzada.

El diseño se considera correcto cuando:

- `/api/analyze` conserva su petición, respuesta `AnalysisResult` y comportamiento actuales; el Asistente no altera cálculos, historial, Personas, Cuadre Reg., Agrupaciones ni exportación.
- Un fallo de ingestión o indexación nunca impide guardar ni usar un análisis.
- Ningún proveedor recibe documentos originales, nombres, identificadores sensibles, rutas o metadatos originales.
- Ningún store recuperable contiene texto bruto ni PII prohibida.
- Las cifras de herramientas coinciden con las mostradas por Personas y Cuadre Reg. porque proceden de los mismos resultados o selectores de dominio.
- Conversaciones, mensajes y fuentes sobreviven a una recarga; las conversaciones conservadas tras borrar su análisis son estrictamente de lectura.

No forman parte de esta versión: autenticación, usuarios, base remota, compartir conversaciones, cifrado casero, OCR nuevo, embeddings externos, fórmulas retributivas nuevas, acciones destructivas desde el chat o alertas persistentes por anomalías no solicitadas.

## 2. Estado actual y límites de integración

La aplicación actual envía Registro y recibos mediante `POST /api/analyze`, cuyos parsers generan un `AnalysisResult`. `AppState` conserva los `File` seleccionados durante la sesión, crea el identificador del análisis después de recibir el resultado y lo guarda en IndexedDB `retributivo-analysis-v1`; ajustes e identificador activo usan `localStorage`. El Asistente tendrá una base separada y no modificará ese esquema ni utilizará su fallback de `localStorage`.

`AnalysisResult` contiene los resultados funcionales ya calculados (`people`, `payrollRecords`, `registroEmployees`, comparaciones, conceptos, agrupaciones y comprobaciones internas). Es la única fuente de importes del Asistente. Los parsers actuales incluyen PII y nombres de archivo en sus salidas, de modo que esas estructuras no pueden copiarse directamente al corpus ni enviarse a proveedores.

Se añadirá `"asistente"` a `AppView`, entre Agrupaciones e Historial. `AppState` solo expondrá el análisis activo y un destino de navegación tipado; conversaciones, streaming, clave manual e indexación pertenecerán a `AssistantProvider` y servicios bajo `src/lib/assistant/`, evitando ampliar el estado global funcional con secretos o deltas de streaming.

## 3. Arquitectura y responsabilidades

### 3.1 Módulos

- **Dominio del Asistente:** tipos e invariantes de conversaciones, mensajes, eventos, acciones, documentos, fuentes, modelos e indexación. No depende de React, IndexedDB ni SDK de proveedor.
- **Repositorios:** interfaces asíncronas y una implementación IndexedDB. La UI nunca accede a `indexedDB` directamente; otra implementación futura podrá usar una base remota sin cambiar el dominio.
- **Privacidad:** sanitización determinista, resolución nombre→matrícula, detección fail-closed y auditoría recursiva antes de persistir o enviar.
- **Ingestión:** `AssistantIngestionService` coordina extracción, anonimización, comprobación, fragmentación, indexación y persistencia por unidad documental. Su resultado es independiente del resultado funcional.
- **Herramientas:** allowlist de consultas locales de solo lectura sobre `AnalysisResult` y selectores compartidos.
- **Contexto:** búsqueda léxica, selección, deduplicación, presupuesto y compactación; no recalcula datos.
- **Orquestación:** cliente ejecuta herramientas locales y servidor adapta modelos, valida privacidad y transmite eventos NDJSON.
- **Presentación:** `AssistantProvider` aísla estado por conversación; la vista consume servicios y repositorios mediante interfaces.

### 3.2 Flujo del análisis sin acoplamiento

1. `AppState` ejecuta hoy `POST /api/analyze` y recibe exactamente el mismo `AnalysisResult` JSON.
2. Guarda el `StoredAnalysis` y actualiza la aplicación como hasta ahora.
3. Solo después del éxito funcional, inicia `AssistantIngestionService.ingestAnalysis()` en segundo plano con `analysisId`, `AnalysisResult` y los `File` que siguen en memoria.
4. La ingestión procesa documentos individualmente y registra `extracting | anonymizing | fragmenting | indexing | ready | partial | error`.
5. Cualquier excepción se captura dentro del servicio, se convierte en un error sanitizado y jamás se propaga al `Promise` del análisis funcional.

No se modifica `/api/analyze` ni se crean eventos de análisis. Si una limitación futura hiciera imprescindible ampliarlo, solo se permitirían campos o eventos opcionales con namespace `assistant:*`, ignorables por consumidores actuales; esa excepción exige una prueba de compatibilidad del contrato antes de implementarse.

## 4. Modelo de dominio

```ts
type ConversationType = "general" | "analysis";
type ConversationStatus = "active" | "archived" | "archived_analysis_deleted";
type MessageStatus =
  | "streaming"
  | "completed"
  | "stopped"
  | "interrupted"
  | "failed";
type ResponseMode = "strict" | "flexible";
type ContextStrategy = "automatic" | "full" | "optimized";
type ContextOrigin = "general" | "analysis";

interface Conversation {
  id: string;
  type: ConversationType;
  analysisId?: string;
  title: string;
  associatedPersonIds: string[];
  primaryPersonId?: string;
  modelProfileId: string;
  responseMode: ResponseMode;
  contextStrategy: ContextStrategy;
  analysisVersion?: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string; // contenido sanitizado: es la única representación persistida
  status: MessageStatus;
  contextOrigin: ContextOrigin;
  modelProfileId: string;
  responseMode: ResponseMode;
  contextStrategy: ContextStrategy;
  analysisVersion?: string;
  sourceRefIds: string[];
  actionIds: string[];
  usage?: TokenUsage;
  createdAt: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

type IndexingStatus =
  | "extracting"
  | "anonymizing"
  | "fragmenting"
  | "indexing"
  | "ready"
  | "partial"
  | "error";

type ChatEventPayload =
  | { type: "context_added" | "context_removed"; contextId: string; label: string }
  | { type: "person_added" | "person_removed"; analysisId: string; personId: string }
  | { type: "model_changed"; previousModelProfileId: string; modelProfileId: string }
  | { type: "context_compacted"; snapshotId: string; summarizedMessageIds: string[] }
  | { type: "analysis_updated"; previousVersion: string; analysisVersion: string }
  | { type: "indexing_completed"; documentId: string; status: "ready" | "partial" | "error" }
  | { type: "automatic_fallback"; previousModelProfileId: string; modelProfileId: string }
  | { type: "action_accepted" | "action_rejected" | "action_failed"; actionId: string };

interface ChatEvent {
  id: string;
  conversationId: string;
  event: ChatEventPayload;
  createdAt: string;
}

type ChatActionPayload =
  | { type: "open_person"; analysisId: string; personId: string }
  | { type: "open_cuadre"; analysisId: string; personId?: string; view?: "non_normalized" | "normalized_variables" }
  | { type: "open_grouping"; analysisId: string; groupingId: string }
  | { type: "show_sources"; sourceIds: string[] }
  | { type: "add_person" | "remove_person" | "set_primary_person"; analysisId: string; personId: string }
  | { type: "compare_people" | "show_comparison_table"; analysisId: string; personIds: string[] }
  | { type: "generate_visual"; analysisId: string; visual: "person_summary" | "people_comparison" | "period_timeline"; personIds: string[] }
  | { type: "show_timeline"; analysisId: string; personId?: string; periods?: string[] }
  | { type: "create_conversation"; sourceConversationId: string }
  | { type: "copy_document_context"; sourceConversationId: string; targetConversationId: string; documentIds: string[] };

interface ChatAction {
  id: string;
  conversationId: string;
  messageId: string;
  label: string;
  description: string;
  action: ChatActionPayload;
  status: "pending" | "accepted" | "rejected" | "failed";
  createdAt: string;
  resolvedAt?: string;
}

interface ModelProfile {
  id: string;
  name: string;
  provider: "gemini" | "openai" | "openrouter" | "cerebras" | "groq" | "manual";
  baseUrl: string;
  modelId: string;
  enabled: boolean;
  generalChatCompatible: boolean;
  analysisCompatible: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  detectedContextWindow?: number;
  manualContextWindow?: number;
  maxOutputTokens?: number;
  capabilitiesSource: "detected" | "manual";
  verifiedAt?: string;
  lastVerificationError?: string;
}

type DocumentScope =
  | { type: "analysis"; analysisId: string }
  | { type: "conversation"; conversationId: string };
type SourceAvailability = "available" | "historical_unavailable" | "deleted";

interface EphemeralLocalDocumentMetadata {
  localDisplayName: string;
  sanitizedSourceLabel: string;
  safeDocumentId: string;
  scope: DocumentScope;
}

interface PersistedDocumentMetadata {
  id: string;
  sanitizedSourceLabel: string;
  scope: DocumentScope;
  mediaType: "pdf" | "xlsx" | "docx" | "csv" | "txt" | "markdown";
  status: IndexingStatus;
  createdAt: string;
  updatedAt: string;
}

interface SourceReference {
  id: string;
  conversationId: string;
  messageId?: string;
  analysisId?: string;
  documentId?: string;
  personId?: string;
  sourceType: string;
  sanitizedSourceLabel: string;
  availability: SourceAvailability;
  page?: number;
  sheet?: string;
  rowRange?: string;
  cellRange?: string;
  period?: string;
  conceptIds: string[];
  excerpt: string;
  sanitizedHash: string;
}
```

`localDisplayName` existe exclusivamente en memoria de la pestaña para la UI. No se guarda en IndexedDB, no entra en hashes, logs, fuentes, caché o peticiones. La versión persistida conserva únicamente `sanitizedSourceLabel`, por ejemplo `Recibo matrícula 10048 · enero`, `Registro Retributivo · hoja Empleados` o `Documento adicional 3`.

El texto bruto escrito por el usuario también es efímero. `AssistantProvider` puede mantenerlo únicamente durante la edición y el envío actual; antes de crear `ChatMessage` resuelve nombres localmente, anonimiza y ejecuta `assertSafeForPersistence`. `ChatMessage.content` siempre es la versión sanitizada. Tras enviar o desmontar el compositor se elimina el texto bruto de memoria; después de recargar solo se muestra la versión sanitizada persistida. Ningún nombre o PII introducido por el usuario se conserva en IndexedDB aunque el almacenamiento sea local.

### Conversaciones generales

Una conversación general recibe únicamente un system prompt estático y versionado que explica qué es Retributivo, qué compara y la terminología Reg. Retrib., Recibos, Cuadre, conceptos y agrupaciones. No obtiene automáticamente el análisis activo, personas, recibos, Registro ni herramientas de análisis. Solo puede consultar sus propios documentos sanitizados ligados a `conversationId`. El acceso a datos retributivos comienza exclusivamente tras la conversión explícita a tipo `analysis`.

`ChatEvent` es una entidad separada con `type`, payload validado y fechas. Tipos admitidos: `context_added`, `context_removed`, `person_added`, `person_removed`, `model_changed`, `context_compacted`, `analysis_updated`, `indexing_completed`, `automatic_fallback`, `action_accepted`, `action_rejected` y `action_failed`. `ChatAction` también es una entidad separada con estados `pending | accepted | rejected | failed`; su tipo pertenece a una allowlist no destructiva.

`ModelProfile` guarda proveedor, endpoint no secreto, `modelId`, compatibilidades, capacidades detectadas o manuales, ventanas y resultado sanitizado de verificación. Nunca contiene claves. Los mensajes, fuentes y eventos registran el modelo y versión usados para preservar trazabilidad.

Al convertir una conversación general al análisis activo se conserva el historial, se marca cada mensaje anterior con `contextOrigin: "general"`, se emite `context_added` y se fija exactamente un `analysisId`. Intentar asociar otro análisis crea una conversación nueva que solo hereda modelo, modo y estrategia; no copia mensajes, personas ni fuentes.

## 5. Persistencia local y ciclo de vida

La base `retributivo-assistant-v1`, versión 1, contiene los stores `conversations`, `messages`, `events`, `actions`, `sources`, `documents`, `chunks`, `searchTerms`, `snapshots`, `cache`, `analysisVersions`, `indexJobs`, `modelProfiles`, `assistantSettings` y `cleanupJobs`. Habrá índices por `conversationId`, `analysisId`, `documentId`, `status`, `createdAt` y `updatedAt` donde correspondan. Mensajes e historial se leen por cursor, no como documentos agregados.

Las interfaces mínimas son `ConversationRepository`, `MessageRepository`, `AssistantDocumentRepository`, `SourceRepository`, `ContextSnapshotRepository`, `ModelProfileRepository` y `AssistantCleanupRepository`. Operaciones que abarcan varios stores usan una única transacción; errores de cuota dejan el bloque no persistido y producen un mensaje sanitizado recuperable. `versionchange` cierra la conexión y las migraciones son idempotentes.

Antes de cualquier `put` en `chunks`, `searchTerms`, `sources`, `snapshots`, `cache` o `indexJobs`, `assertSafeForPersistence()` audita recursivamente claves y valores. También se auditan documentos persistidos y errores para impedir que etiquetas o metadata reintroduzcan PII. No se almacenan binarios originales, texto bruto, nombres originales, rutas, autores, propiedades Office/PDF, claves ni cabeceras.

IndexedDB no se presenta como seguro o cifrado. Ajustes > IA mostrará literalmente:

> Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador. Cualquier persona con acceso al perfil del navegador podría acceder a estos datos.

No hay fallback a `localStorage`, `sessionStorage` ni cifrado propio.

### Borrado y evidencia histórica

El borrado coordinado entre la base funcional y la del Asistente se representa con `cleanupJob` idempotente y reanudable. Historial ofrece: cancelar; eliminar análisis y todo; o eliminar análisis conservando conversaciones.

Al conservar conversaciones, estas pasan a `archived_analysis_deleted` y lectura estricta. Se eliminan documentos recuperables, chunks, términos, snapshots, caché e índices del análisis. Solo las fuentes sanitizadas efectivamente citadas por respuestas antiguas pueden permanecer como evidencia; pasan a `historical_unavailable`, no participan en búsqueda, no abren Persona/documento/Cuadre y se distinguen de `available` y `deleted`. No se admiten nuevas respuestas.

## 6. Privacidad y pipeline documental

El orden es invariable por página, hoja o bloque:

`extracción → identificación de personas y PII → anonimización → assertSafeForProvider → fragmentación → indexación → transacción IndexedDB`

Fragmentar, generar snippets, términos o hashes antes de anonimizar es un error de programación. Todo snippet se deriva del texto sanitizado; hashes y checkpoints contienen solo contenido o IDs seguros. Un bloque se persiste atómicamente solo después de superar la auditoría. Los documentos se tratan como contenido no confiable: sus instrucciones no alteran el system prompt, no generan acciones y no se interpretan como órdenes.

La capa determinista ofrece:

```ts
sanitizeForAI(input, knownPeople): SanitizedValue
redactKnownPersonValues(input, knownPeople): SanitizedValue
detectSensitivePatterns(input): SensitiveFinding[]
assertSafeForProvider(input): void
assertSafeForPersistence(input): void
```

`SanitizedValue` es una estructura JSON compuesta únicamente por `null`, booleanos, números finitos, strings sanitizados, arrays y objetos con claves sanitizadas. `SensitiveFinding` contiene solo `category`, `logicalPath` y `ruleId`; nunca incluye el valor detectado.

Se eliminan nombres conocidos, NIF/DNI/NIE, Seguridad Social, IBAN, cuentas y entidades bancarias, domicilio, email, teléfono, fecha de nacimiento, contacto y líneas etiquetadas como datos personales o bancarios. Una consulta que menciona un nombre conocido existe solo efímeramente en memoria hasta resolverse y sanitizarse; la versión persistida y enviada sustituye el nombre por matrícula. Los nombres de respuesta se resuelven localmente mediante `PersonReference`. La política es fail-closed y los errores describen categoría y ubicación lógica sin reproducir el valor.

Las hojas y encabezados pasan por la misma sanitización. Nunca se envían o persisten rutas, carpetas, nombres originales, autor o propiedades internas. Los proveedores solo reciben la pregunta y fragmentos/estructuras ya sanitizados; no reciben archivos originales. No se usan extracción, OCR, embeddings ni almacenamiento externos.

### Ejecución local-first

- TXT, Markdown y CSV se extraen en cliente.
- PDF, XLSX y DOCX se extraen en cliente cuando las utilidades actuales sean compatibles y puedan cargarse dinámicamente sin penalizar el bundle inicial.
- `/api/assistant/documents/parse` solo se usa cuando un parser no pueda ejecutarse razonablemente en navegador. Procesa en memoria, anonimiza antes de responder y no escribe temporales persistentes. Un fallo descarta referencias y buffers de la petición.
- Fragmentación, búsqueda, indexación y persistencia ocurren siempre en cliente.
- La ejecución inicial del índice es directa detrás de `IndexExecutor`. Solo se añade `WorkerIndexExecutor` si una medición muestra una tarea principal mayor de 50 ms o más de 5.000 chunks con pérdida de respuesta de UI.

`AssistantIngestionService` procesa cada documento por separado; el resultado global es `ready`, `partial` si al menos una unidad sirve y otra falla, o `error` si ninguna sirve. Un PDF sin texto se marca no indexable; no se añade OCR.

Documentos generales pertenecen a un único `conversationId`, usan su propio índice y nunca se incorporan a un análisis ni otra conversación de forma implícita. `copy_document_context` copia explícitamente corpus ya sanitizado a otra conversación mediante una acción validada. Al borrar la conversación se eliminan; conservarlos requiere seleccionar otra conversación destino.

### Contratos de extracción completos

El modelo documental local completo y la proyección sanitizada para IA son estructuras separadas. El modelo funcional actual no cambia.

- **Recibos:** por página conserva matrícula, periodo, empresa, centro, puesto, categoría, grupo profesional, fechas, líneas y bloques, concepto, código, descripción, unidades, precio, importe, devengos, deducciones relevantes, bases, totales, número de página, estructura/coordenadas disponibles y texto extraído. La proyección elimina PII y sustituye archivo original por `sanitizedSourceLabel` antes de fragmentar.
- **Registro Retributivo:** recorre todas las hojas y conserva encabezados y cabeceras multinivel, cada celda no vacía con dirección, valor bruto, texto formateado, fórmula, resultado almacenado, fila/columna relacionada, merges, matrícula y campos profesionales, bloques No normalizados/Normalizados/Norm. + variables/desglose, hojas de agrupación y datos usados por Cuadre. Nombres de hoja y encabezados se sanitizan antes de entrar en la proyección.
- **Adicionales:** PDF, XLSX, DOCX, CSV, TXT y Markdown conservan campos estructurados, texto sanitizado, metadata segura y referencia exacta segura. No se fuerza un esquema único ni se conservan propiedades de autor/origen.

Las pruebas de completitud usarán fixtures sintéticos y exigirán cada campo aplicable, además de verificar que la salida funcional de los parsers y `AnalysisResult` permanece idéntica.

## 7. Herramientas, búsqueda y contexto

Las herramientas locales validan entrada y salida con Zod, exigen el `analysisId` de la conversación, no aceptan ni devuelven nombres, adjuntan fuentes y son de solo lectura. Pueden filtrar, agrupar, ordenar, comparar, recuperar y resumir resultados existentes. No implementan fórmulas retributivas.

La allowlist incluye `getAnalysisSummary`, `findPersonByEmployeeId`, `searchPeople`, `getPersonProfile`, `getPersonPayrollPeriods`, `getPersonConceptDifferences`, `getPersonCuadreReg`, `getPersonNormalizedData`, `getPersonGroupings`, `comparePeople`, `getTopDifferences`, `getDifferencesByCenter`, `getDifferencesByPosition`, `getDifferencesByConcept`, `getPendingConcepts`, `getDisabledConcepts`, `searchDocumentChunks` y `getSourceDetails`. Un agregado nuevo se crea como selector compartido sobre `AnalysisResult`, nunca como fórmula paralela, y se contrasta con Personas o Cuadre Reg.

La recuperación prioriza: herramientas estructuradas, filtros de metadata, búsqueda léxica local, fragmentos sanitizados y contexto completo relevante. No hay embeddings. `SearchIndex` es reemplazable y excluye fuentes no disponibles.

`ContextPlanner` deduplica por `sourceId + sanitizedHash + factKey`. Si un hecho ya aparece en datos estructurados, excluye fragmento y mensaje equivalentes. “Completa” incluye todo el corpus relevante que quepa, no todos los documentos indiscriminadamente. Siempre reserva system prompt, herramientas, salida y 10 % de margen; avisa al 75 % y compacta al 85 %. La compactación solo cambia el payload: conserva mensajes originales y registra IDs resumidos, decisiones, cifras, fuentes, acciones, personas y versión.

## 8. Protocolo, rutas y orquestación

El único protocolo de streaming interno es `fetch` POST con `ReadableStream` NDJSON UTF-8. Cada línea contiene un objeto JSON validado por una unión discriminada; no se extraen eventos mediante expresiones regulares, Markdown o HTML.

```ts
type AssistantStreamEvent =
  | { type: "status"; roundId: string; label: string }
  | { type: "tool_request"; roundId: string; requestId: string; tool: string; args: unknown }
  | { type: "tool_result_ack"; roundId: string; requestId: string }
  | { type: "text_delta"; roundId: string; messageId: string; delta: string }
  | { type: "source"; roundId: string; source: SourceReference }
  | { type: "action"; roundId: string; action: ChatAction }
  | { type: "usage"; roundId: string; usage: TokenUsage }
  | { type: "done"; roundId: string; finishReason: string }
  | { type: "error"; roundId: string; code: string; message: string; retryable: boolean };
```

Rutas únicas:

- `POST /api/assistant/models`: `list`, `probe` y `restore_detected`, discriminados por `operation`; lista modelos, verifica conexión y comprueba capacidades.
- `POST /api/assistant/chat`: fases `plan`, `respond` y `continue`, discriminadas por `phase`; planificación, confirmación de resultados locales, respuesta, streaming y fallback.
- `POST /api/assistant/documents/parse`: opcional y solo para extracción que no sea viable en cliente.

El cliente envía pregunta sanitizada y metadata mínima; el servidor emite `tool_request`; el cliente valida allowlist y ejecuta sobre datos locales; una petición posterior a la misma ruta entrega resultados otra vez sanitizados; el servidor confirma con `tool_result_ack` y responde. No se intenta full-duplex HTTP y se permiten como máximo tres rondas.

Antes de cada ronda, cliente y servidor ejecutan `assertSafeForProvider`. Las rutas no registran cuerpos, fragmentos, claves ni Authorization. Los estados muestran únicamente operaciones reales, nunca chain-of-thought.

## 9. Proveedores, capacidades, clave y fallback

`AIProviderAdapter` desacopla `listModels`, `probeCapabilities`, `getModelMetadata`, `planTools` y `streamResponse`; Gemini usa adaptación nativa y los proveedores OpenAI-compatible pueden compartir una base. Las claves configuradas se leen solo de variables server-only. La configuración Manual usa un `EphemeralKeyVault` creado por clausura: React solo recibe `setKey`, `clearKey` y `withKey`; el secreto no entra en estado, props, contexto serializable o DevTools.

Los presets obligatorios son Gemini (`GEMINI_API_KEY`), OpenAI (`OPENAI_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), Cerebras (`CEREBRAS_API_KEY`), Groq (`GROQ_API_KEY`) y Manual. Cada preset precompleta la base URL oficial vigente, muestra su variable, admite varios modelos y permite editar nombre visible/modelId. Antes de implementar o actualizar un adaptador se consulta la documentación oficial actual de endpoint, autenticación, streaming, tools, structured output, listado de modelos, tokens y metadata; las conclusiones se registran en el documento técnico de la fase.

La ventana se determina estrictamente por: metadata del proveedor → catálogo interno versionado → valor manual. Si ninguna fuente da un valor, la compatibilidad de análisis queda sin verificar; nunca se inventa un límite.

La clave manual no se guarda en IndexedDB, localStorage, sessionStorage, URL, logs, trazas ni errores. Si viaja a una ruta, vive en una variable local de esa petición; no hay singleton, caché o global del servidor. Recarga y desmontaje la invalidan, evitando compartirla entre sesiones o usuarios.

Un modelo de análisis solo es compatible tras superar conexión, streaming real o adaptación equivalente, tool calling, argumentos estructurados válidos, respuesta estructurada, ventana suficiente para instrucciones/herramientas/2.048 tokens de salida/margen, cancelación controlada y error sanitizado. Aceptar una petición no basta. El override muestra literalmente: “Compatibilidad habilitada manualmente y no garantizada.”

Fallback máximo: un reintento del modelo actual para error transitorio y un cambio al modelo predeterminado compatible del tipo de conversación. No hay fallback por autenticación, privacidad, incompatibilidad, ventana mal configurada o cancelación. Si ya hay texto, queda como mensaje `interrupted`; la continuación usa un mensaje nuevo y ambos indican su modelo. No hay más cambios automáticos.

## 9.1 Modos y estrategias

Los defaults globales son `responseMode: "strict"` y `contextStrategy: "automatic"`; Ajustes > IA permite cambiarlos y cada conversación puede sobrescribirlos.

- **Estricto:** solo afirma lo respaldado por fuentes; si falta información lo indica y enumera qué falta; nunca presenta hipótesis como hechos.
- **Flexible:** separa siempre “Confirmado por los datos”, “Posible explicación” e “Información necesaria para verificarlo”.
- **Automática:** selecciona herramientas, resúmenes y fragmentos relevantes.
- **Completa:** incluye todo el corpus sanitizado relevante y deduplicado que quepa.
- **Optimizada:** usa resumen global, personas mencionadas, fragmentos relevantes e historial compactado.

Cada mensaje persiste el modo y la estrategia realmente usados.

## 10. UI, navegación, fuentes y acciones

La Fase 1 ofrece una vista mínima accesible para el recorrido vertical. La vista final usa tres superficies independientes en escritorio —conversaciones, chat y contexto— y chat completo con drawers de conversaciones/contexto en móvil. Mantiene el shell gris, navbar flotante y controles compactos; no imita ChatGPT.

Las fuentes muestran estado disponible, histórico o eliminado tanto por texto como visualmente. Solo `available` permite navegación. Markdown se renderiza sin HTML arbitrario, con enlaces y componentes mediante allowlists. Las acciones provienen de eventos estructurados, se validan por tipo, conversación, análisis, entidad y payload, y nunca se ejecutan desde texto.

Desde Persona, “Continuar en Asistente” reutiliza evidencia existente sin llamar al modelo. Añade la matrícula a una conversación activa del mismo análisis o permite elegir/crear una; no duplica personas. Las acciones visuales construyen componentes con cifras locales reales.

La interfaz final cumple WCAG AA, foco visible, teclado, Escape, restauración de foco, `aria-live` agregado por bloques y reduced motion. Streaming se agrupa para no rerenderizar toda la vista por token; `AbortController` detiene y conserva texto como `stopped`. Motion dura 120–240 ms salvo reducción de movimiento. Se validan 1600, 1440, 1280, 1024, 768 y 390 px sin overflow global.

## 11. Versionado, errores y observabilidad

`analysisVersion` es SHA-256 de una representación canónica sanitizada de datos y configuración que afectan resultados. Nunca incluye nombres, NIF, archivos o metadata original. Cambiar recibos, Registro, exclusiones, conceptos activos o resultados crea otra versión; mensajes previos no se reescriben.

Errores públicos y persistidos contienen código estable, fase, documento seguro y acción recuperable, sin valores detectados, contenido, nombres o secretos. Logs permitidos: IDs seguros, contadores, duración, proveedor/modelo no secreto, código y estado. Indexación parcial identifica unidades seguras fallidas y no afirma haber consultado lo todavía no indexado.

## 12. Dependencias

Antes de instalar se auditan `package.json`, lockfile y utilidades. Ya existen `xlsx`, `exceljs`, `unpdf`, `zod`, `motion` y Vitest; se reutilizan cuando cubran el contrato. Cada adición tendrá versión exacta, finalidad, alternativa descartada, entorno e impacto aproximado de bundle documentados. `fake-indexeddb` y Playwright, si son necesarios, serán solo de desarrollo. Parsers y renderer Markdown se cargarán dinámicamente y nunca en el bundle inicial.

## 13. Estrategia de pruebas y aceptación

La implementación sigue TDD y no llama a proveedores reales. Adaptadores falsos producen NDJSON, herramientas, errores, cancelación y fallback.

- **Compatibilidad funcional:** contrato de `/api/analyze` sin cambios; fallo de ingestión no afecta análisis, historial ni exportación.
- **Vertical slice:** recorrido completo, recarga, conversión, persona, herramienta y fuente sanitizada.
- **Privacidad:** nombres, NIF, IBAN, Seguridad Social, teléfono, email y cuentas no aparecen en `documents`, `chunks`, `searchTerms`, `sources`, `snapshots`, `cache`, `indexJobs` ni errores; nombre/archivo/ruta/autor/hoja insegura no llega al adaptador.
- **Cálculos:** salidas de `getPersonProfile` y herramientas de Cuadre coinciden exactamente con selectores y vistas actuales.
- **Persistencia:** migración, cuota, paginación, reanudación, limpieza por análisis y transacciones atómicas.
- **Documentos generales:** aislamiento por conversación, copia explícita y eliminación/traslado confirmado.
- **Fuentes históricas:** no participan en recuperación, navegación o nuevas respuestas.
- **Modelos:** probes conductuales, override visible, clave no persistida y desaparición al recargar.
- **Fallback:** un reintento y un cambio como máximo; todas las exclusiones; continuación separada tras texto parcial.
- **Contexto:** deduplicación, margen 10 %, aviso 75 %, compactación 85 % y rechazo cuando no cabe.
- **Streaming y accesibilidad:** parser NDJSON por líneas, cancelación, parcial, foco, teclado, drawers, `aria-live` y reduced motion.
- **Rendimiento:** ejecución directa medida antes de Worker, historial paginado y ausencia de rerender global por delta.

Cada fase termina con tests focalizados, revisión de especificación, revisión de calidad, commit y árbol limpio. La verificación final ejecuta secuencialmente tests, E2E disponible, TypeScript, build, `git diff --check` y estado Git, distinguiendo fallos preexistentes de los introducidos.

## 14. Decisiones cerradas e invariantes

- El Asistente no cambia `/api/analyze`, `AnalysisResult` ni cálculos existentes.
- La ingestión empieza después de guardar con éxito el análisis y nunca bloquea su uso.
- El índice contiene exclusivamente material sanitizado; privacidad falla cerrada.
- `localDisplayName` es efímero y solo local; `sanitizedSourceLabel` es la única etiqueta persistible o enviable.
- NDJSON es el único protocolo de streaming y existen como máximo tres rutas internas.
- Las herramientas consultan datos actuales; no duplican fórmulas.
- “Contexto completo” significa corpus relevante deduplicado dentro del presupuesto.
- Las fuentes históricas son evidencia inerte; la conversación asociada es de lectura.
- Documentos generales no se comparten ni se convierten en parte de un análisis implícitamente.
- El índice empieza sin Worker y se migra detrás de la misma interfaz solo con evidencia de rendimiento.
- IndexedDB es almacenamiento local no cifrado; no se guardan secretos ni PII aunque el navegador sea local.
