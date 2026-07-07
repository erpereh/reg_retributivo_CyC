// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AI_EXPLANATION_CACHE_KEY } from "@/lib/ai/explainCache";
import { SettingsView } from "@/components/settings/SettingsView";

const appState = vi.hoisted(() => ({
  value: {
    settings: {
      defaultTolerance: 1,
      enableAIByDefault: false,
      autoExplainOnOpen: false,
      reviewThreshold: 1,
      incidentThreshold: 50,
      aiModel: "gemini-3.1-flash-lite",
      conceptMap: [],
    },
    updateSettings: vi.fn(),
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
    aiTesting: false,
    aiTestMessage: undefined,
    activeAnalysis: {
      result: {
        conceptMap: [],
        unmappedConcepts: [
          {
            decisionType: "Sin mapear real",
            includedInComparison: false,
            pdfConcept: "Concepto pendiente",
            totalDetected: 100,
            peopleCount: 1,
            payrollCount: 1,
            exampleEmployeeNumbers: ["10048"],
            action: "Pendiente revisión",
            reason: "No hay regla.",
          },
        ],
        registroEmployees: [
          {
            concepts: [{ block: "Extrasalarial", blockKey: "extraSalary", code: "CSP_I_COMP_TELETR_COVID", amount: 0 }],
          },
        ],
        summary: {
          conceptsRealUnmapped: 1,
          conceptsPendingReview: 0,
          conceptsIgnored: 0,
        },
      },
    },
    pdfFiles: [],
    registroFile: undefined,
    analyzing: false,
    saveConceptMapAndRefresh: vi.fn(),
    pushToast: vi.fn(),
    refreshAiStatus: vi.fn(),
    testAiConnection: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("SettingsView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    appState.value.updateSettings.mockClear();
    appState.value.saveConceptMapAndRefresh.mockClear();
    appState.value.pushToast.mockClear();
    appState.value.settings.conceptMap = [];
  });

  test("renders auto explain disabled by default and clears only AI explanation cache", () => {
    window.localStorage.setItem(AI_EXPLANATION_CACHE_KEY, JSON.stringify({ cached: true }));
    window.localStorage.setItem("retributivo.history.v1", "history");

    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(
      screen.getByText("Configura tolerancias, preferencias de IA, caché de explicaciones y opciones de visualización de la comparativa."),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Abrir explicación IA automáticamente/i }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Borrar caché de explicaciones/i }));

    expect(window.localStorage.getItem(AI_EXPLANATION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem("retributivo.history.v1")).toBe("history");
    expect(screen.getByText(/Caché de explicaciones IA borrada/i)).toBeTruthy();
  });

  test("renders a visual concept map editor with advanced JSON collapsed", () => {
    appState.value.settings.conceptMap = [
      {
        pdfConcept: "Abono teletrabajo",
        normalizedPdfConcept: "abono teletrabajo",
        aliases: ["Teletrabajo"],
        block: "Extrasalarial",
        blockKey: "extraSalary",
        registroCode: "CSP_I_COMP_TELETR_COVID",
        status: "Justificado",
        sourceType: "devengo",
        allowInformative: false,
        dedupePriority: "devengo",
        includedInComparison: true,
        includedInAdjustedComparison: false,
        active: true,
        reason: "Visible y auditable.",
      },
    ] as never;

    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Mapa de conceptos" })).toBeTruthy();
    expect(screen.getByText(/Esta fase clasifica reglas/i)).toBeTruthy();
    expect(screen.getAllByText(/Visible y auditable, pero preparado/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Justificados/i })).toBeTruthy();
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();
    expect(screen.getByText("CSP_I_COMP_TELETR_COVID")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Modo avanzado JSON/i }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/Editor JSON del mapa/i)).toBeNull();
  });

  test("searches aliases and deactivates a rule from quick actions", () => {
    appState.value.settings.conceptMap = [
      {
        pdfConcept: "Abono teletrabajo",
        normalizedPdfConcept: "abono teletrabajo",
        aliases: ["Teletrabajo"],
        block: "Extrasalarial",
        blockKey: "extraSalary",
        registroCode: "CSP_I_COMP_TELETR_COVID",
        status: "Justificado",
        sourceType: "devengo",
        allowInformative: false,
        dedupePriority: "devengo",
        includedInComparison: true,
        includedInAdjustedComparison: false,
        active: true,
        reason: "Visible y auditable.",
      },
    ] as never;

    render(<SettingsView />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por concepto/i), { target: { value: "Teletrabajo" } });
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Desactivar Abono teletrabajo/i }));

    expect(appState.value.updateSettings).toHaveBeenCalledWith({
      conceptMap: [expect.objectContaining({ pdfConcept: "Abono teletrabajo", active: false })],
    });
  });

  test("creates a rule from an unmapped concept and refreshes data without files", () => {
    render(<SettingsView />);

    fireEvent.click(screen.getByRole("button", { name: /Crear regla para Concepto pendiente/i }));
    fireEvent.change(screen.getByLabelText(/Código Registro/i), { target: { value: "CODIGO_INEXISTENTE" } });
    expect(screen.getByText(/Este código no existe en el Registro cargado/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Guardar regla/i }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar mapa/i }));
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/i }));

    expect(appState.value.saveConceptMapAndRefresh).toHaveBeenCalled();
  });
});
