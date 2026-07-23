# Client-Oriented UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the application UI as a polished client-facing product with real global search, system/light/dark themes, five accent colors, clearer operational views, and responsive three-panel assistant behavior while preserving all existing payroll logic and privacy guarantees.

**Architecture:** Keep `AppStateProvider`, `AssistantProvider`, parsers, calculations, IndexedDB repositories, exports, and API routes as the source of truth. Add an independent visual-preferences layer, presentation selectors, focused view components, and reusable interface primitives. Existing `AppView` values remain stable so stored state, keyboard navigation, assistant actions, and regression tests do not lose their contracts.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.7, Tailwind CSS 4, Motion 12, Lucide React, Recharts, Vitest 2, Testing Library, Playwright 1.61, IndexedDB, localStorage.

## Global Constraints

- Work on `ui/retributivo-modern-redesign`, which must stay based on the current `main` branch.
- Do not add authentication, accounts, users, organizations, roles, multi-company selection, billing, or cloud collaboration.
- Do not show demo people, demo metrics, fabricated activity, or invented documents.
- Preserve salary calculations, parsers, matching, storage schema behavior, exports, cleanup jobs, assistant tools, and privacy restrictions.
- The default appearance is `system`; manual `light` and `dark` selections persist locally.
- Supported accents are exactly `violet`, `blue`, `emerald`, `orange`, and `rose`; `violet` is the default.
- Differences remain filters inside Personas and Conceptos, not a primary navigation item.
- Documents and sources remain inside Inicio and Historial, not a primary navigation item.
- Cuadre del registro exposes exactly three internal tabs: `Cuadre`, `Normalizados`, and `Variables`.
- The assistant retains three functional panels on desktop and drawers on smaller breakpoints.
- All new interactive controls must support keyboard use, visible focus, AA contrast, and `prefers-reduced-motion`.
- Theme changes, filters, navigation, and search must never rerun the payroll analysis.
- Every implementation task follows red-green-refactor, ends with focused tests, and receives its own commit.

---

## File Structure

### New theme and UI preference modules

- `src/lib/theme/themePreferences.ts`: appearance/accent types, validation, storage, and effective-theme resolution.
- `src/components/theme/ThemeProvider.tsx`: React context, system-media subscription, DOM attributes, and preference mutations.
- `src/components/theme/ThemeScript.tsx`: pre-hydration script that applies saved appearance without a flash.
- `src/lib/ui/uiPreferences.ts`: sidebar persistence and other shell-only preferences.

### New search modules

- `src/lib/search/globalSearch.ts`: typed index entries, normalization, ranking, grouping, and result limits.
- `src/components/search/GlobalSearch.tsx`: topbar search dialog with keyboard navigation.
- `src/components/search/GlobalSearchResult.tsx`: focused rendering for each result type.

### New shared presentation modules

- `src/components/common/FilterBar.tsx`: consistent search/filter/quick-filter layout.
- `src/components/common/DetailDrawer.tsx`: accessible desktop side panel and mobile full-screen drawer.
- `src/components/common/MetricCard.tsx`: semantic metrics with restrained animation.
- `src/components/common/ProcessingState.tsx`: analysis progress and current phase.
- `src/components/common/ErrorState.tsx`: persistent recoverable/blocking error presentation.

### Split domain views

- `src/components/people/PersonasView.tsx`
- `src/components/people/PersonDetailDrawer.tsx`
- `src/components/concepts/ConceptosView.tsx`
- `src/components/concepts/ConceptDetailDrawer.tsx`
- `src/components/cuadre-excel/CuadreBreakdownPanel.tsx`
- `src/components/cuadre-excel/CuadreNormalizedPanel.tsx`
- `src/components/cuadre-excel/CuadreVariablesPanel.tsx`
- `src/components/dashboard/AnalysisFilesCard.tsx`
- `src/components/dashboard/DashboardQuickActions.tsx`
- `src/components/dashboard/AssistantBanner.tsx`
- `src/components/groupings/GroupingDetailDrawer.tsx`
- `src/components/history/HistoryDetailDrawer.tsx`
- `src/components/settings/AppearanceSettings.tsx`
- `src/components/settings/ThemeSelector.tsx`
- `src/components/settings/AccentSelector.tsx`

### Test layout

- `tests/theme/themePreferences.test.ts`
- `tests/theme/ThemeProvider.test.tsx`
- `tests/ui/globalSearch.test.ts`
- `tests/ui/GlobalSearch.test.tsx`
- `tests/ui/AppShell.test.tsx`
- `tests/ui/DashboardView.test.tsx`
- `tests/ui/PersonasView.test.tsx`
- `tests/ui/ConceptosView.test.tsx`
- `tests/ui/CuadreExcelView.test.tsx`
- `tests/ui/SettingsView.test.tsx`
- `tests/ui/AssistantShell.test.tsx`
- `tests/e2e/client-ui-redesign.spec.ts`
- `tests/e2e/ui-redesign-screenshots.spec.ts`

---

### Task 1: Theme preference foundation and no-flash bootstrap

**Files:**
- Create: `src/lib/theme/themePreferences.ts`
- Create: `src/components/theme/ThemeProvider.tsx`
- Create: `src/components/theme/ThemeScript.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/theme/themePreferences.test.ts`
- Test: `tests/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Produces:
  - `type AppearanceMode = "system" | "light" | "dark"`
  - `type AccentColor = "violet" | "blue" | "emerald" | "orange" | "rose"`
  - `interface ThemePreferences { mode: AppearanceMode; accent: AccentColor }`
  - `DEFAULT_THEME_PREFERENCES`
  - `readThemePreferences(storage?: Storage): ThemePreferences`
  - `writeThemePreferences(value: ThemePreferences, storage?: Storage): void`
  - `resolveEffectiveTheme(mode: AppearanceMode, systemDark: boolean): "light" | "dark"`
  - `useTheme(): ThemeContextValue`
- Consumes: browser `localStorage`, `matchMedia("(prefers-color-scheme: dark)")`, and `document.documentElement.dataset`.

- [ ] **Step 1: Write failing preference tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCES,
  readThemePreferences,
  resolveEffectiveTheme,
  writeThemePreferences,
} from "@/lib/theme/themePreferences";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe("themePreferences", () => {
  it("uses system and violet by default", () => {
    expect(readThemePreferences(memoryStorage())).toEqual(DEFAULT_THEME_PREFERENCES);
  });

  it("rejects unsupported stored values", () => {
    const storage = memoryStorage();
    storage.setItem("retributivo.appearance.v1", JSON.stringify({ mode: "sepia", accent: "lime" }));
    expect(readThemePreferences(storage)).toEqual({ mode: "system", accent: "violet" });
  });

  it("persists and restores a supported preference", () => {
    const storage = memoryStorage();
    writeThemePreferences({ mode: "dark", accent: "emerald" }, storage);
    expect(readThemePreferences(storage)).toEqual({ mode: "dark", accent: "emerald" });
  });

  it("resolves system mode from the media query", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });
});
```

- [ ] **Step 2: Run the preference tests and confirm red state**

Run: `pnpm exec vitest run tests/theme/themePreferences.test.ts`

Expected: FAIL because `@/lib/theme/themePreferences` does not exist.

- [ ] **Step 3: Implement validated storage and theme resolution**

```ts
export type AppearanceMode = "system" | "light" | "dark";
export type AccentColor = "violet" | "blue" | "emerald" | "orange" | "rose";
export interface ThemePreferences { readonly mode: AppearanceMode; readonly accent: AccentColor }

export const THEME_STORAGE_KEY = "retributivo.appearance.v1";
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = { mode: "system", accent: "violet" };
const MODES: readonly AppearanceMode[] = ["system", "light", "dark"];
const ACCENTS: readonly AccentColor[] = ["violet", "blue", "emerald", "orange", "rose"];

export function readThemePreferences(storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): ThemePreferences {
  if (!storage) return DEFAULT_THEME_PREFERENCES;
  try {
    const value = JSON.parse(storage.getItem(THEME_STORAGE_KEY) ?? "null") as Partial<ThemePreferences> | null;
    return {
      mode: value?.mode && MODES.includes(value.mode) ? value.mode : DEFAULT_THEME_PREFERENCES.mode,
      accent: value?.accent && ACCENTS.includes(value.accent) ? value.accent : DEFAULT_THEME_PREFERENCES.accent,
    };
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(value: ThemePreferences, storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): void {
  storage?.setItem(THEME_STORAGE_KEY, JSON.stringify(value));
}

export function resolveEffectiveTheme(mode: AppearanceMode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}
```

- [ ] **Step 4: Write provider tests for DOM attributes and system changes**

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme/ThemeProvider";

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

it("applies mode and accent to the root element", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
  const { result } = renderHook(() => useTheme(), { wrapper });
  act(() => result.current.setAccent("rose"));
  act(() => result.current.setMode("dark"));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.accent).toBe("rose");
});
```

- [ ] **Step 5: Implement provider and pre-hydration script**

```tsx
export interface ThemeContextValue {
  readonly mode: AppearanceMode;
  readonly effectiveTheme: "light" | "dark";
  readonly accent: AccentColor;
  readonly setMode: (mode: AppearanceMode) => void;
  readonly setAccent: (accent: AccentColor) => void;
  readonly resetTheme: () => void;
}
```

`ThemeProvider` must subscribe only while `mode === "system"`, set `data-theme` and `data-accent` on `<html>`, update `color-scheme`, and persist every explicit change. `ThemeScript` must emit an inline script using the same storage key and validation lists before React content renders.

- [ ] **Step 6: Wrap the application in `ThemeProvider` and render `ThemeScript` in `<head>`**

```tsx
<html lang="es" suppressHydrationWarning>
  <head><ThemeScript /></head>
  <body><ThemeProvider>{children}</ThemeProvider></body>
</html>
```

- [ ] **Step 7: Run focused tests**

Run: `pnpm exec vitest run tests/theme/themePreferences.test.ts tests/theme/ThemeProvider.test.tsx`

Expected: both files PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/theme src/components/theme src/app/layout.tsx tests/theme
git commit -m "feat(ui): add persistent theme foundation"
```

---

### Task 2: Central design tokens and reusable primitives

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/common/Card.tsx`
- Modify: `src/components/common/DataTableShell.tsx`
- Modify: `src/components/common/SectionHeader.tsx`
- Modify: `src/components/common/SectionTabs.tsx`
- Modify: `src/components/common/ModalShell.tsx`
- Modify: `src/components/common/EmptyState.tsx`
- Create: `src/components/common/FilterBar.tsx`
- Create: `src/components/common/DetailDrawer.tsx`
- Create: `src/components/common/MetricCard.tsx`
- Create: `src/components/common/ProcessingState.tsx`
- Create: `src/components/common/ErrorState.tsx`
- Test: `tests/ui/commonPrimitives.test.tsx`

**Interfaces:**
- Produces visual-only primitives that receive React content and callbacks; none may import parsers, storage, or analysis services.
- `DetailDrawer` props: `{ open: boolean; title: string; description?: string; onClose(): void; children: ReactNode; footer?: ReactNode }`.
- `FilterBar` props: `{ search?: ReactNode; filters?: ReactNode; quickFilters?: ReactNode; actions?: ReactNode }`.
- `MetricCard` props: `{ label: string; value: ReactNode; hint?: string; icon?: LucideIcon; tone?: "neutral" | "primary" | "success" | "warning" | "danger" }`.

- [ ] **Step 1: Write failing accessibility tests for the drawer and tabs**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DetailDrawer } from "@/components/common/DetailDrawer";

it("closes the detail drawer with Escape and restores the trigger", () => {
  const onClose = vi.fn();
  render(<DetailDrawer open title="Detalle" onClose={onClose}><p>Contenido</p></DetailDrawer>);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog", { name: "Detalle" })).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/commonPrimitives.test.tsx`

Expected: FAIL because `DetailDrawer` does not exist.

- [ ] **Step 3: Define theme-neutral semantic tokens**

In `globals.css`, define canvas, surfaces, text, borders, accent, semantic states, radius, shadows, motion durations, and focus ring through CSS custom properties under `:root`, `[data-theme="dark"]`, and each `[data-accent]`. Components must use variables such as `--surface`, `--surface-elevated`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-soft`, and `--focus-ring` instead of fixed blue/white/slate values.

```css
:root {
  --canvas: #f6f7f9;
  --surface: #ffffff;
  --surface-elevated: #ffffff;
  --text: #181a22;
  --text-muted: #6d7280;
  --border: #e5e7ec;
  --radius-control: 0.75rem;
  --radius-card: 1rem;
  --motion-fast: 140ms;
  --motion-normal: 220ms;
}
[data-theme="dark"] {
  --canvas: #101116;
  --surface: #171920;
  --surface-elevated: #1d2028;
  --text: #f4f5f7;
  --text-muted: #a5aab5;
  --border: #2d3039;
}
[data-accent="violet"] { --accent: #6d5dfc; --accent-hover: #5b4be7; --accent-soft: #efedff; --accent-contrast: #ffffff; }
[data-accent="blue"] { --accent: #2563eb; --accent-hover: #1d4ed8; --accent-soft: #eaf1ff; --accent-contrast: #ffffff; }
[data-accent="emerald"] { --accent: #0f9f6e; --accent-hover: #0b845b; --accent-soft: #e5f8f1; --accent-contrast: #ffffff; }
[data-accent="orange"] { --accent: #e46f19; --accent-hover: #c75d10; --accent-soft: #fff0e4; --accent-contrast: #ffffff; }
[data-accent="rose"] { --accent: #df3f77; --accent-hover: #c62f65; --accent-soft: #ffeaf1; --accent-contrast: #ffffff; }
```

- [ ] **Step 4: Implement primitives with focus management and reduced motion**

`DetailDrawer` uses `role="dialog"`, `aria-modal="true"`, an explicit close button, document Escape handling, focus on its heading when opened, and a backdrop. `SectionTabs` preserves arrow, Home, and End behavior. Table and card primitives use the new tokens and never color entire data rows solely by status.

- [ ] **Step 5: Run focused tests and production CSS compilation**

Run: `pnpm exec vitest run tests/ui/commonPrimitives.test.tsx && pnpm build`

Expected: tests PASS and Next.js build exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/components/common tests/ui/commonPrimitives.test.tsx
git commit -m "feat(ui): centralize tokens and interface primitives"
```

---

### Task 3: Responsive shell, real navigation context, and persisted sidebar

**Files:**
- Create: `src/lib/ui/uiPreferences.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/app/DashboardApp.tsx`
- Test: `tests/ui/AppShell.test.tsx`

**Interfaces:**
- Produces `readUiPreferences`, `writeUiPreferences`, and `{ sidebarCollapsed: boolean }` under `retributivo.ui.v1`.
- Consumes `activeAnalysis`, `result`, `view`, `setView`, `exportActiveAnalysis`, and `resetForNewAnalysis` from `useAppState()`.
- Keeps the existing `role="tablist"`, `role="tab"`, `aria-selected`, labels, and AppView IDs.

- [ ] **Step 1: Write failing shell tests**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AppShell } from "@/components/layout/AppShell";

it("renders the approved primary navigation without a user profile", () => {
  render(<AppShell><div>Vista</div></AppShell>);
  for (const label of ["Inicio", "Personas", "Conceptos", "Cuadre del registro", "Agrupaciones", "Asistente", "Historial", "Ajustes"]) {
    expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
  }
  expect(screen.queryByText(/usuario|administrador|empresa demo/i)).not.toBeInTheDocument();
});

it("supports vertical and legacy horizontal arrow navigation", () => {
  render(<AppShell><div>Vista</div></AppShell>);
  const inicio = screen.getByRole("tab", { name: "Inicio" });
  inicio.focus();
  fireEvent.keyDown(inicio, { key: "ArrowDown" });
  expect(screen.getByRole("tab", { name: "Personas" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Personas" }), { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Conceptos" })).toHaveFocus();
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/AppShell.test.tsx`

Expected: FAIL because labels and shell behavior still reflect the previous design.

- [ ] **Step 3: Rebuild navigation and topbar around approved labels**

Use this exact primary mapping while retaining the current AppView values:

```ts
const NAVIGATION = [
  { id: "dashboard", label: "Inicio" },
  { id: "personas", label: "Personas" },
  { id: "conceptos", label: "Conceptos" },
  { id: "cuadre-excel", label: "Cuadre del registro" },
  { id: "agrupaciones", label: "Agrupaciones" },
  { id: "asistente", label: "Asistente" },
  { id: "historial", label: "Historial" },
  { id: "ajustes", label: "Ajustes" },
] as const;
```

The context block shows only real analysis data: created date, PDF count, registro file name, and status. With no active analysis it displays `Sin análisis activo` and a neutral icon. Do not render initials, avatars, names, roles, or organizations.

- [ ] **Step 4: Persist collapsed state and restore it before interaction**

```ts
export interface UiPreferences { readonly sidebarCollapsed: boolean }
export const DEFAULT_UI_PREFERENCES: UiPreferences = { sidebarCollapsed: false };
```

Read once in the `useState` initializer, write after user toggles, keep mobile drawer state transient, and ensure the assistant layout still occupies the full viewport.

- [ ] **Step 5: Run shell tests and existing navigation regressions**

Run: `pnpm exec vitest run tests/ui/AppShell.test.tsx tests/app-state.test.tsx tests/accessibility.test.tsx`

Expected: PASS. If an existing file name differs, use `find tests -type f | sort` and run the exact existing files containing AppShell/navigation assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/uiPreferences.ts src/components/layout/AppShell.tsx src/components/app/DashboardApp.tsx tests/ui/AppShell.test.tsx
git commit -m "feat(ui): rebuild responsive application shell"
```

---

### Task 4: Real global search and direct navigation

**Files:**
- Create: `src/lib/search/globalSearch.ts`
- Create: `src/components/search/GlobalSearch.tsx`
- Create: `src/components/search/GlobalSearchResult.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/app/AppState.tsx`
- Test: `tests/ui/globalSearch.test.ts`
- Test: `tests/ui/GlobalSearch.test.tsx`

**Interfaces:**
- Produces:

```ts
export type GlobalSearchKind = "person" | "concept" | "document" | "analysis";
export interface GlobalSearchEntry {
  readonly id: string;
  readonly kind: GlobalSearchKind;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
  readonly target:
    | { readonly kind: "person"; readonly employeeNumber: string }
    | { readonly kind: "concept"; readonly value: string }
    | { readonly kind: "document"; readonly fileName: string }
    | { readonly kind: "analysis"; readonly analysisId: string };
}
export function buildGlobalSearchIndex(input: { readonly result?: AnalysisResult; readonly activeAnalysis?: StoredAnalysis; readonly history: readonly StoredAnalysis[] }): readonly GlobalSearchEntry[];
export function searchGlobalIndex(entries: readonly GlobalSearchEntry[], query: string, limit?: number): readonly GlobalSearchEntry[];
```

- Adds to AppState:

```ts
readonly globalNavigationTarget?: GlobalSearchEntry["target"];
readonly openGlobalSearchTarget: (target: GlobalSearchEntry["target"]) => Promise<void>;
readonly consumeGlobalNavigationTarget: () => void;
```

- [ ] **Step 1: Write failing ranking tests**

```ts
import { expect, it } from "vitest";
import { searchGlobalIndex, type GlobalSearchEntry } from "@/lib/search/globalSearch";

const entries: GlobalSearchEntry[] = [
  { id: "person-0012", kind: "person", title: "0012", subtitle: "Ana Pérez", keywords: ["0012", "Ana Pérez"], target: { kind: "person", employeeNumber: "0012" } },
  { id: "concept-0012", kind: "concept", title: "Plus 0012", subtitle: "Complemento", keywords: ["Plus 0012"], target: { kind: "concept", value: "Plus 0012" } },
];

it("ranks exact employee number before partial concept text", () => {
  expect(searchGlobalIndex(entries, "0012").map((item) => item.id)).toEqual(["person-0012", "concept-0012"]);
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/globalSearch.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalized index and deterministic ranking**

Normalize with the existing `normalizeComparableText`. Score exact title `100`, exact keyword `90`, title prefix `70`, keyword prefix `60`, title contains `40`, keyword contains `30`. Sort by score descending, then title with `localeCompare("es")`, and cap at 30 by default. Index only loaded data.

- [ ] **Step 4: Implement AppState navigation contract**

- Person: set target, set filters query to the employee number, switch to `personas`.
- Concept: set target, set filters query to the concept value, switch to `conceptos`.
- Document: set target and switch to `dashboard`.
- Analysis: call `openStoredAnalysis(analysisId)`, set target, then switch to `historial` so the historical detail is visible.

- [ ] **Step 5: Write dialog interaction tests**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/search/GlobalSearch";

it("opens with Cmd/Ctrl K and activates the highlighted result", () => {
  const onSelect = vi.fn();
  render(<GlobalSearch entries={[{ id: "p1", kind: "person", title: "0001", subtitle: "Ana", keywords: ["Ana"], target: { kind: "person", employeeNumber: "0001" } }]} onSelect={onSelect} />);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "0001" } });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith({ kind: "person", employeeNumber: "0001" });
});
```

- [ ] **Step 6: Integrate the search in the topbar**

The topbar control displays `Buscar personas, conceptos, documentos…`, the shortcut badge, grouped result headings, an empty state, Escape close, arrow navigation, and focus restoration. Search remains local and never calls a network endpoint.

- [ ] **Step 7: Run focused tests**

Run: `pnpm exec vitest run tests/ui/globalSearch.test.ts tests/ui/GlobalSearch.test.tsx tests/ui/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/search src/components/search src/components/layout/AppShell.tsx src/components/app/AppState.tsx tests/ui/globalSearch.test.ts tests/ui/GlobalSearch.test.tsx
git commit -m "feat(ui): add real global search"
```

---

### Task 5: Client-facing Inicio with real empty, processing, and active states

**Files:**
- Modify: `src/components/dashboard/DashboardView.tsx`
- Modify: `src/components/upload/UploadPanel.tsx`
- Modify: `src/components/dashboard/SummaryCards.tsx`
- Modify: `src/components/dashboard/ChartsPanel.tsx`
- Create: `src/components/dashboard/AnalysisFilesCard.tsx`
- Create: `src/components/dashboard/DashboardQuickActions.tsx`
- Create: `src/components/dashboard/AssistantBanner.tsx`
- Create: `src/components/common/ProcessingState.tsx`
- Test: `tests/ui/DashboardView.test.tsx`

**Interfaces:**
- Empty state consumes `pdfFiles`, `registroFile`, `history`, `status`, `error`, and `analyzing`.
- Active state consumes only `activeAnalysis` and `result` metrics already calculated.
- `DashboardQuickActions` receives `onPeople`, `onConcepts`, and `onCuadre` callbacks.

- [ ] **Step 1: Write failing empty-state test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DashboardView } from "@/components/dashboard/DashboardView";

it("shows a real three-step onboarding and no fabricated metrics without analysis", () => {
  render(<DashboardView />);
  expect(screen.getByText("1. Carga los recibos PDF")).toBeInTheDocument();
  expect(screen.getByText("2. Carga el Registro Retributivo")).toBeInTheDocument();
  expect(screen.getByText("3. Ejecuta el análisis")).toBeInTheDocument();
  expect(screen.queryByText(/120 personas|última actividad|empresa demo/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/DashboardView.test.tsx`

Expected: FAIL because the approved onboarding copy and state split are absent.

- [ ] **Step 3: Separate dashboard branches explicitly**

```tsx
if (!activeAnalysis || !result) {
  return <DashboardEmptyState />;
}
return <DashboardActiveState analysis={activeAnalysis} result={result} />;
```

`DashboardEmptyState` contains the three-step flow, UploadPanel, persistent error messaging, processing state, and history shortcut only when `history.length > 0`. It renders no `SummaryCards` or `ChartsPanel`.

- [ ] **Step 4: Redesign UploadPanel around file lists and actionable validation**

Show accepted extensions, selected files with remove actions, counts and names, separate PDF/Excel drop areas, tolerance as an advanced compact control, and one primary `Analizar` button. Filter invalid dropped files and expose a persistent message listing the unsupported file names.

- [ ] **Step 5: Build active dashboard from real values only**

Render metrics for people, PDFs, total global difference, and global state; files from `activeAnalysis.pdfCount` and `registroFileName`; existing warning/result collections; quick links; charts only when their source array contains data; and an assistant banner that switches to `asistente`.

- [ ] **Step 6: Run focused and upload regression tests**

Run: `pnpm exec vitest run tests/ui/DashboardView.test.tsx tests/upload*.test.tsx tests/app-state.test.tsx`

Expected: PASS; if the shell glob matches no file, enumerate existing upload tests with `find tests -type f -iname '*upload*'` and run those exact paths.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard src/components/upload/UploadPanel.tsx src/components/common/ProcessingState.tsx tests/ui/DashboardView.test.tsx
git commit -m "feat(ui): rebuild client-facing dashboard"
```

---

### Task 6: Split Personas and Conceptos into focused operational views

**Files:**
- Create: `src/components/people/PersonasView.tsx`
- Create: `src/components/people/PersonDetailDrawer.tsx`
- Create: `src/components/concepts/ConceptosView.tsx`
- Create: `src/components/concepts/ConceptDetailDrawer.tsx`
- Modify: `src/components/tables/TablesView.tsx`
- Modify: `src/components/app/DashboardApp.tsx`
- Reuse: `src/components/tables/PersonDetail.tsx`
- Reuse: `src/components/settings/concept-map/ConceptMapEditor.tsx`
- Test: `tests/ui/PersonasView.test.tsx`
- Test: `tests/ui/ConceptosView.test.tsx`

**Interfaces:**
- `TablesView` remains as a compatibility adapter but delegates `personas` and `conceptos` to the new components.
- Personas consumes `result.people`, `filters`, `setFilters`, and `globalNavigationTarget`.
- Conceptos consumes `result.concepts`, `result.unmappedConcepts`, `settings.conceptMap`, `saveConceptMapAndRefresh`, and `globalNavigationTarget`.
- Neither view recomputes analysis rows.

- [ ] **Step 1: Write failing Personas filters test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PersonasView } from "@/components/people/PersonasView";

it("offers approved difference filters inside Personas", () => {
  render(<PersonasView />);
  for (const label of ["Todas", "Cuadradas", "Revisar", "Diferencia", "Sin PDF", "Sin registro"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "Diferencia" }));
  expect(screen.getByRole("button", { name: "Diferencia" })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Write failing Conceptos test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConceptosView } from "@/components/concepts/ConceptosView";

it("keeps mapping states and differences inside Conceptos", () => {
  render(<ConceptosView />);
  expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Solo con diferencias" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Editar mapeo" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/PersonasView.test.tsx tests/ui/ConceptosView.test.tsx`

Expected: FAIL because the split views do not exist.

- [ ] **Step 4: Implement PersonasView with a compact table and detail drawer**

Use quick status filters, local search, center/category filters, sortable columns, visible result count, fixed first column on desktop, and a compact mobile representation. Row status uses a badge plus icon/text; do not encode status only with the row background. Selecting a row opens `PersonDetailDrawer` with current `PersonDetail`, source files, periods, blocks, justified values, and assistant navigation action.

- [ ] **Step 5: Implement ConceptosView with real mapping edits**

Provide filters for block, status, source, economic impact, and difference existence. Combine mapped and unmapped sections without converting unmapped rows into mapped data. Opening Editar mapeo must reuse the existing mapping rules and call `saveConceptMapAndRefresh`; confirmation copy explicitly says the active analysis will be recalculated.

- [ ] **Step 6: Preserve compatibility adapter**

```tsx
export function TablesView({ mode }: Readonly<{ mode: "personas" | "conceptos" | "agrupaciones" }>) {
  if (mode === "personas") return <PersonasView />;
  if (mode === "conceptos") return <ConceptosView />;
  return <AgrupacionesView />;
}
```

- [ ] **Step 7: Run focused and existing table/assistant navigation tests**

Run: `pnpm exec vitest run tests/ui/PersonasView.test.tsx tests/ui/ConceptosView.test.tsx tests/**/*person*.test.tsx tests/**/*concept*.test.tsx tests/**/*assistant*navigation*.test.tsx`

Expected: PASS. Resolve shell-expanded paths before execution so Vitest receives real files.

- [ ] **Step 8: Commit**

```bash
git add src/components/people src/components/concepts src/components/tables/TablesView.tsx src/components/app/DashboardApp.tsx tests/ui/PersonasView.test.tsx tests/ui/ConceptosView.test.tsx
git commit -m "feat(ui): split people and concept workflows"
```

---

### Task 7: Rebuild Cuadre del registro with Cuadre, Normalizados, and Variables

**Files:**
- Create: `src/components/cuadre-excel/CuadreBreakdownPanel.tsx`
- Create: `src/components/cuadre-excel/CuadreNormalizedPanel.tsx`
- Create: `src/components/cuadre-excel/CuadreVariablesPanel.tsx`
- Modify: `src/components/cuadre-excel/CuadreExcelView.tsx`
- Test: `tests/ui/CuadreExcelView.test.tsx`

**Interfaces:**
- `type CuadreSection = "breakdown" | "normalized" | "variables"`.
- Breakdown consumes `result.internalExcelChecks`.
- Normalized consumes `result.internalExcelNormalizedVariablesChecks` and `result.normalizedVsReal` without changing their values.
- Variables consumes `result.normalizedVsReal`, `result.concepts`, and existing `possibleJustification`/detail fields; it adds no formula.
- Existing assistant intent `open_cuadre` maps `normalized_variables` to `normalized`, and existing person query behavior remains supported.

- [ ] **Step 1: Write failing tab contract test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CuadreExcelView } from "@/components/cuadre-excel/CuadreExcelView";

it("exposes exactly the three approved sections", () => {
  render(<CuadreExcelView />);
  expect(screen.getByRole("tab", { name: "Cuadre" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Normalizados" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Variables" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
  expect(screen.getByRole("tabpanel", { name: "Variables" })).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/CuadreExcelView.test.tsx`

Expected: FAIL because current labels and the Variables section differ.

- [ ] **Step 3: Extract each panel without altering row selectors**

Move existing breakdown table logic to `CuadreBreakdownPanel` and normalized-variables logic to `CuadreNormalizedPanel`. Keep `selectBreakdownProjection` and `selectNormalizedProjection` as the only projection helpers for those rows.

- [ ] **Step 4: Implement Variables from existing analysis evidence**

Render per-person values for normalized, normalized plus variables, complete period, real PDF, their existing differences, `possibleJustification`, status, and detail. Link a selected row to the associated concept rows by employee number for evidence display; do not calculate a new total or status.

- [ ] **Step 5: Use one shared FilterBar and summary model**

The parent owns query/status filters and active tab. Each panel derives its visible rows with `useMemo`. Summary cards show row count, OK count, non-OK count, maximum absolute existing difference, and sum of the panel's existing total-difference field.

- [ ] **Step 6: Run Cuadre and assistant intent tests**

Run: `pnpm exec vitest run tests/ui/CuadreExcelView.test.tsx tests/**/*cuadre*.test.ts tests/**/*cuadre*.test.tsx tests/**/*assistant*navigation*.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/cuadre-excel tests/ui/CuadreExcelView.test.tsx
git commit -m "feat(ui): organize registry reconciliation views"
```

---

### Task 8: Modernize Agrupaciones and Historial with real detail drawers

**Files:**
- Modify: `src/components/groupings/AgrupacionesView.tsx`
- Create: `src/components/groupings/GroupingDetailDrawer.tsx`
- Modify: `src/components/history/HistoryView.tsx`
- Create: `src/components/history/HistoryDetailDrawer.tsx`
- Test: `tests/ui/AgrupacionesView.test.tsx`
- Test: `tests/ui/HistoryView.test.tsx`

**Interfaces:**
- Grouping detail consumes existing `GroupingComparisonRow`, matching employee lists already available from the result, and exclusion counts.
- History detail consumes `StoredAnalysis`; open/export/delete continue calling `openStoredAnalysis`, `exportStoredAnalysis`, and `removeStoredAnalysis`.
- Historical data stays read-only except existing open/export/delete actions.

- [ ] **Step 1: Write failing grouping detail test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AgrupacionesView } from "@/components/groupings/AgrupacionesView";

it("opens a group detail with deterministic calculation evidence", () => {
  render(<AgrupacionesView />);
  fireEvent.click(screen.getAllByRole("row")[1]);
  expect(screen.getByRole("dialog", { name: /detalle de agrupación/i })).toBeVisible();
  expect(screen.getByText(/valor excel|recálculo|personas incluidas/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing history documents test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HistoryView } from "@/components/history/HistoryView";

it("shows documents in the selected historical analysis detail", () => {
  render(<HistoryView />);
  fireEvent.click(screen.getAllByRole("button", { name: /ver detalle/i })[0]);
  expect(screen.getByRole("dialog", { name: /detalle del análisis/i })).toBeVisible();
  expect(screen.getByText(/registro retributivo/i)).toBeInTheDocument();
  expect(screen.getByText(/recibos pdf/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/AgrupacionesView.test.tsx tests/ui/HistoryView.test.tsx`

Expected: FAIL because the new drawers and copy are absent.

- [ ] **Step 4: Implement grouping controls and detail**

Keep existing grouping types. Add block, metric, segment, and status filters; summary metrics; restrained status badges; and a drawer showing source sheet, Registro base, spreadsheet value, recalculation, PDF values, difference, people counts, matched counts, sex counts when present, and excluded counts. All displayed values come from the selected row or existing result collections.

- [ ] **Step 5: Implement history cards/table and detail**

Display active-analysis marker, created date, status, people, PDF count, registro file name, global difference, and current supported actions. Detail shows linked file metadata, warnings, summary, config, and read-only state. Keep confirmation before deletion and cleanup-policy selection exactly wired to existing behavior.

- [ ] **Step 6: Run focused and storage/cleanup regressions**

Run: `pnpm exec vitest run tests/ui/AgrupacionesView.test.tsx tests/ui/HistoryView.test.tsx tests/**/*history*.test.ts tests/**/*cleanup*.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/groupings src/components/history tests/ui/AgrupacionesView.test.tsx tests/ui/HistoryView.test.tsx
git commit -m "feat(ui): improve groupings and history details"
```

---

### Task 9: Re-skin and refine the three-panel assistant without changing its domain

**Files:**
- Modify: `src/components/assistant/AssistantShell.tsx`
- Modify: `src/components/assistant/ConversationSidebar.tsx`
- Modify: `src/components/assistant/ConversationTimeline.tsx`
- Modify: `src/components/assistant/ContextSidebar.tsx`
- Modify: `src/components/assistant/SourcePanel.tsx`
- Modify: `src/components/assistant/AssistantDrawer.tsx`
- Test: `tests/ui/AssistantShell.test.tsx`

**Interfaces:**
- Consumes the existing `AssistantContextValue` unchanged.
- Retains source opening, conversation create/select/rename/delete, context selection, people picker, context usage, and mobile drawer callbacks.
- Desktop layout: conversations / chat / context.
- Tablet: chat / context with conversations drawer.
- Mobile: chat with both side panels as drawers.

- [ ] **Step 1: Write failing responsive panel test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AssistantShell } from "@/components/assistant/AssistantShell";

it("labels all three assistant regions", () => {
  render(<AssistantShell assistant={assistantFixture} />);
  expect(screen.getByRole("navigation", { name: "Conversaciones" })).toBeInTheDocument();
  expect(screen.getByRole("main", { name: "Chat del asistente" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Contexto y fuentes" })).toBeInTheDocument();
});
```

Define `assistantFixture` in the test with the complete existing `AssistantContextValue` contract and `vi.fn()` callbacks; do not loosen it with `as any`.

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/AssistantShell.test.tsx`

Expected: FAIL because the required landmarks/labels are absent.

- [ ] **Step 3: Apply the new visual hierarchy and landmarks**

Use semantic navigation/main/aside regions, compact panel headers, real analysis status, fixed accessible input, source chips, compact markdown tables, and theme tokens. Empty conversations show a single useful message and New conversation action, with no fabricated prompts presented as prior messages.

- [ ] **Step 4: Preserve breakpoint and focus behavior**

Keep existing media-query behavior and trigger refs. Drawers close on Escape/backdrop, restore focus, and never leave both mobile drawers open simultaneously. Respect reduced motion for all panel transitions.

- [ ] **Step 5: Run all assistant tests**

Run: `pnpm exec vitest run tests/ui/AssistantShell.test.tsx tests/**/*assistant*.test.ts tests/**/*assistant*.test.tsx`

Expected: PASS with no privacy/tool regressions.

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant tests/ui/AssistantShell.test.tsx
git commit -m "feat(ui): refine three-panel assistant experience"
```

---

### Task 10: Client-oriented Ajustes with appearance controls

**Files:**
- Modify: `src/components/settings/SettingsView.tsx`
- Create: `src/components/settings/AppearanceSettings.tsx`
- Create: `src/components/settings/ThemeSelector.tsx`
- Create: `src/components/settings/AccentSelector.tsx`
- Test: `tests/ui/SettingsView.test.tsx`

**Interfaces:**
- Settings sections are exactly `general`, `appearance`, `exclusions`, `concepts`, `ai`, and `privacy`.
- Appearance consumes `useTheme()` only; appearance is not written into analysis settings or result snapshots.
- Existing General, exclusions, concept map, normalized concepts, AI, and privacy behavior remains wired to `useAppState()`.

- [ ] **Step 1: Write failing appearance test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SettingsView } from "@/components/settings/SettingsView";

it("changes mode and accent immediately from Appearance", () => {
  render(<SettingsView />);
  fireEvent.click(screen.getByRole("tab", { name: "Apariencia" }));
  fireEvent.click(screen.getByRole("radio", { name: "Oscuro" }));
  fireEvent.click(screen.getByRole("radio", { name: "Esmeralda" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.accent).toBe("emerald");
});
```

- [ ] **Step 2: Run and confirm red state**

Run: `pnpm exec vitest run tests/ui/SettingsView.test.tsx`

Expected: FAIL because Appearance and selectors do not exist.

- [ ] **Step 3: Implement desktop internal sidebar and mobile selector**

Use the existing tab semantics, but render a left internal navigation on large screens and compact top selector on mobile. Preserve lazy mounting/visited behavior so expensive editors are not rebuilt on every tab switch.

- [ ] **Step 4: Implement ThemeSelector and AccentSelector**

Theme options are Sistema, Claro, and Oscuro. Accent options are Violeta, Azul, Esmeralda, Naranja, and Rosa. Every option is a labeled radio, shows a preview, updates immediately, and persists through ThemeProvider. Include `Restablecer apariencia`, which calls `resetTheme()`.

- [ ] **Step 5: Rewrite setting helper copy without changing values**

General explains tolerance and thresholds in operational terms. Privacy lists only current guarantees: local storage, no bank data in exports/AI, AI on demand, and deterministic calculations before explanation. Keep technical model/API controls inside IA.

- [ ] **Step 6: Run settings and storage tests**

Run: `pnpm exec vitest run tests/ui/SettingsView.test.tsx tests/theme/ThemeProvider.test.tsx tests/**/*settings*.test.ts tests/**/*storage*.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings tests/ui/SettingsView.test.tsx
git commit -m "feat(ui): add appearance and client-oriented settings"
```

---

### Task 11: End-to-end behavior, visual capture, and CI artifacts

**Files:**
- Create: `tests/e2e/client-ui-redesign.spec.ts`
- Modify: `tests/e2e/ui-redesign-screenshots.spec.ts`
- Modify: `.github/workflows/ui-redesign-validation.yml`
- Test data: reuse the existing E2E fixture/assistant mode; do not add demo data to production code.

**Interfaces:**
- E2E uses `http://127.0.0.1:3100` and the existing Playwright web server.
- Screenshots output to `artifacts/ui-screenshots/light` and `artifacts/ui-screenshots/dark`.
- Production UI remains empty unless E2E explicitly loads a fixture through current test-only mechanisms.

- [ ] **Step 1: Write the E2E behavior suite**

```ts
import { expect, test } from "@playwright/test";

test("navigates, changes appearance, and preserves preferences", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Inicio" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Ajustes" }).click();
  await page.getByRole("tab", { name: "Apariencia" }).click();
  await page.getByRole("radio", { name: "Oscuro" }).click();
  await page.getByRole("radio", { name: "Rosa" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "rose");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "rose");
});

test("global search opens a real result", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "Búsqueda global" })).toBeVisible();
});
```

Add scenarios for sidebar desktop/mobile, empty dashboard, fixture-backed active dashboard, Personas filters, Conceptos filters, three Cuadre tabs, assistant drawers, export button state, and Nuevo análisis.

- [ ] **Step 2: Run E2E and confirm failures identify unfinished selectors or behavior**

Run: `pnpm exec playwright test tests/e2e/client-ui-redesign.spec.ts --project=chromium`

Expected before final fixes: at least one FAIL if any required UI contract is missing. Resolve each failure in its owning component, not by weakening assertions.

- [ ] **Step 3: Expand screenshot coverage in light and dark**

Capture these exact states with violet accent:

- `01-inicio-vacio`
- `02-inicio-analisis`
- `03-personas`
- `04-conceptos`
- `05-cuadre`
- `06-normalizados`
- `07-variables`
- `08-agrupaciones`
- `09-asistente`
- `10-historial`
- `11-ajustes-general`
- `12-ajustes-apariencia`
- `13-mobile-navigation`

For each desktop state, set localStorage preference before reload and save one light and one dark PNG. Use `animations: "disabled"` and wait for fonts, hydration, and table rendering before capture.

- [ ] **Step 4: Update CI workflow**

The validation job runs, records, and gates:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm test
- run: pnpm build
- run: pnpm exec playwright install --with-deps chromium
- run: pnpm exec playwright test tests/e2e/client-ui-redesign.spec.ts tests/e2e/ui-redesign-screenshots.spec.ts --project=chromium
```

Upload `artifacts/ui-screenshots`, Playwright report/traces on failure, and test logs with 14-day retention. The final job must fail when tests, build, or Playwright exits non-zero.

- [ ] **Step 5: Run the complete local validation**

Run: `pnpm test && pnpm build && pnpm exec playwright test tests/e2e/client-ui-redesign.spec.ts tests/e2e/ui-redesign-screenshots.spec.ts --project=chromium`

Expected: all Vitest tests PASS, build exits 0, and both Playwright files PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e .github/workflows/ui-redesign-validation.yml
git commit -m "test(ui): validate redesigned client experience"
```

---

### Task 12: Final review, integration into main, and verified public deployment

**Files:**
- Modify only when evidence requires it: deployment provider configuration already present in the repository.
- Create when deployment cannot be completed: `docs/deployment/client-ui-redesign-deployment.md`

**Interfaces:**
- GitHub branch `ui/retributivo-modern-redesign` is merged only after CI is green.
- A public URL is reported only after an HTTP request confirms it serves the merged application.

- [ ] **Step 1: Verify branch and requirement coverage**

Run:

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
```

Expected: clean worktree, the planned commits are present, and `git diff --check` exits 0.

- [ ] **Step 2: Run fresh full verification**

Run:

```bash
pnpm test
pnpm build
pnpm exec playwright test --project=chromium
```

Expected: zero failed Vitest tests, build exit 0, zero failed Playwright tests. Record exact counts from the output before making completion claims.

- [ ] **Step 3: Inspect generated screenshots manually**

Create a contact sheet from `artifacts/ui-screenshots` and inspect every image for clipping, overlap, unreadable dark-mode text, empty fake metrics, broken sticky columns, and mobile overflow. Any visual defect returns to the owning task and requires rerunning screenshots.

- [ ] **Step 4: Open a pull request and wait for CI**

```bash
git push origin ui/retributivo-modern-redesign
gh pr create --base main --head ui/retributivo-modern-redesign --title "feat(ui): rediseño profesional orientado al cliente" --body-file docs/superpowers/specs/2026-07-23-client-ui-redesign-design.md
gh pr checks --watch
```

Expected: all required checks succeed.

- [ ] **Step 5: Merge to main and verify the merge commit**

```bash
gh pr merge --merge --delete-branch=false
git fetch origin main
git log -1 --oneline origin/main
```

Expected: `origin/main` contains the redesign merge commit.

- [ ] **Step 6: Detect the configured deployment provider**

Run:

```bash
git ls-files | grep -E '(^|/)(vercel\.json|netlify\.toml|render\.yaml|fly\.toml|wrangler\.toml)$' || true
gh api repos/erpereh/reg_retributivo_CyC/deployments --jq '.[0:10] | .[] | [.environment, .ref, .created_at] | @tsv'
```

Expected: provider evidence or an empty result. Do not infer a provider from package dependencies.

- [ ] **Step 7: Deploy through the evidenced provider**

For an existing Vercel integration with available credentials:

```bash
pnpm dlx vercel pull --yes --environment=production
DEPLOY_URL=$(pnpm dlx vercel deploy --prod --yes | tail -n 1)
curl --fail --location --silent --show-error --head "$DEPLOY_URL"
printf '%s\n' "$DEPLOY_URL"
```

Expected: HTTP 200/3xx to the application and a public HTTPS URL.

For another evidenced provider, use its committed configuration and official CLI, then verify the returned HTTPS URL with `curl --fail --location --head`.

- [ ] **Step 8: Document a deployment blocker only when no usable provider or credentials exist**

Create `docs/deployment/client-ui-redesign-deployment.md` containing the checked commands, their outputs, the exact missing provider/credential names, and the shortest reproducible deployment command. Do not claim a deployment URL in this branch.

- [ ] **Step 9: Deliver evidence**

Provide the merged commit SHA, PR URL, exact unit/E2E counts, build result, verified public URL or blocker document, light/dark contact sheets, and ZIP containing every requested screen.
