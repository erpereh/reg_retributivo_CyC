// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";

const appState = vi.hoisted(() => ({
  value: {
    hydrating: false,
    view: "dashboard",
    toasts: [{ id: "toast-1", kind: "info", title: "Historial cargado", message: "Análisis activo actualizado." }],
    dismissToast: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

vi.mock("@/components/layout/TopNav", () => ({
  TopNav: () => (
    <header>
      <nav aria-label="Navegación principal test">
        <div role="tablist" aria-label="Vistas">
          <button type="button" role="tab" aria-selected="true">Dashboard</button>
        </div>
      </nav>
    </header>
  ),
}));

describe("AppShell toast flow", () => {
  test("keeps rendered content visible while a history toast is open", () => {
    render(
      <AppShell>
        <section aria-label="Vista dashboard">Contenido del análisis activo</section>
      </AppShell>,
    );

    const content = screen.getByLabelText("Vista dashboard");
    const toast = screen.getByRole("status", { name: "Historial cargado" });

    expect(content.textContent).toContain("Contenido del análisis activo");
    expect(toast.className).toContain("pointer-events-auto");
    expect(toast.parentElement?.className).toContain("pointer-events-none");

    const shell = content.closest('[data-slot="app-shell"]');
    const appContent = shell?.querySelector('[data-slot="app-content"]');
    expect(shell?.getAttribute("data-surface")).toBe("canvas");
    expect(appContent?.getAttribute("data-surface")).toBe("transparent");
    expect(appContent?.className).not.toContain("bg-panel");
    expect(appContent?.className).not.toContain("shadow-nav");
  });

  test("preserves roving focus in the main tablist when the view changes", () => {
    const { rerender } = render(
      <AppShell>
        <section>Dashboard</section>
      </AppShell>,
    );
    const dashboardTab = screen.getByRole("tab", { name: "Dashboard" });
    dashboardTab.focus();

    appState.value.view = "personas";
    rerender(
      <AppShell>
        <section>Personas</section>
      </AppShell>,
    );

    expect(document.activeElement).toBe(dashboardTab);
  });
});
