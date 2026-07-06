// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { HistoryView } from "@/components/history/HistoryView";

const appState = vi.hoisted(() => ({
  value: {
    history: [
      {
        id: "analysis-1",
        createdAt: "2026-07-05T18:30:00.000Z",
        registroFileName: "registro.xlsx",
        pdfCount: 953,
        config: { enableAI: false },
        result: {
          summary: {
            uniquePeople: 70,
            peopleWithDifferences: 4,
            conceptsPendingReview: 2,
            conceptsIgnored: 35,
            matchedTotalDifference: 1234.56,
            totalGlobalDifference: 1234.56,
          },
        },
      },
    ],
    activeAnalysis: undefined,
    exporting: false,
    openStoredAnalysis: vi.fn(),
    removeStoredAnalysis: vi.fn(),
    clearStoredHistory: vi.fn(),
    exportStoredAnalysis: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("HistoryView", () => {
  test("opens stored analysis without relying on the toast", () => {
    render(<HistoryView />);

    expect(screen.getByRole("heading", { name: "Historial de análisis" })).toBeTruthy();
    expect(
      screen.getByText("Recupera análisis anteriores guardados localmente, cambia el análisis activo o exporta comparativas ya generadas."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Abrir análisis/i }));

    expect(appState.value.openStoredAnalysis).toHaveBeenCalledWith("analysis-1");
  });

  test("keeps the six history metrics in one compact desktop row", () => {
    render(<HistoryView />);

    const metricLabels = ["PDFs", "Personas", "Con diferencias", "Pendientes", "Ignorados", "Dif. matched"];

    metricLabels.forEach((label) => expect(screen.getByText(label)).toBeTruthy());

    const metricGrid = screen.getByText("Dif. matched").closest("dl");

    expect(metricGrid?.className).toContain("xl:grid-cols-6");
  });
});
