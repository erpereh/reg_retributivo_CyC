// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/DashboardView";

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => ({
    activeAnalysis: undefined,
    result: undefined,
    pdfFiles: [],
    registroFile: undefined,
    settings: { enableAIByDefault: false },
    analyzing: false,
    setPdfFiles: vi.fn(),
    setRegistroFile: vi.fn(),
    updateSettings: vi.fn(),
    analyze: vi.fn(),
    status: undefined,
    aiStatus: { configured: false },
  }),
}));

describe("DashboardView copy", () => {
  test("renders the functional dashboard title and subtitle", () => {
    render(<DashboardView />);

    expect(screen.getByRole("heading", { name: "Comparativa Nóminas vs Registro Retributivo" })).toBeTruthy();
    expect(
      screen.getByText(
        "Resumen del análisis retributivo: diferencias matched, conceptos pendientes, PDF sin Registro y estado general del cuadre.",
      ),
    ).toBeTruthy();
  });
});
