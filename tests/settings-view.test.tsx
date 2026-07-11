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
      excludedEmployeeIds: [],
      conceptMap: [],
      normalizedConcepts: [],
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
    saveExclusionsAndRefresh: vi.fn(),
    pushToast: vi.fn(),
    refreshAiStatus: vi.fn(),
    testAiConnection: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

function openSettingsTab(name: "General" | "Exclusiones" | "Conceptos" | "Privacidad") {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("SettingsView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    appState.value.updateSettings.mockClear();
    appState.value.saveConceptMapAndRefresh.mockClear();
    appState.value.saveExclusionsAndRefresh.mockClear();
    appState.value.pushToast.mockClear();
    appState.value.settings.conceptMap = [];
    appState.value.settings.normalizedConcepts = [];
    appState.value.settings.excludedEmployeeIds = [];
    appState.value.activeAnalysis.result.conceptMap = cloneDefaultConceptMap();
  });

  test("opens General by default and keeps visited settings panels mounted but hidden", () => {
    render(<SettingsView />);

    const generalTab = screen.getByRole("tab", { name: "General" });
    const conceptsTab = screen.getByRole("tab", { name: "Conceptos" });
    expect(generalTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "General" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Conceptos del análisis" })).toBeNull();

    fireEvent.click(conceptsTab);
    expect(screen.getByRole("heading", { name: "Conceptos del análisis" })).toBeTruthy();

    fireEvent.click(generalTab);
    const hiddenConceptPanel = document.querySelector('[role="tabpanel"][aria-label="Conceptos"]');
    expect(hiddenConceptPanel).toBeTruthy();
    expect((hiddenConceptPanel as HTMLElement).hidden).toBe(true);
    expect(hiddenConceptPanel?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Conceptos del análisis" })).toBeNull();
  });

  test("renders AI configuration without global toggles and clears only AI explanation cache", () => {
    window.localStorage.setItem(AI_EXPLANATION_CACHE_KEY, JSON.stringify({ cached: true }));
    window.localStorage.setItem("retributivo.history.v1", "history");

    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Activar IA por defecto/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Abrir explicación IA automáticamente/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Probar conexión IA/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Borrar caché de explicaciones/i }));

    expect(window.localStorage.getItem(AI_EXPLANATION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem("retributivo.history.v1")).toBe("history");
    expect(screen.getByText(/Caché de explicaciones IA borrada/i)).toBeTruthy();
  });

  test("renders the concept analysis editor with only active/desactivated usage controls", () => {
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    expect(screen.getByRole("heading", { name: "Conceptos del análisis" })).toBeTruthy();
    expect(screen.queryByText(/Esta fase solo clasifica reglas/i)).toBeNull();
    expect(screen.getByText("Activa o desactiva conceptos para decidir qué entra en la comparativa.")).toBeTruthy();
    expect(screen.getByText("Activo = se usa en el análisis. Desactivado = se ignora al actualizar datos.")).toBeTruthy();
    expect(screen.queryByText(/justificad/i)).toBeNull();
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

  test("shows No Norm. by default and switches to the normalized concepts view", () => {
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    expect(screen.getByRole("tab", { name: "No Norm." }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Normalizado" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("heading", { name: "Conceptos del análisis" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Conceptos normalizados" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Normalizado" }));

    expect(screen.getByRole("tab", { name: "Normalizado" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Conceptos normalizados" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Conceptos del análisis" })).toBeNull();
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
    openSettingsTab("Conceptos");

    ["Salario Base", "Paga Extra Junio", "Antiguedad", "Complemento Puesto de trabajo", "Seguro Medico", "Kilometraje con Retencion", "Plan de Pensiones Mensual"].forEach(
      (concept) => {
        expect(screen.getByText(concept)).toBeTruthy();
      },
    );
  });

  test("renders one scrollable table with the corrected counters and telework visible", () => {
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    expect(screen.queryByRole("heading", { name: "Reglas del mapa" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Conceptos detectados en este análisis/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Reglas y conceptos" })).toBeTruthy();
    expect(screen.getByTestId("concept-map-unified-scroll").className).toContain("max-h");
    expect(screen.getByTestId("concept-map-unified-scroll").className).toContain("overflow-y-auto");

    expect(screen.queryByRole("button", { name: /^En uso/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^No usados/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pendientes \d/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Conceptos totales 8/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Activos 7/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Desactivados 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Detectados 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sin configurar 1/i })).toBeTruthy();

    const teleworkRow = screen.getByText("Abono teletrabajo").closest("tr");
    expect(teleworkRow).toBeTruthy();
    expect(within(teleworkRow as HTMLTableRowElement).getByText("CSP_I_COMP_TELETR_COVID")).toBeTruthy();
    expect(within(teleworkRow as HTMLTableRowElement).getAllByText("Extrasalarial").length).toBeGreaterThanOrEqual(1);
    expect(within(teleworkRow as HTMLTableRowElement).queryByText("Justificado")).toBeNull();
    expect(within(teleworkRow as HTMLTableRowElement).getByText("Activo")).toBeTruthy();
    expect(within(teleworkRow as HTMLTableRowElement).getAllByText("Sí").length).toBeGreaterThanOrEqual(1);
    expect(within(teleworkRow as HTMLTableRowElement).getByRole("button", { name: /Desactivar regla Abono teletrabajo/i })).toBeTruthy();
    expect(screen.queryByText(/Las reglas justificadas se descuentan/i)).toBeNull();
    expect(screen.queryByText(/fase posterior|subfase posterior/i)).toBeNull();
  });

  test("manages employee exclusion chips without duplicates", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsView />);
    openSettingsTab("Exclusiones");

    expect(screen.getByRole("heading", { name: /Exclusiones por matr/i })).toBeTruthy();
    expect(screen.getByText(/0 matr/i)).toBeTruthy();

    const input = screen.getByPlaceholderText(/10074 o BC6/i);
    fireEvent.change(input, { target: { value: " 10074 " } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(screen.getByText("10074")).toBeTruthy();
    expect(appState.value.updateSettings).toHaveBeenLastCalledWith({ excludedEmployeeIds: ["10074"] });
    expect(appState.value.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Matrícula excluida." }));

    fireEvent.change(input, { target: { value: "10074" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(screen.getAllByText("10074")).toHaveLength(1);
    expect(appState.value.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "La matrícula ya estaba excluida." }));

    fireEvent.change(input, { target: { value: "10076, bc6\n10189" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(screen.getByText("10076")).toBeTruthy();
    expect(screen.getByText("BC6")).toBeTruthy();
    expect(screen.getByText("10189")).toBeTruthy();
    expect(screen.getByText(/4 matr/i)).toBeTruthy();
    expect(screen.getByText(/Vuelve a analizar o pulsa Actualizar datos/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Quitar 10076/i }));
    expect(screen.queryByText("10076")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Limpiar lista/i }));
    expect(screen.queryByText("10074")).toBeNull();
    expect(screen.getByText(/0 matr/i)).toBeTruthy();
  });

  test("filters by usage, detected flag and block", () => {
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    expect(screen.queryByLabelText("Estado")).toBeNull();
    fireEvent.change(screen.getByLabelText("Uso"), { target: { value: "Desactivados" } });
    expect(screen.getByText("Kilometraje con Retencion")).toBeTruthy();
    expect(screen.queryByText("Abono teletrabajo")).toBeNull();

    fireEvent.change(screen.getByLabelText("Uso"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByLabelText("Detectado"), { target: { value: "Detectados" } });
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
    openSettingsTab("Conceptos");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por concepto/i), { target: { value: "Teletrabajo" } });
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Desactivar regla Abono teletrabajo/i }));

    expect(appState.value.updateSettings).toHaveBeenCalledWith({
      conceptMap: expect.arrayContaining([expect.objectContaining({ pdfConcept: "Abono teletrabajo", active: false })]),
    });
  });

  test("unmapped rows use the same three action slots without a justify shortcut", () => {
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    const pendingRow = screen.getByText("Concepto pendiente").closest("tr");
    expect(pendingRow).toBeTruthy();
    expect(within(pendingRow as HTMLTableRowElement).getByText("No hay regla.")).toBeTruthy();
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
    openSettingsTab("Conceptos");

    fireEvent.click(screen.getByRole("button", { name: /Restaurar defecto/i }));

    expect(appState.value.updateSettings).toHaveBeenCalledWith({ conceptMap: [] });
    expect(screen.getByText("Mapa restaurado por defecto.")).toBeTruthy();
    expect(screen.getByText("Abono teletrabajo")).toBeTruthy();
    expect(screen.getByText("Salario Base")).toBeTruthy();
  });

  test("creates a rule from an unmapped concept and refreshes data without files", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsView />);
    openSettingsTab("Conceptos");

    fireEvent.click(screen.getByRole("button", { name: /Crear regla Concepto pendiente/i }));
    fireEvent.change(screen.getByLabelText(/Código Reg\. Retrib\./i), { target: { value: "CODIGO_INEXISTENTE" } });
    expect(screen.getByText(/Este código no existe en el Reg\. Retrib\. cargado/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Guardar regla/i }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar mapa/i }));
    fireEvent.click(screen.getByRole("button", { name: /Actualizar datos/i }));

    expect(appState.value.saveConceptMapAndRefresh).toHaveBeenCalled();
  });
});
