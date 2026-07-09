// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/DashboardView";

const appState = vi.hoisted(() => ({
  value: {
    activeAnalysis: undefined as
      | {
          id: string;
          createdAt: string;
          config: { enableAI: boolean };
        }
      | undefined,
    result: undefined,
    pdfFiles: [],
    registroFile: undefined,
    settings: { defaultTolerance: 1, enableAIByDefault: false, autoExplainOnOpen: false },
    analyzing: false,
    setPdfFiles: vi.fn(),
    setRegistroFile: vi.fn(),
    updateSettings: vi.fn(),
    analyze: vi.fn(),
    status: "Pendiente de archivos",
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("DashboardView copy", () => {
  beforeEach(() => {
    appState.value.activeAnalysis = undefined;
    appState.value.settings = { defaultTolerance: 1, enableAIByDefault: false, autoExplainOnOpen: false };
    appState.value.aiStatus = { configured: false, enabled: false, model: "gemini-3.1-flash-lite" };
  });

  test("renders the functional dashboard title and subtitle", () => {
    render(<DashboardView />);

    expect(screen.getByRole("heading", { name: "Comparativa Recibos vs Registro Retributivo" })).toBeTruthy();
    expect(
      screen.getByText(
        "Resumen del análisis retributivo: diferencias matched, conceptos pendientes, Recibo sin Reg. Retrib. y estado general del cuadre.",
      ),
    ).toBeTruthy();
  });

  test("keeps quick configuration free of global AI observation controls", () => {
    render(<DashboardView />);

    expect(screen.getByLabelText(/Tolerancia EUR/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar/i })).toBeTruthy();
    expect(screen.queryByText(/Usar IA en observaciones/i)).toBeNull();
    expect(screen.queryByText(/Gemini solo redacta observaciones si hay API key/i)).toBeNull();
    expect(screen.queryByText(/IA DESACTIVADA/i)).toBeNull();
  });

  test("shows the dashboard AI badge as availability, not as a global toggle state", () => {
    appState.value.activeAnalysis = {
      id: "analysis-1",
      createdAt: "2026-07-08T08:00:00.000Z",
      config: { enableAI: false },
    };
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-3.1-flash-lite" };

    const { rerender } = render(<DashboardView />);

    expect(screen.getByText("IA disponible")).toBeTruthy();
    expect(screen.queryByText(/IA desactivada/i)).toBeNull();

    appState.value.aiStatus = { configured: false, enabled: false, model: "gemini-3.1-flash-lite" };
    rerender(<DashboardView />);

    expect(screen.getByText("IA no configurada")).toBeTruthy();
  });
});
