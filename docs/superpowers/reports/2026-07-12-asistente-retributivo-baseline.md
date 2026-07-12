# Asistente Retributivo — Baseline de verificación

**Ejecución:** 2026-07-13, Europe/Madrid
**Worktree:** `C:\Users\david\.codex\worktrees\reg-retributivo-cyc\asistente-retributivo`
**Rama:** `codex/asistente-retributivo`
**Base funcional:** `27566f6 style: refine application surfaces and navigation`
**Documentación del Asistente:** `85a32a4 docs(ai): define assistant design and phased plan`

## Estado Git inicial

- `git status --short`: vacío.
- `git stash list`: vacío; no se creó, alteró ni eliminó ningún stash.
- Últimos commits antes de la fase:
  - `85a32a4 docs(ai): define assistant design and phased plan`
  - `27566f6 style: refine application surfaces and navigation`
  - `6ab7be8 feat: redesign application interface`
  - `73b9ef5 chore: install Codex UI design skills`
  - `6e88da1 normalizado ajustes v1`

## Entorno

- Node.js: `v24.15.0`.
- pnpm: `11.5.0`.
- `pnpm install --frozen-lockfile`: código 0.
- Condición ambiental no bloqueante: el paquete transitivo opcional `canvas@2.11.2` no encontró binario para Node ABI 137 y tampoco pudo compilar sin Visual Studio C++; pnpm completó la instalación y el repositorio no declara `canvas` como dependencia directa.

## Tests

Comando: `cmd /c pnpm test`

- Código: 0.
- 23 archivos superados de 23.
- 136 tests superados.
- 4 tests omitidos de 140, ya marcados como `skip` en `domain.test.ts` y `tables-view.test.tsx`.
- Advertencias preexistentes:
  - API CJS de Vite deprecada.
  - jsdom informa `Not implemented: navigation to another Document` durante el test de exportación.

## TypeScript

Comando: `cmd /c pnpm exec tsc --noEmit --incremental false`

- Código: 1.
- Clasificación: errores preexistentes en fixtures y mocks; no hay código del Asistente en la rama durante esta medición.
- Grupos reproducidos:
  - `tests/charts-panel.test.tsx`: fixtures `AnalysisResult` sin `excludedEmployeeIdsApplied`.
  - `tests/cuadre-excel-view.test.tsx`: arrays inferidos como `never[]` y spread sobre tipo no inferido.
  - `tests/domain.test.ts`: `employeeNumber` duplicado en un fixture.
  - `tests/tables-view.test.tsx`: inferencia incompatible en grouped sheets y agrupaciones.
  - `tests/top-nav.test.tsx`: mock inferido con propiedades `undefined` demasiado estrechas.
- Decisión: no corregirlos en Fase 0; no bloquean el vertical slice ni el build y cambiarlos solo para limpiar la salida mezclaría trabajo no relacionado.

## Build

Comando: `cmd /c pnpm build`

- Código: 0.
- Next.js `15.5.19`.
- Compilación, validación interna, generación de 9 páginas y trazas completadas.
- Ruta `/`: 201 kB; First Load JS 303 kB.
- Rutas existentes confirmadas: `/api/ai/status`, `/api/ai/test`, `/api/analyze`, `/api/explain`, `/api/export`.
- Los fallos de manifest/prerender observados anteriormente no se reprodujeron en el worktree limpio; se clasifican como estado ambiental/de caché anterior, no como fallo actual del código.

## Integridad del árbol

- `git diff --check`: código 0.
- Antes de crear este informe, `git status --short`: vacío.
- `.next/` y `node_modules/` son ignorados y no se incluyen en Git.

## Regla para fases posteriores

- No afirmar que TypeScript global está limpio mientras persistan los errores anteriores.
- Comparar cualquier salida posterior contra los grupos documentados aquí y distinguir errores nuevos.
- Mantener tests, TypeScript y build secuenciales; nunca ejecutar build y `tsc` en paralelo por competir con `.next/types`.
