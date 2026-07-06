// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TopNav } from "@/components/layout/TopNav";

const appState = vi.hoisted(() => ({
  value: {
    view: "dashboard",
    result: undefined,
    activeAnalysis: undefined,
    aiStatus: undefined,
    exporting: false,
    setView: vi.fn(),
    exportActiveAnalysis: vi.fn(),
    resetForNewAnalysis: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("TopNav", () => {
  beforeEach(() => {
    appState.value.view = "dashboard";
    appState.value.result = undefined;
    appState.value.activeAnalysis = undefined;
    appState.value.aiStatus = undefined;
    appState.value.exporting = false;
    appState.value.setView.mockClear();
    appState.value.exportActiveAnalysis.mockClear();
    appState.value.resetForNewAnalysis.mockClear();
  });

  test("renders accessible tabs and changes active view without reload", () => {
    render(<TopNav />);

    expect(screen.getByRole("tab", { name: "Dashboard" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Personas" }));

    expect(appState.value.setView).toHaveBeenCalledWith("personas");
  });

  test("includes the Cuadre Excel tab between concepts and groupings", () => {
    render(<TopNav />);

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);

    expect(tabs).toEqual(["Dashboard", "Personas", "Conceptos", "Cuadre Excel", "Agrupaciones", "Historial", "Ajustes"]);

    fireEvent.click(screen.getByRole("tab", { name: "Cuadre Excel" }));

    expect(appState.value.setView).toHaveBeenCalledWith("cuadre-excel");
  });

  test("renders compact premium navigation without brand or analysis badges", () => {
    render(<TopNav />);

    expect(screen.queryByText("Retributivo")).toBeNull();
    expect(screen.queryByText(/Análisis activo/i)).toBeNull();
    expect(screen.queryByText(/IA activa/i)).toBeNull();
    expect(screen.getByRole("navigation", { name: /Navegación principal/i })).toBeTruthy();
  });

  test("uses icon-only export and reset buttons with accessible names", () => {
    render(<TopNav />);

    const exportButton = screen.getByRole("button", { name: /Exportar Excel/i });
    const resetButton = screen.getByRole("button", { name: /Nuevo análisis/i });

    expect(exportButton.textContent).toBe("");
    expect(resetButton.textContent).toBe("");
    expect(exportButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(resetButton);
    expect(appState.value.resetForNewAnalysis).toHaveBeenCalledTimes(1);
  });

  test("does not duplicate active analysis status in the navbar", () => {
    appState.value.result = {};
    appState.value.activeAnalysis = {
      createdAt: "2026-07-05T18:30:00.000Z",
      config: { enableAI: true },
    };
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-test" };

    render(<TopNav />);

    expect(screen.queryByText(/Análisis activo/i)).toBeNull();
    expect(screen.queryByText(/IA activa/i)).toBeNull();
  });
});
