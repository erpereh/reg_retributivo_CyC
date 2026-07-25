# Reference UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing application page visually match the approved reference while retaining the current functional behavior.

**Architecture:** Update shared shell and primitive components first, then simplify the dashboard markup and apply a final shared reference-theme stylesheet to all data and assistant surfaces. Keep business logic untouched. Add structural tests that verify navigation labels and visual-system contracts.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Vitest, Playwright.

## Global Constraints

- Preserve all existing pages and functionality.
- Navigation items contain only icon and label.
- Replace the user card with real active-analysis metadata.
- Use minimal card shadows and no decorative dashboard hero.
- Validate with all real files in `fuentes`.
- Leave changes uncommitted on `main`.

---

### Task 1: Shell and navigation parity

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/app/reference-ui.css`
- Test: `tests/components/referenceShell.test.tsx`

- [ ] Write a shell test asserting the brand, navigation labels, analysis footer and labelled assistant action.
- [ ] Run the test and confirm it fails on the old shell.
- [ ] Refactor shell markup without changing view selection behavior.
- [ ] Run the test and confirm it passes.

### Task 2: Shared surfaces and typography

**Files:**
- Modify: `src/components/common/Card.tsx`
- Modify: `src/components/common/PageHeader.tsx`
- Modify: `src/components/common/DataTableShell.tsx`
- Modify: `src/app/reference-ui.css`
- Test: `tests/components/referencePrimitives.test.tsx`

- [ ] Add tests for flat card and compact page/table primitives.
- [ ] Verify failing tests.
- [ ] Implement neutral borders, restrained radii and no default shadow.
- [ ] Verify passing tests.

### Task 3: Dashboard parity

**Files:**
- Modify: `src/components/dashboard/DashboardView.tsx`
- Modify: `src/app/reference-ui.css`
- Test: `tests/components/referenceDashboard.test.tsx`

- [ ] Add a failing test proving the dashboard uses a normal page heading and has no promotional hero elements.
- [ ] Replace the hero with the approved compact dashboard structure.
- [ ] Verify the focused test.

### Task 4: Tables and assistant parity

**Files:**
- Modify: `src/app/reference-ui.css`
- Modify only if required by observed defects: `src/components/assistant/*.tsx`, `src/components/tables/TablesView.tsx`
- Test: existing assistant and table tests plus visual E2E.

- [ ] Apply shared table, toolbar, drawer, assistant message and composer styling.
- [ ] Run existing focused tests.
- [ ] Fix only defects reproduced by tests or visual review.

### Task 5: Real-fixture visual validation

**Files:**
- Modify: `tests/e2e/real-fixtures.spec.ts` only if required for deterministic tab capture.
- Create: `outputs/reference-ui-final/*.png`

- [ ] Install dependencies and browser runtime.
- [ ] Run unit tests and production build.
- [ ] Start the app and upload all PDFs and the Excel from `fuentes`.
- [ ] Capture Inicio, Personas, Conceptos, Cuadre, Agrupaciones, Asistente, Historial and Ajustes separately.
- [ ] Inspect screenshots, correct defects and rerun validation.
- [ ] Confirm branch `main`, list the uncommitted diff and package screenshots for review.
