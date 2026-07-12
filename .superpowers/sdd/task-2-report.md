# Informe Task 2 — Fase 2 Asistente Retributivo

Fecha: 2026-07-13
Base: `64664ebb7778df43201fa80266b3916e40d5e894`

## Estado

Fase 2 implementada con límite de privacidad recursivo fail-closed, extracción local TXT/Markdown/CSV/PDF/XLSX/DOCX, pipeline sanitizado estricto, índice léxico directo, reemplazo IndexedDB atómico por análisis, aislamiento/copia explícita de documentos generales y fuentes históricas inertes.

`/api/analyze` no se modificó. La ingesta se inicia únicamente después de `saveAnalysis(record)` y su promesa se desacopla con captura local, por lo que un fallo no bloquea el análisis funcional.

## Evidencia TDD RED/GREEN

### 2.1 Privacidad determinista

RED:

- `pnpm exec vitest run tests/assistant/privacy.test.ts`
- Fallo esperado: no existían `privacy/assertions`, `privacy/patterns` ni `privacy/sanitize`.

GREEN:

- `pnpm exec vitest run tests/assistant/privacy.test.ts`
- 28/28 pruebas pasaron.
- Cobertura: nombres conocidos, DNI/NIE/NIF, IBAN español, Seguridad Social, cuentas/entidades bancarias, email, teléfono, domicilio, líneas etiquetadas, secretos, archivos/rutas y auditoría recursiva de documents/chunks/searchTerms/sources/snapshots/cache/indexJobs/errors.
- Los hallazgos contienen solo categoría, ruta lógica y ruleId; nunca reproducen el valor.

### 2.2 Ingesta local-first

RED:

- `pnpm exec vitest run tests/assistant/ingestion.test.ts`
- Fallo esperado inicial: no existían chunker, parsers, servicio ni índice.
- RED DOCX posterior: `parseDocxBuffer is not a function`.
- RED de estado posterior: faltaban transiciones `extracting/anonymizing/fragmenting/indexing/ready`.

GREEN:

- `pnpm exec vitest run tests/assistant/ingestion.test.ts`
- 8/8 pruebas pasaron.
- TXT/Markdown/CSV se procesan en cliente. PDF usa `unpdf` y reutiliza `parsePayrollPdf` con etiqueta segura. XLSX usa import dinámico de `xlsx` y recorre todas las hojas/celdas, valores, formato, fórmulas, caché, merges y relaciones. DOCX usa import dinámico de `mammoth`.
- Se verificó el orden extracción → PII → anonimización → assert → chunk → index → persistencia.
- Snippets, términos y hashes nacen exclusivamente de JSON sanitizado; `rawValue` existe solo en el modelo efímero de extracción y se elimina antes de fragmentar.
- PDF sin texto devuelve `scanned_without_text`, sin OCR ni chunks.
- La compatibilidad prueba que un rechazo de ingesta no rechaza el resultado funcional.

### 2.3 Documentos generales y fuentes

RED:

- `pnpm exec vitest run tests/assistant/general-documents.test.ts tests/assistant/source-lifecycle.test.ts`
- Fallo esperado: no existían `documentActions` ni `sourceLifecycle`.
- RED adicional: faltaba copia del corpus sanitizado completo (documento, chunks e índice con IDs remapeados).

GREEN:

- 6/6 pruebas pasaron.
- Scoping estricto por conversationId, selección/destino/confirmación obligatorios para copiar, borrado por defecto y traslado confirmado.
- Solo `available` participa en recuperación y navegación; `historical_unavailable` y `deleted` son inertes.

### Persistencia y regresión

RED:

- `pnpm exec vitest run tests/assistant/storage.test.ts`: faltaban auditoría previa y `writeIngestionBlock`; 3 fallos esperados.
- El endurecimiento reveló una regresión del vertical slice: los campos opcionales `analysisVersion: undefined` no forman parte de `SanitizedValue`. Se reprodujo y trazó hasta `writeConversationBlock`.

GREEN:

- `storage.test.ts`: 10/10.
- `vertical-slice.test.tsx`: 6/6.
- Los mensajes ahora omiten campos opcionales ausentes, y la regla IBAN evita falsos positivos sobre UUID.

## Dependencias

- Auditoría: `unpdf` y `xlsx` ya estaban instalados; `exceljs` traía `jszip` solo transitivamente y no se usó como API implícita.
- DOCX no tenía parser directo. Se añadió `mammoth` `1.12.0` como dependencia exacta y mediante import dinámico.
- No se añadieron Worker, OCR, embeddings, almacenamiento externo ni proveedores reales.

## Verificación final

- Focalizada Fase 2 + persistencia + vertical slice tras revisión: 6 archivos, 82/82 pruebas.
- Suite completa `pnpm test` tras revisión: 31 archivos, 280 pruebas pasaron, 4 omitidas, 0 fallos.
- `pnpm build`: exit 0; compilación, validación de tipos de aplicación y 9 páginas completadas. Conserva el warning conocido de dependencia dinámica interna de `unpdf` ya usado por el parser funcional.
- `pnpm exec tsc --noEmit --pretty false`: mantiene errores preexistentes en fixtures/tests ajenos descritos en Fase 1; el filtro sobre `src/lib/assistant`, `src/components/assistant` y `tests/assistant` no devuelve errores.
- `git diff --check`: sin errores; solo avisos de conversión LF/CRLF.
- `git diff -- src/app/api/analyze/route.ts`: vacío.

## Auto-revisión de invariantes

- No se persisten ni indexan binarios, nombres de archivo, rutas, autores, propiedades Office/PDF, texto bruto, PII o secretos.
- `localDisplayName` solo existe en la entrada efímera en memoria; el bloque persistido usa únicamente `sanitizedSourceLabel`.
- Cada put de repositorio se audita, y el bloque documental se escribe en una única transacción documents/chunks/searchTerms/indexJobs.
- Los errores públicos de ingesta son constantes y sanitizados.
- Documentos generales no migran implícitamente; la copia remapea IDs seguros y conserva únicamente corpus ya sanitizado.

## Preocupación residual documentada

La suite prueba la estructura completa de recibos y Registro con fixtures sintéticos y la suite heredada prueba PDFs/XLSX reales. DOCX se prueba con extractor sintético inyectado y su import dinámico queda validado por el build, pero no se añadió un binario DOCX sintético completo al repositorio. No afecta al límite de privacidad: cualquier fallo del parser se captura y no persiste ni propaga contenido.

## Correcciones tras revisión

RED adicional:

- Privacidad: 9 fallos reprodujeron claves reales dentro de `logicalPath` y ausencia de detección autónoma para teléfono español, Seguridad Social y CCC; un RED adicional probó que tampoco se confía en un logicalPath proporcionado por el llamador.
- Corpus general: 7 fallos reprodujeron ausencia de `indexJobs`, mapping incorrecto con IDs que contienen `-copy-` y falta de operaciones transaccionales reales.
- No indexables: 2 fallos demostraron que `scanned_without_text` y `empty_document` no se persistían.
- Índice/extracción: 3 fallos reprodujeron posiciones vacías para términos con acentos y campos `position`/`coordinates` fabricados.
- Regresión: el vertical slice detectó un falso positivo de teléfono dentro de un ID generado; la causa fueron límites que permitían comenzar dentro de tokens con guion.

GREEN adicional:

- Las rutas lógicas usan exclusivamente `$`, segmentos `field[n]` e índices posicionales; findings y errores nunca incluyen claves reales ni aceptan rutas externas inseguras.
- Teléfonos, SS y CCC autónomos se bloquean en valores, chunks y searchTerms, con límites que no confunden IDs estructurales.
- IndexedDB expone copia, traslado y borrado atómicos sobre documents/chunks/searchTerms/indexJobs; se verifican aislamiento, rollback y ausencia de huérfanos.
- La copia usa mapas explícitos source→target, incluye indexJobs y admite IDs con `-copy-`.
- Escaneados y documentos vacíos persisten metadata/indexJob seguros con estado error y cero chunks.
- El índice normaliza texto y términos de forma consistente preservando posiciones en el contenido sanitizado.
- `position` y `coordinates` solo se incluyen cuando el parser actual los proporciona.

## Correcciones de colisión y reingesta tras segunda revisión

RED adicional:

- Copia determinista: la re-copia a un target ya poblado resolvía y sobrescribía solo los IDs coincidentes, dejando registros anteriores. El focalizado reprodujo la colisión y exigió source y target completos e intactos, sin IDs nuevos ni huérfanos.
- Reingesta: no existían `beginAnalysisIngestion` ni `replaceAnalysisCorpus`; los documentos se publicaban uno a uno con `put`, por lo que una reingesta retenía documentos retirados/chunks sobrantes y una generación antigua podía sobrescribir otra nueva.
- Orquestación: una prueba con dos conexiones IndexedDB bloqueó la extracción antigua, publicó la nueva y liberó después la antigua en estado no indexable; antes del cambio la ruta de producción ni iniciaba el protocolo de generación.

GREEN adicional:

- La copia/transferencia rechaza atómicamente si cualquier documento, chunk, término o indexJob ya pertenece al target determinista. No se ejecuta ningún `put`, y el corpus source/target preexistente queda intacto.
- Cada reingesta registra primero una generación vigente segura en `analysisVersions`. Tras extraer, anonimizar, fragmentar e indexar todos los documentos en memoria, `replaceAnalysisCorpus` comprueba esa generación dentro de la misma transacción que sustituye documents/chunks/searchTerms/indexJobs.
- El reemplazo borra documentos retirados y todos sus dependientes, elimina chunks/términos/jobs sobrantes y publica el nuevo corpus completo de forma atómica. Un fallo de cuota revierte borrados y escrituras.
- Una generación obsoleta devuelve `false` y no publica aunque termine después con estado ready o error/no-indexable. Una ingesta parcial por fallo de parser tampoco sustituye el corpus completo anterior.
- Los tokens solo contienen IDs técnicos auditados; los binarios, nombres locales y contenido bruto siguen siendo efímeros y no entran en `analysisVersions` ni en ningún store del corpus.
