# Informe Task 1 — Fase 1 Asistente Retributivo

Fecha: 2026-07-13
Worktree: `C:\Users\david\.codex\worktrees\reg-retributivo-cyc\asistente-retributivo`
Base: `2aef4c9 chore(ai): record assistant verification baseline`

## Estado

Fase 1 implementada con contratos de dominio, protocolo NDJSON incremental, persistencia IndexedDB local, adaptador falso, herramienta local `getPersonProfile`, vista accesible mínima e integración de navegación.

## Evidencia TDD RED/GREEN

### Task 1.1 — dominio y NDJSON

RED:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/stream-protocol.test.ts`
- Resultado esperado observado: 2 suites fallaron porque no existían `@/lib/assistant/domain` y `@/lib/assistant/streamProtocol`.
- En esa ejecución accidentalmente amplia por la sintaxis inicial de pnpm, los 136 tests previos siguieron pasando y 4 permanecieron omitidos.

GREEN:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/stream-protocol.test.ts`
- Resultado: 2 archivos, 25 tests pasaron, 0 fallos.
- Cobertura: invariantes general/análisis, conversión única, cinco estados de mensaje, scopes, tres disponibilidades de fuente, nueve eventos NDJSON, chunks UTF-8 parciales y rechazo fail-closed de JSON malformado, tipo desconocido, payload inválido y registro final incompleto.

### Task 1.2 — repositorios IndexedDB

RED:

- Comando: `pnpm exec vitest run tests/assistant/storage.test.ts`
- Resultado esperado observado: la suite no pudo resolver `@/lib/assistant/storage/database`.

GREEN:

- Comando: `pnpm exec vitest run tests/assistant/storage.test.ts`
- Resultado: 1 archivo, 5 tests pasaron, 0 fallos.
- Cobertura: esquema completo versión 1 y reapertura idempotente, crear/recargar, paginación con cursor, escritura atómica de tres stores, aborto completo por `QuotaExceededError`, mensaje de error sanitizado y ausencia de fallback a `localStorage`.

### Task 1.3 — vertical slice, herramienta y navegación

RED:

- Comando: `pnpm exec vitest run tests/assistant/vertical-slice.test.tsx tests/top-nav.test.tsx`
- Resultado esperado observado: la suite vertical no pudo resolver `AssistantProvider`; navegación falló porque faltaba la pestaña Asistente.

GREEN inicial:

- Comando: `pnpm exec vitest run tests/assistant/vertical-slice.test.tsx tests/top-nav.test.tsx tests/tables-view.test.tsx`
- Resultado: 3 archivos, 26 tests pasaron y 2 tests heredados omitidos.
- Cobertura vertical: conversación general, prompt estático, sustitución efímera de nombre por matrícula, NDJSON falso, borrado del compositor, recarga, conversión explícita, asociación de persona, herramienta local, importes idénticos a Persona y fuente sin nombre ni archivo original.

Verificación focalizada final:

- Comando: `pnpm exec vitest run tests/assistant tests/top-nav.test.tsx tests/tables-view.test.tsx tests/cuadre-excel-view.test.tsx`
- Resultado: 7 archivos, 60 tests pasaron y 2 omitidos.

Suite completa final (ejecutada una vez tras completar la implementación):

- Comando: `pnpm test`
- Resultado inicial: 27 archivos, 168 tests pasaron, 4 omitidos, 0 fallos.

### Correcciones posteriores a revisión

RED:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/storage.test.ts tests/assistant/vertical-slice.test.tsx`
- Resultado observado: 10 fallos y 17 pruebas previas pasaron.
- Fallos reproducidos: sanitización inexistente para DNI/email/teléfono y nombre desconocido; seis lecturas de `activeAnalysis.result.people` desde una conversación general; `context_added` ausente en IndexedDB; ocho repositorios no expuestos; cursor repetía `m1` y omitía `m2/m3` con timestamp compartido; allowlist de herramientas inexistente; stream fallido sin error público ni recuperación verificable.

GREEN unitario/integración:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/storage.test.ts tests/assistant/vertical-slice.test.tsx`
- Resultado: 3 archivos, 27 tests pasaron, 0 fallos.

GREEN focalizado solicitado:

- Comando: `pnpm exec vitest run tests/assistant tests/top-nav.test.tsx tests/tables-view.test.tsx`
- Resultado: 6 archivos, 65 tests pasaron, 2 omitidos, 0 fallos.

Suite completa posterior a correcciones:

- Comando: `pnpm test`
- Resultado: 27 archivos, 177 tests pasaron, 4 omitidos, 0 fallos.

### Endurecimiento fail-closed posterior

RED de nombres, ubicaciones, archivos, rutas, secretos y protocolo:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/stream-protocol.test.ts`
- Resultado observado: 14 fallos y 31 pruebas pasaron.
- Fallos reproducidos: nombres completos libres, nombres simples etiquetados, domicilios/direcciones, filenames, rutas Windows/Unix, secretos/API keys y tres variantes no permitidas de `tool_request` atravesaban los contratos.

RED ampliado de variantes:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts`
- Resultado observado: 4 fallos y 28 pruebas pasaron.
- Variantes reproducidas: unidad Windows en minúscula sin extensión, ruta Unix arbitraria, abreviatura postal `C/` y variable `OPENAI_API_KEY`.

GREEN de privacidad y protocolo:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts tests/assistant/stream-protocol.test.ts`
- Resultado: 2 archivos, 49 tests pasaron, 0 fallos.

GREEN focalizado final:

- Comando: `pnpm exec vitest run tests/assistant tests/top-nav.test.tsx tests/tables-view.test.tsx`
- Resultado: 6 archivos, 86 tests pasaron, 2 omitidos, 0 fallos.

Suite completa final:

- Comando: `pnpm test`
- Resultado: 27 archivos, 198 tests pasaron, 4 omitidos, 0 fallos.

### Sustitución de blacklist por allowlist positiva

RED:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts`
- Resultado observado: 11 fallos y 34 pruebas pasaron.
- Fallos reproducidos: texto con identificadores aún se redactaba y persistía; rutas relativas, ZIP y secretos variados atravesaban la blacklist; preguntas libres o parecidas a la terminología aprobada y plantillas de análisis en conversación general no fallaban cerradas.

GREEN de contrato:

- Comando: `pnpm exec vitest run tests/assistant/domain.test.ts`
- Resultado: 1 archivo, 45 tests pasaron, 0 fallos.
- Contrato: conversación general admite solo tres prompts exactos aprobados; conversación de análisis admite solo `Revisa a matrícula <id>` o `Consulta la matrícula <id>`, tras sustituir un nombre conocido, y exige que la matrícula exista entre las referencias conocidas. Todo lo demás usa el mismo error constante.

GREEN focalizado final:

- Comando: `pnpm exec vitest run tests/assistant tests/top-nav.test.tsx tests/tables-view.test.tsx`
- Resultado: 6 archivos, 99 tests pasaron, 2 omitidos, 0 fallos.

Suite completa final tras allowlist:

- Comando: `pnpm test`
- Resultado: 27 archivos, 211 tests pasaron, 4 omitidos, 0 fallos.

## Dependencias

Auditoría previa:

- `src/lib/storage/analysisStorage.ts` ya contenía un helper nativo de IndexedDB, suficiente como patrón; se descartó `idb` para no añadir dependencia de producción ni bundle.
- `package.json`, `pnpm-lock.yaml` y `pnpm list fake-indexeddb --depth 0` confirmaron que no había utilidad equivalente para tests.

Decisión:

- Añadido `fake-indexeddb` `6.2.4` con versión exacta y solo como `devDependency`.
- Finalidad: pruebas deterministas de IndexedDB, cursores, transacciones y cuota en Node/jsdom.
- Impacto en bundle de producción: ninguno.

## Revisión de invariantes

- `/api/analyze`: sin cambios.
- Cálculos y `AnalysisResult`: sin cambios; `getPersonProfile` proyecta directamente `registroTotal`, `pdfTotal` y `totalDifference` de `AnalysisResult.people`.
- NDJSON: único protocolo del adaptador falso; validación Zod discriminada por línea, sin regex, Markdown ni HTML.
- Conversación general: el contrato del adaptador recibe exclusivamente el prompt estático, pregunta sanitizada y `messageId`; no puede recibir el análisis activo, personas, nóminas o Registro.
- Persistencia: base separada `retributivo-assistant-v1`, 15 stores requeridos, cursores en mensajes, sin `localStorage`, `sessionStorage` ni cifrado casero.
- Privacidad del slice: el texto del compositor solo vive en estado local y se limpia al enviar/desmontar. No se intenta clasificar ni redactar texto libre en Fase 1. Solo se persisten tres prompts generales exactos y dos plantillas de análisis estructuradas; nombres conocidos se sustituyen por una matrícula validada antes de comprobar la plantilla. Cualquier otro texto, incluidos nombres, identificadores, direcciones, archivos, rutas o secretos, falla cerrado con un error constante que no incluye el valor.
- Aislamiento general: una conversación general no recorre `activeAnalysis.people`; un getter instrumentado verificó cero lecturas antes de conversión explícita.
- Persistencia: se exponen repositorios para los 15 stores, la conversión persiste `context_added` en la misma transacción y los cursores incluyen clave de índice y clave primaria.
- Herramientas y stream: la allowlist de Fase 1 admite solo `getPersonProfile`; el propio schema NDJSON exige `tool: "getPersonProfile"` y args estrictos `{ analysisId, personId }`, rechazando herramientas desconocidas, campos extra o args incompletos en el decoder. Ambos streams restauran estado en `finally` y publican errores sanitizados.
- Estado global: no se añadieron claves, secretos ni deltas de streaming a `AppState`; todo el stream vive en `AssistantProvider`.
- No se añadieron Worker, proveedores reales ni rutas nuevas.

## Verificación técnica y preocupaciones

- `git diff --check`: sin errores.
- TypeScript: `pnpm exec tsc --noEmit --pretty false` conserva 29 líneas de errores preexistentes en fixtures/tests fuera de Fase 1; filtro sobre `src/components/assistant`, `src/lib/assistant`, `DashboardApp`, `TopNav` y `src/lib/types` devolvió `NONE`.
- Advertencias no bloqueantes heredadas: aviso de API CJS de Vite y mensajes jsdom `Not implemented: navigation to another Document`.
- La sanitización de texto libre, la sanitización documental recursiva y `assertSafeForPersistence` para corpus/metadata pertenecen a Fase 2. Fase 1 evita persistir texto libre mediante allowlist positiva exacta.
