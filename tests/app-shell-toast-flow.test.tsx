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
  TopNav: () => <nav aria-label="Navegación principal test" />,
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
  });
});
