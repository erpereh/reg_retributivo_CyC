// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsView } from "@/components/settings/SettingsView";
import { AI_EXPLANATION_CACHE_KEY } from "@/lib/ai/explainCache";

const defaultConceptMap = [
  {
    pdfConcept: "Abono teletrabajo",
    normalizedPdfConcept: "abono teletrabajo",
    aliases: ["Teletrabajo", "Compensación teletrabajo"],
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CSP_I_COMP_TELETR_COVID",
    status: "Justificado",
    sourceType: "devengo",
    includedInComparison: true,
    includedInAdjustedComparison: false,
    active: true,
    reason: "Visible y auditable, pero preparado para excluirse de la diferencia ajustada en una fase posterior.",
  },
  {
    pdfConcept: "Salario Base",
    normalizedPdfConcept: "salario base",
    block: "Salario",
    blockKey: "salary",
    registroCode: "SSP_SAL_BASE",
    status: "Incluido",
    sourceType: "devengo",
    active: true,
    reason: "Mapeo por defecto.",
  },
  {
    pdfConcept: "Paga Extra Junio",
    normalizedPdfConcept: "paga extra junio",
    block: "Salario",
    blockKey: "salary",
    registroCode: "SSP_PAGA_EXTRA_1",
    status: "Incluido",
    sourceType: "devengo",
    active: true,
  },
  {
    pdfConcept: "Antiguedad",
    normalizedPdfConcept: "antiguedad",
    block: "Salario",
    blockKey: "salary",
    registroCode: "SSP_ANTIGUEDAD",
    status: "Incluido",
    sourceType: "devengo",
    active: true,
  },
  {
    pdfConcept: "Complemento Puesto de trabajo",
    normalizedPdfConcept: "complemento puesto de trabajo",
    block: "C. Salarial",
    blockKey: "salaryComplement",
    registroCode: "CSP_I_COMP_PTO_TRA",
    status: "Incluido",
    sourceType: "devengo",
    active: true,
  },
  {
    pdfConcept: "Seguro Medico",
    normalizedPdfConcept: "seguro medico",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_SEG_SALUD",
    status: "Incluido",
    sourceType: "devengo",
    active: true,
  },
  {
    pdfConcept: "Kilometraje con Retencion",
    normalizedPdfConcept: "kilometraje con retencion",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "SSP_KM_CON_RETEN",
    status: "Incluido",
    sourceType: "devengo",
    active: false,
  },
  {
    pdfConcept: "Plan de Pensiones Mensual",
    normalizedPdfConcept: "plan de pensiones mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_PLAN_PENSIONES_ORD",
    status: "Incluido",
    sourceType: "informativo",
    active: true,
  },
] as const;

function cloneDefaultConceptMap() {
  return JSON.parse(JSON.stringify(defaultConceptMap));
}

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
        payrollRecords: [
          {
            sourceFile: "PDF_TEST.pdf",
            periodLabel: "Enero 2025",
            workerName: "Persona Test",
            employeeNumber: "10048",
            concepts: [
              { name: "Abono teletrabajo", amount: 208, type: "devengo" },
              { name: "Concepto pendiente", amount: 100, type: "devengo" },
            ],
          },
        ],
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
    appState.value.activeAnalysis.result.conceptMap = cloneDefaultConceptMap();
  });

  test("renders auto explain disabled by default and clears only AI explanation cache", () => {
    window.localStorage.setItem(AI_EXPLANATION_CACHE_KEY, JSON.stringify({ cached: true }));
    window.localStorage.setItem("retributivo.history.v1", "history");

    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Abrir explicación IA automáticamente/i }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Borrar caché de explicaciones/i }));

    expect(window.localStorage.getItem(AI_EXPLANATION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem("retributivo.history.v1")).toBe("history");
    expect(screen.getByText(/Caché de explicaciones IA borrada/i)).toBeTruthy();
  });

  test("renders the visual editor with only the required primary actions", () => {
    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Mapa de conceptos" })).toBeTruthy();
    expect(screen.queryByText(/Esta fase solo clasifica reglas/i)).toBeNull();
    expect(screen.getByText("Las reglas justificadas siguen visibles y auditables. La diferencia ajustada se aplicará en una subfase posterior.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Crear regla$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar mapa/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Actualizar datos/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Restaurar defecto/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Más opciones/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Exportar mapa/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Modo avanzado JSON/i }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/Editor JSON del mapa/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Más opciones/i }));

    expect(screen.getByRole("button", { name: /Exportar mapa/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Importar mapa/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Modo avanzado JSON/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Modo avanzado JSON/i }));

    expect(screen.getByLabelText(/Editor JSON del mapa/i).className).toContain("min-h-[320px]");
    expect(screen.getByRole("button", { name: /Validar JSON/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Aplicar JSON/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar JSON/i })).toBeTruthy();
  });

  test("shows default rules even when a stored map is old and partial", () => {
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
        active: true,
      },
    ] as never;

    render(<SettingsView />);

    ["Salario Base", "Paga Extra Junio", "Antiguedad", "Complemento Puesto de trabajo", "Seguro Medico", "Kilometraje con Retencion", "Plan de Pensiones Mensual"].forEach(
      (concept) => {
        expect(screen.getByText(concept)).toBeTruthy();
      },
    );
  });

  test("renders one scrollable table with the corrected counters and telework visible", () => {
    render(<SettingsView />);

    expect(screen.queryByRole("heading", { name: "Reglas del mapa" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Conceptos detectados en este análisis/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Reglas y conceptos" })).toBeTruthy();
    expect(screen.getByTestId("concept-map-unified-scroll").className).toContain("max-h");
    expect(screen.getByTestId("concept-map-unified-scroll").className).toContain("overflow-y-auto");

    expect(screen.queryByRole("button", { name: /^En uso/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^No usados/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pendientes \d/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Reglas totales 8/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Activadas 7/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Desactivadas 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Detectadas 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pendientes sin regla 1/i })).toBeTruthy();

    const teleworkRow = screen.getByText("Abono teletrabajo").closest("tr");
    expect(teleworkRow).toBeTruthy();
    expect(within(teleworkRow as HTMLTableRowElement).getByText("CSP_I_COMP_TELETR_COVID")).toBeTruthy();
    expect(within(teleworkRow as HTMLTableRowElement).getAllByText("Extrasalarial").length).toBeGreaterThanOrEqual(1);
    expect(within(teleworkRow as HTMLTableRowElement).getAllByText("Justificado").length).toBeGreaterThanOrEqual(1);
    expect(within(teleworkRow as HTMLTableRowElement).getAllByText("Sí").length).toBeGreaterThanOrEqual(2);
    expect(within(teleworkRow as HTMLTableRowElement).getByRole("button", { name: /Desactivar regla Abono teletrabajo/i })).toBeTruthy();
  });

  test("filters by state, activation, detected flag and block", () => {
    render(<SettingsView />);

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Justificado" } });
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();
    expect(screen.queryByText("Salario Base")).toBeNull();

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByLabelText("Activación"), { target: { value: "Desactivadas" } });
    expect(screen.getByText("Kilometraje con Retencion")).toBeTruthy();
    expect(screen.queryByText("Abono teletrabajo")).toBeNull();

    fireEvent.change(screen.getByLabelText("Activación"), { target: { value: "Todas" } });
    fireEvent.change(screen.getByLabelText("Detectado"), { target: { value: "Detectado en análisis" } });
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();
    expect(screen.getByText("Concepto pendiente")).toBeTruthy();
    expect(screen.queryByText("Seguro Medico")).toBeNull();

    fireEvent.change(screen.getByLabelText("Detectado"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByLabelText("Bloque"), { target: { value: "Salario" } });
    expect(screen.getByText("Salario Base")).toBeTruthy();
    expect(screen.queryByText("Seguro Medico")).toBeNull();
  });

  test("searches aliases and toggles a rule from compact actions", () => {
    render(<SettingsView />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por concepto/i), { target: { value: "Teletrabajo" } });
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Desactivar regla Abono teletrabajo/i }));

    expect(appState.value.updateSettings).toHaveBeenCalledWith({
      conceptMap: expect.arrayContaining([expect.objectContaining({ pdfConcept: "Abono teletrabajo", active: false })]),
    });
  });

  test("unmapped rows use the same three action slots without a justify shortcut", () => {
    render(<SettingsView />);

    const pendingRow = screen.getByText("Concepto pendiente").closest("tr");
    expect(pendingRow).toBeTruthy();
    expect(within(pendingRow as HTMLTableRowElement).getByText("Sin regla")).toBeTruthy();
    expect(within(pendingRow as HTMLTableRowElement).getByRole("button", { name: /Crear regla Concepto pendiente/i }).getAttribute("title")).toBe("Crear regla");
    const disabledPower = within(pendingRow as HTMLTableRowElement).getByRole("button", { name: /Crea una regla para poder activarla o desactivarla Concepto pendiente/i });
    expect(disabledPower.getAttribute("title")).toBe("Crea una regla para poder activarla o desactivarla");
    expect(disabledPower.hasAttribute("disabled")).toBe(true);
    expect(within(pendingRow as HTMLTableRowElement).getByRole("button", { name: /Descartar concepto Concepto pendiente/i }).getAttribute("title")).toBe("Descartar concepto");
    expect(within(pendingRow as HTMLTableRowElement).queryByRole("button", { name: /Justificar/i })).toBeNull();
  });

  test("restore default is visible, clears stored map and reloads default rows", () => {
    appState.value.settings.conceptMap = [
      {
        pdfConcept: "Regla manual",
        normalizedPdfConcept: "regla manual",
        block: "C. Salarial",
        blockKey: "salaryComplement",
        status: "Pendiente revisión",
        sourceType: "devengo",
        active: true,
      },
    ] as never;

    render(<SettingsView />);

    fireEvent.click(screen.getByRole("button", { name: /Restaurar defecto/i }));

    expect(appState.value.updateSettings).toHaveBeenCalledWith({ conceptMap: [] });
    expect(screen.getByText("Mapa restaurado por defecto.")).toBeTruthy();
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();
    expect(screen.getByText("Salario Base")).toBeTruthy();
  });

  test("creates a rule from an unmapped concept and refreshes data without files", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsView />);

    fireEvent.click(screen.getByRole("button", { name: /Crear regla Concepto pendiente/i }));
    fireEvent.change(screen.getByLabelText(/Código Registro/i), { target: { value: "CODIGO_INEXISTENTE" } });
    expect(screen.getByText(/Este código no existe en el Registro cargado/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Guardar regla/i }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar mapa/i }));
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/i }));

    expect(appState.value.saveConceptMapAndRefresh).toHaveBeenCalled();
  });
});
