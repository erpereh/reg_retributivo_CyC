// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TablesView } from "@/components/tables/TablesView";

const groupedExcelSheetsFixture = [
  {
    sheetName: "Análisis por puesto",
    status: "ready",
    groupedHeaders: [
      [
        { label: "ID Puesto", colSpan: 1, rowSpan: 4, startColumn: 0, endColumn: 0, level: 0, path: "ID Puesto" },
        { label: "Puesto", colSpan: 1, rowSpan: 4, startColumn: 1, endColumn: 1, level: 0, path: "Puesto" },
        { label: "TOTAL PERSONAS", colSpan: 2, rowSpan: 3, startColumn: 2, endColumn: 3, level: 0, path: "TOTAL PERSONAS" },
        {
          label: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES",
          colSpan: 1,
          startColumn: 4,
          endColumn: 4,
          level: 0,
          path: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES",
        },
      ],
      [{ label: "Salario", colSpan: 1, startColumn: 4, endColumn: 4, level: 1, path: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES > Salario" }],
      [{ label: "Media", colSpan: 1, startColumn: 4, endColumn: 4, level: 2, path: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES > Salario > Media" }],
      [
        { label: "Mujeres", colSpan: 1, startColumn: 2, endColumn: 2, level: 3, path: "TOTAL PERSONAS > Mujeres" },
        { label: "Varones", colSpan: 1, startColumn: 3, endColumn: 3, level: 3, path: "TOTAL PERSONAS > Varones" },
        {
          label: "Mujeres",
          colSpan: 1,
          startColumn: 4,
          endColumn: 4,
          level: 3,
          path: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES > Salario > Media > Mujeres",
        },
      ],
    ],
    columns: [
      { key: "c0", label: "ID Puesto", sourceColumn: "A", kind: "text" },
      { key: "c1", label: "Puesto", sourceColumn: "B", kind: "text" },
      { key: "c2", label: "Total personas · Mujeres", sourceColumn: "C", kind: "number" },
      { key: "c3", label: "Total personas · Varones", sourceColumn: "D", kind: "number" },
      { key: "c4", label: "Total retribuciones normalizadas + variables · Salario · Media · Mujeres", sourceColumn: "E", kind: "number" },
    ],
    rows: [
      {
        c0: { value: "ATSACYC", display: "ATSACYC", kind: "text" },
        c1: { value: "Administrativo/a Técnico SACYC", display: "Administrativo/a Técnico SACYC", kind: "text" },
        c2: { value: 1, display: "1", kind: "number" },
        c3: { value: 0, display: "0", kind: "number" },
        c4: { value: 23745.72, display: "23.745,72", kind: "number" },
      },
      {
        c0: { value: "CCAL", display: "CCAL", kind: "text" },
        c1: { value: "Control de Calidad", display: "Control de Calidad", kind: "text" },
        c2: { value: 2, display: "2", kind: "number" },
        c3: { value: 1, display: "1", kind: "number" },
        c4: { value: 21993.2, display: "21.993,20", kind: "number" },
      },
    ],
    visibleRowCount: 2,
    visibleColumnCount: 5,
  },
  {
    sheetName: "Análisis por valoración puesto",
    status: "ready",
    columns: [
      { key: "c0", label: "Valoración Retributiva", sourceColumn: "A", kind: "text" },
      { key: "c1", label: "Total personas · Mujeres", sourceColumn: "B", kind: "number" },
    ],
    rows: [
      {
        c0: { value: "[SIN DEFINIR]", display: "[SIN DEFINIR]", kind: "text" },
        c1: { value: 30, display: "30", kind: "number" },
      },
    ],
    visibleRowCount: 1,
    visibleColumnCount: 2,
  },
  {
    sheetName: "Análisis por categoría",
    status: "missing",
    columns: [],
    rows: [],
    visibleRowCount: 0,
    visibleColumnCount: 0,
  },
  {
    sheetName: "Análisis por familia de puesto",
    status: "empty",
    columns: [],
    rows: [],
    visibleRowCount: 0,
    visibleColumnCount: 0,
  },
  {
    sheetName: "Agrupación Categoría Personal",
    status: "ready",
    truncated: true,
    originalRowCount: 2500,
    savedRowCount: 2000,
    columns: [{ key: "c0", label: "Agrup. Cat. Personal", sourceColumn: "A", kind: "text" }],
    rows: [{ c0: { value: "Oficial de Primera", display: "Oficial de Primera", kind: "text" } }],
    visibleRowCount: 1,
    visibleColumnCount: 1,
  },
];

const appState = {
  value: {
    result: {
      people: [
        {
          employeeNumber: "10048",
          person: "Persona Test",
          workplace: "Bilbao",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 1100,
          salaryDifference: 100,
          salaryComplementRegistro: 500,
          salaryComplementPdf: 400,
          salaryComplementDifference: -100,
          extraSalaryRegistro: 50,
          extraSalaryPdf: 258.01,
          extraSalaryDifference: 208.01,
          registroTotal: 1550,
          pdfTotal: 1758.01,
          totalDifference: 208.01,
          grossSalaryDifference: 100,
          grossSalaryComplementDifference: -100,
          grossExtraSalaryDifference: 208.01,
          grossTotalDifference: 208.01,
          justifiedSalaryAmount: 0,
          justifiedSalaryComplementAmount: 0,
          justifiedExtraSalaryAmount: 0,
          justifiedTotalAmount: 0,
          adjustedSalaryDifference: 100,
          adjustedSalaryComplementDifference: -100,
          adjustedExtraSalaryDifference: 208.01,
          adjustedTotalDifference: 208.01,
          grossStatus: "Diferencia",
          adjustedStatus: "Diferencia",
          justifiedConceptsSummary: "",
          justifiedConceptsCount: 0,
          pdfControlTotalDevengado: 1758.01,
          payrollCount: 1,
          unmappedConceptsCount: 0,
          status: "Diferencia",
          detail: "Teletrabajo activo",
          periods: ["Del 1 al 31 Enero 2025", "Del 1 al 28 Febrero 2025", "Del 1 al 31 Marzo 2025", "Del 1 al 30 Abril 2025"],
          files: ["PDF_ENERO.pdf"],
        },
        {
          employeeNumber: "10050",
          person: "Persona Diferencia",
          workplace: "Madrid",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 1200,
          salaryDifference: 200,
          salaryComplementRegistro: 0,
          salaryComplementPdf: 0,
          salaryComplementDifference: 0,
          extraSalaryRegistro: 0,
          extraSalaryPdf: 208.01,
          extraSalaryDifference: 208.01,
          registroTotal: 1000,
          pdfTotal: 1408.01,
          totalDifference: 408.01,
          pdfControlTotalDevengado: 1408.01,
          payrollCount: 1,
          unmappedConceptsCount: 1,
          status: "Diferencia",
          detail: "Teletrabajo pendiente",
          periods: ["Febrero 2025"],
          files: ["PDF_FEBRERO.pdf"],
        },
        {
          employeeNumber: "10072",
          person: "Persona Bolsa",
          workplace: "Bilbao",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 1000,
          salaryDifference: 0,
          salaryComplementRegistro: 500,
          salaryComplementPdf: 1341.92,
          salaryComplementDifference: 841.92,
          extraSalaryRegistro: 0,
          extraSalaryPdf: 208.01,
          extraSalaryDifference: 208.01,
          registroTotal: 1500,
          pdfTotal: 2549.93,
          totalDifference: 1049.93,
          pdfControlTotalDevengado: 2549.93,
          payrollCount: 1,
          unmappedConceptsCount: 1,
          status: "Diferencia",
          detail: "Bolsa vacaciones y teletrabajo",
          periods: ["Marzo 2025"],
          files: ["PDF_MARZO.pdf"],
        },
        {
          employeeNumber: "10123",
          person: "Persona Reclasificacion",
          workplace: "Madrid",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 4679.81,
          salaryDifference: 3679.81,
          salaryComplementRegistro: 3679.8,
          salaryComplementPdf: 0,
          salaryComplementDifference: -3679.8,
          extraSalaryRegistro: 193.94,
          extraSalaryPdf: 0,
          extraSalaryDifference: -193.94,
          registroTotal: 4873.74,
          pdfTotal: 4679.81,
          totalDifference: -193.94,
          pdfControlTotalDevengado: 4679.81,
          payrollCount: 1,
          unmappedConceptsCount: 0,
          status: "Diferencia",
          detail: "Reclasificacion entre bloques",
          periods: ["Abril 2025"],
          files: ["PDF_ABRIL.pdf"],
        },
      ],
      concepts: [
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Extrasalarial",
          blockKey: "extraSalary",
          registroCode: "CYC_ABONO_TELETRABAJO",
          pdfConcept: "Abono teletrabajo",
          registroAmount: 0,
          pdfAmount: 208.01,
          difference: 208.01,
          grossDifference: 208.01,
          justifiedAmount: 0,
          adjustedDifference: 208.01,
          grossStatus: "Diferencia",
          adjustedStatus: "Diferencia",
          isJustified: false,
          status: "Diferencia",
          detail: "Diferencia de concepto",
        },
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Salario",
          blockKey: "salary",
          registroCode: "SSP_SAL_BASE",
          pdfConcept: "Salario Base",
          registroAmount: 1000,
          pdfAmount: 1100,
          difference: 100,
          status: "Diferencia",
          detail: "Diferencia de concepto",
        },
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Extrasalarial",
          blockKey: "extraSalary",
          registroCode: "CYC_SEG_SALUD",
          pdfConcept: "Seguro Medico",
          registroAmount: 100,
          pdfAmount: 120,
          difference: 20,
          status: "Diferencia",
          detail: "Diferencia de concepto",
        },
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "C. Salarial",
          blockKey: "salaryComplement",
          registroCode: "CSP_REVISION",
          pdfConcept: "Complemento revision",
          registroAmount: 100,
          pdfAmount: 100,
          difference: 0,
          status: "Revisar",
          detail: "Revisar criterio",
        },
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Salario",
          blockKey: "salary",
          registroCode: "SSP_ANTIGUEDAD",
          pdfConcept: "Antiguedad",
          registroAmount: 50,
          pdfAmount: 50,
          difference: 0,
          status: "OK",
          detail: "OK",
        },
        {
          employeeNumber: "10072",
          person: "Persona Bolsa",
          block: "C. Salarial",
          blockKey: "salaryComplement",
          registroCode: "CSP_BOLSA_VAC",
          pdfConcept: "Bolsa de Vacaciones",
          registroAmount: 0,
          pdfAmount: 841.92,
          difference: 841.92,
          status: "Diferencia",
          detail: "Bolsa vacaciones",
        },
        {
          employeeNumber: "10072",
          person: "Persona Bolsa",
          block: "Extrasalarial",
          blockKey: "extraSalary",
          registroCode: "CYC_ABONO_TELETRABAJO",
          pdfConcept: "Abono teletrabajo",
          registroAmount: 0,
          pdfAmount: 208.01,
          difference: 208.01,
          status: "Diferencia",
          detail: "Teletrabajo",
        },
        {
          employeeNumber: "10123",
          person: "Persona Reclasificacion",
          block: "Salario",
          blockKey: "salary",
          registroCode: "SSP_PREST_ENF_75",
          pdfConcept: "Prestacion enfermedad 75",
          registroAmount: 0,
          pdfAmount: 3679.81,
          difference: 3679.81,
          status: "Diferencia",
          detail: "Reclasificacion",
        },
        {
          employeeNumber: "10123",
          person: "Persona Reclasificacion",
          block: "C. Salarial",
          blockKey: "salaryComplement",
          registroCode: "CSP_IT_COMPLEMENTO",
          pdfConcept: "Complemento IT",
          registroAmount: 3679.8,
          pdfAmount: 0,
          difference: -3679.8,
          status: "Diferencia",
          detail: "Reclasificacion",
        },
        {
          employeeNumber: "10123",
          person: "Persona Reclasificacion",
          block: "Extrasalarial",
          blockKey: "extraSalary",
          registroCode: "CYC_EXTRA_RESTO",
          pdfConcept: "Ajuste extrasalarial",
          registroAmount: 193.94,
          pdfAmount: 0,
          difference: -193.94,
          status: "Diferencia",
          detail: "Diferencia residual",
        },
      ],
      unmappedConcepts: [
        {
          decisionType: "Pendiente revision",
          includedInComparison: false,
          pdfConcept: "Prestacion Teorica Maternidad",
          totalDetected: 300,
          peopleCount: 1,
          payrollCount: 1,
          exampleEmployeeNumbers: ["10048"],
          suggestedBlock: "C. Salarial",
          action: "Pendiente revision",
          recommendedAction: "Revisar maternidad",
          reason: "Ejemplo explicito para la matricula",
        },
        {
          decisionType: "Pendiente revision",
          includedInComparison: false,
          pdfConcept: "Paga 40 anos",
          totalDetected: 841.92,
          peopleCount: 1,
          payrollCount: 1,
          exampleEmployeeNumbers: ["10072"],
          suggestedBlock: "C. Salarial",
          action: "Pendiente revisión",
          recommendedAction: "Revisar codigo Registro",
          reason: "No existe codigo exacto",
        },
      ],
      groupings: [],
      groupedExcelSheets: structuredClone(groupedExcelSheetsFixture),
    },
    filters: { query: "", center: "", group: "", status: "" },
    setFilters: vi.fn(),
    activeAnalysis: { id: "analysis-1" },
    settings: {
      autoExplainOnOpen: false,
    },
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
    pushToast: vi.fn(),
  },
};

vi.mock("@/components/app/AppState", async () => {
  const actual = await vi.importActual<typeof import("@/components/app/AppState")>("@/components/app/AppState");
  return {
    ...actual,
    useAppState: () => appState.value,
  };
});

describe("TablesView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    appState.value.result.groupings = [];
    appState.value.result.groupedExcelSheets = structuredClone(groupedExcelSheetsFixture);
    appState.value.aiStatus = { configured: false, enabled: false, model: "gemini-3.1-flash-lite" };
    appState.value.settings = { autoExplainOnOpen: false };
  });

  test("does not key mapped table headers by their visible label", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "tables", "TablesView.tsx"), "utf8");

    expect(source).not.toContain("key={header}");
  });

  test("renders repeated visible headers with unique React keys", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<TablesView mode="personas" />);

    expect(consoleError.mock.calls.flat().some((entry) => String(entry).includes("Encountered two children with the same key"))).toBe(false);
    consoleError.mockRestore();
  });

  test("renders functional page subtitles for people, concepts and groupings", () => {
    const { rerender } = render(<TablesView mode="personas" />);

    expect(screen.getByRole("heading", { name: "Personas" })).toBeTruthy();
    expect(screen.getByText(/Compara por matrícula los importes del Reg\. Retrib\. frente a los importes detectados en recibos/i)).toBeTruthy();
    expect(screen.getByText(/Salario, Complemento Salarial y Extrasalarial/i)).toBeTruthy();

    rerender(<TablesView mode="conceptos" />);
    expect(screen.getByRole("heading", { name: "Conceptos" })).toBeTruthy();
    expect(screen.getByText(/Revisa el detalle concepto a concepto/i)).toBeTruthy();

    rerender(<TablesView mode="agrupaciones" />);
    expect(screen.getByRole("heading", { name: "Agrupaciones" })).toBeTruthy();
    expect(screen.getByText(/Consulta las hojas agrupadas incluidas en el Excel Reg\. Retrib\./i)).toBeTruthy();
    expect(screen.queryByText(/ajustad/i)).toBeNull();
  });

  test("does not use technical implementation copy as the main table subtitle", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByText(/scroll horizontal|sticky|clicar cualquier fila/i)).toBeNull();
  });

  test("shows person and concept columns without legacy adjusted or justified badges", () => {
    const { rerender } = render(<TablesView mode="personas" />);

    expect(screen.getByRole("columnheader", { name: "Total Reg. Retrib." })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total Recibo" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Diferencia" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Justificado" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Dif. ajustada" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Estado ajustado" })).toBeNull();

    const personRow = screen.getByText("10048").closest("tr") as HTMLTableRowElement;
    expect(within(personRow).getByText("Diferencia")).toBeTruthy();
    expect(within(personRow).queryByText("OK ajustado")).toBeNull();
    expect(within(personRow).queryByText("Justificado")).toBeNull();

    rerender(<TablesView mode="conceptos" />);

    expect(screen.getAllByRole("columnheader", { name: "Diferencia" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("columnheader", { name: "Estado" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("columnheader", { name: "Importe justificado" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Dif. ajustada" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Estado ajustado" })).toBeNull();
    expect(screen.getAllByRole("columnheader", { name: "Motivo" }).length).toBeGreaterThanOrEqual(1);

    const teleworkRow = screen.getAllByText("Abono teletrabajo")[0]?.closest("tr") as HTMLTableRowElement;
    expect(within(teleworkRow).getByText("Diferencia")).toBeTruthy();
    expect(within(teleworkRow).queryByText("Justificado")).toBeNull();
  });

  test("opens a deterministic person detail modal from the whole clickable row", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("dialog", { name: /Detalle persona/i })).toBeNull();

    fireEvent.click(screen.getByText("10048"));

    expect(screen.getByRole("dialog", { name: /Detalle persona/i })).toBeTruthy();
    expect(screen.getByText(/Causa probable/i)).toBeTruthy();
    expect(screen.getByText("Periodos")).toBeTruthy();
    expect(screen.getAllByTestId("period-chip").map((chip) => chip.textContent)).toEqual([
      "Del 1 al 31 Enero 2025",
      "Del 1 al 28 Febrero 2025",
      "Del 1 al 31 Marzo 2025",
      "Del 1 al 30 Abril 2025",
    ]);
    expect(screen.queryByText(/Del 1 al 31 Enero 2025; Del 1 al 28 Febrero 2025/)).toBeNull();
    expect(screen.getByRole("button", { name: /Analizar con IA/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("IA no configurada. Añade GEMINI_API_KEY en .env")).toBeTruthy();
  });

  test("keeps Personas fixed in compact density without density selector", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("button", { name: "Cómoda" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compacta" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ver Recibo sin Reg. Retrib." })).toBeTruthy();

    const tableSurface = screen.getByRole("table").closest('[data-surface="table-shell"]');
    const search = screen.getByPlaceholderText("Matrícula, persona o concepto");
    expect(tableSurface).toBeTruthy();
    expect(tableSurface?.contains(search)).toBe(true);
    expect(tableSurface?.querySelector('[data-slot="table-toolbar"]')).toBeTruthy();
  });

  test("shows a compact person concept table before AI with filters, ordering and expandable detail", () => {
    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10048"));

    const conceptSection = screen.getByRole("region", { name: /Conceptos de la persona/i });

    expect(within(conceptSection).getByText("Conceptos de la persona")).toBeTruthy();
    expect(within(conceptSection).getByText(/Comparativa de conceptos del Reg\. Retrib\./i)).toBeTruthy();
    expect(within(conceptSection).queryByRole("columnheader", { name: "Persona" })).toBeNull();
    expect(within(conceptSection).queryByRole("columnheader", { name: "Matrícula" })).toBeNull();
    expect(within(conceptSection).getByText(/Diferencia visible/i)).toBeTruthy();
    expect(within(conceptSection).getByText(/Conceptos con diferencia/i)).toBeTruthy();
    expect(within(conceptSection).queryByText(/ajustad/i)).toBeNull();
    expect(within(conceptSection).queryByText(/justificad/i)).toBeNull();
    expect(within(conceptSection).getByText(/Conceptos OK/i)).toBeTruthy();

    const content = conceptSection.textContent ?? "";
    expect(content.indexOf("Abono teletrabajo")).toBeLessThan(content.indexOf("Salario Base"));
    expect(content).toContain("Seguro Medico");

    fireEvent.click(within(conceptSection).getByRole("button", { name: /OK/i }));
    expect(within(conceptSection).getByText("Antiguedad")).toBeTruthy();
    expect(within(conceptSection).queryByText("Abono teletrabajo")).toBeNull();

    fireEvent.click(within(conceptSection).getByRole("button", { name: /Solo diferencias/i }));
    expect(within(conceptSection).getByText("Abono teletrabajo")).toBeTruthy();
    fireEvent.click(within(conceptSection).getByText("Abono teletrabajo"));
    expect(within(conceptSection).getByText(/Qué revisar/i)).toBeTruthy();
    expect(within(conceptSection).getByText(/Causa probable/i)).toBeTruthy();

    expect(screen.getByText("Conceptos no incluidos de esta persona")).toBeTruthy();
    expect(screen.getByText("Prestacion Teorica Maternidad")).toBeTruthy();
    expect(screen.queryByText("Paga 40 anos")).toBeNull();
    expect(conceptSection.compareDocumentPosition(screen.getByRole("region", { name: /Explicación IA/i })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("shows an empty state when the selected person has no compared concepts", () => {
    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10050"));

    expect(screen.getByText("No hay conceptos comparados para esta matrícula.")).toBeTruthy();
  });

  test("orders 10072 and 10123 concept rows by the relevant differences", () => {
    render(<TablesView mode="personas" />);

    fireEvent.click(screen.getByText("10072"));
    let conceptSection = screen.getByRole("region", { name: /Conceptos de la persona/i });
    let content = conceptSection.textContent ?? "";
    expect(content.indexOf("Bolsa de Vacaciones")).toBeLessThan(content.indexOf("Abono teletrabajo"));

    fireEvent.keyDown(screen.getByRole("dialog", { name: /Detalle persona/i }), { key: "Escape" });
    fireEvent.click(screen.getByText("10123"));
    conceptSection = screen.getByRole("region", { name: /Conceptos de la persona/i });
    content = conceptSection.textContent ?? "";
    expect(content.indexOf("Prestacion enfermedad 75")).toBeLessThan(content.indexOf("Ajuste extrasalarial"));
    expect(content.indexOf("Complemento IT")).toBeLessThan(content.indexOf("Ajuste extrasalarial"));
  });

  test("does not request an AI explanation automatically when opening a detail modal", async () => {
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-3.1-flash-lite" };
    appState.value.settings = { autoExplainOnOpen: true };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          explanation: {
            summary: "No deberia solicitarse automaticamente.",
            probableCauses: ["Auto"],
            registroReview: ["Registro"],
            pdfReview: ["PDF"],
            recommendedActions: ["Accion"],
            confidence: "Baja",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10048"));

    expect(screen.getByRole("dialog", { name: /Detalle persona/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar con IA/i })).toBeTruthy();
    expect(
      screen.getByText(
        "Bajo demanda, sobre datos estructurados ya calculados. No recalcula ni modifica resultados. No se envían nombres, NIF, IBAN, bancos ni documentos completos.",
      ),
    ).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests an AI explanation on demand without sending the person name", async () => {
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-3.1-flash-lite" };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          explanation: {
            summary: "Diferencia explicada.",
            probableCauses: ["Concepto pendiente."],
            registroReview: ["Revisar Registro."],
            pdfReview: ["Revisar datos extraidos de los PDFs."],
            recommendedActions: ["Documentar criterio."],
            confidence: "Media",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            explanation: {
              summary: "Diferencia regenerada.",
              probableCauses: ["Concepto regenerado."],
              registroReview: ["Revisar Registro otra vez."],
              pdfReview: ["Revisar PDF otra vez."],
              recommendedActions: ["Documentar regeneracion."],
              confidence: "Alta",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10048"));
    fireEvent.click(screen.getByRole("button", { name: /Analizar con IA/i }));

    await screen.findByText("Diferencia explicada.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/explain", expect.any(Object)));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(JSON.stringify(body)).not.toContain("Persona Test");
    expect(JSON.stringify(body)).toContain("10048");
    expect(body.payload.topConceptDifferences.map((item: { registroCode: string }) => item.registroCode)).toContain("SSP_SAL_BASE");
    expect(body.payload.relatedNotIncludedConcepts.map((item: { pdfConcept: string }) => item.pdfConcept)).toContain("Prestacion Teorica Maternidad");
    expect(screen.getByText("Causas probables")).toBeTruthy();
    expect(screen.getByText(/revisar en Reg\. Retrib\./i)).toBeTruthy();
    expect(screen.getByText(/revisar en Recibo/i)).toBeTruthy();
    expect(screen.getByText("Explicación IA guardada para este análisis.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerar IA/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar explicación/i })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog", { name: /Detalle persona/i }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Detalle persona/i })).toBeNull());
    fireEvent.click(screen.getByText("10048"));

    expect(await screen.findByText("Diferencia explicada.")).toBeTruthy();
    expect(screen.getByText("Explicación IA guardada para este análisis.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Regenerar IA/i }));
    expect(await screen.findByText("Diferencia regenerada.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Copiar explicación/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Diferencia regenerada."));
  });

  test("removes detail buttons and opens the concept modal from the row", () => {
    render(<TablesView mode="conceptos" />);

    expect(screen.queryByRole("button", { name: /^Detalle$/i })).toBeNull();

    fireEvent.click(screen.getByText("CYC_SEG_SALUD"));

    expect(screen.getByRole("dialog", { name: /Detalle concepto/i })).toBeTruthy();
    expect(screen.getAllByText("CYC_SEG_SALUD").length).toBeGreaterThan(1);
  });

  test("does not render a Detalle table column", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("columnheader", { name: /^Detalle$/i })).toBeNull();
  });

  test("keeps only Matricula sticky and uses opaque row backgrounds", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "tables", "TablesView.tsx"), "utf8");

    expect(source).not.toContain("left-[120px]");
    expect(source).not.toContain("bg-emerald-50/45");
    expect(source).not.toContain("bg-orange-50/45");
    expect(source).not.toContain("bg-red-50/35");
    expect(source).not.toContain("hover:bg-red-50/75");
    expect(source).toContain("shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]");
  });

  test("quick filters keep the table functional and show visible totals", () => {
    render(<TablesView mode="personas" />);

    fireEvent.click(screen.getByRole("button", { name: /Ver solo diferencias/i }));

    expect(appState.value.setFilters).toHaveBeenCalledWith(expect.objectContaining({ status: "Diferencia" }));
    expect(screen.getByText(/filas visibles/i)).toBeTruthy();
    expect(screen.getByText(/Suma diferencia visible/i)).toBeTruthy();
  });

  test("renders Agrupaciones as a grouped Excel sheet viewer", () => {
    render(<TablesView mode="agrupaciones" />);

    expect(screen.getByRole("tablist", { name: "Vistas de Agrupaciones" }).getAttribute("data-layout")).toBe("fit-content");
    const positionTab = screen.getByRole("tab", { name: "Puesto" });
    const valuationTab = screen.getByRole("tab", { name: "Valoración" });
    expect(positionTab.getAttribute("title")).toBe("Análisis por puesto");
    expect(valuationTab.getAttribute("title")).toBe("Análisis por valoración puesto");
    expect(screen.getByRole("tab", { name: "Categoría" }).getAttribute("title")).toBe("Análisis por categoría");
    expect(screen.getByRole("tab", { name: "Familia" }).getAttribute("title")).toBe("Análisis por familia de puesto");
    expect(screen.getByRole("tab", { name: "Cat. personal" }).getAttribute("title")).toBe("Agrupación Categoría Personal");
    expect(positionTab.tabIndex).toBe(0);
    expect(valuationTab.tabIndex).toBe(-1);
    expect(positionTab.getAttribute("aria-controls")).toBe("agrupaciones-sheet-panel");
    expect(screen.getByRole("tabpanel", { name: "Puesto" }).id).toBe("agrupaciones-sheet-panel");

    positionTab.focus();
    fireEvent.keyDown(positionTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(valuationTab);
    expect(valuationTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(valuationTab, { key: "Home" });
    expect(document.activeElement).toBe(positionTab);
    expect(positionTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "Análisis por puesto" })).toBeNull();
    expect(screen.getByLabelText(/Análisis por puesto · \d+ filas · \d+ columnas/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar en esta hoja")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Puesto" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "ID Puesto" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "TOTAL PERSONAS" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Salario" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Media" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader", { name: "Mujeres" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("columnheader", { name: "Varones" })).toBeTruthy();
    expect(screen.getByTitle("TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES > Salario > Media > Mujeres")).toBeTruthy();
    expect(screen.queryByText("Total retribuciones normalizadas + variables · Salario · Media · Mujeres")).toBeNull();
    expect(screen.queryByText("M = Mujeres · V = Varones · Dif. % = Diferencia porcentual")).toBeNull();
    expect(screen.getByText("Administrativo/a Técnico SACYC")).toBeTruthy();
    expect(screen.getByText("Control de Calidad")).toBeTruthy();

    expect(screen.queryByText("Validación Excel")).toBeNull();
    expect(screen.queryByText("Comparación Recibo")).toBeNull();
    expect(screen.queryByText("Dif. Excel")).toBeNull();
    expect(screen.queryByText("Dif. Recibo")).toBeNull();
    expect(screen.queryByText("Estado Excel")).toBeNull();
    expect(screen.queryByText("Estado Recibo")).toBeNull();
    expect(screen.queryByText(/recalculado/i)).toBeNull();
    expect(screen.queryByText(/matched/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Buscar en esta hoja"), { target: { value: "calidad" } });
    expect(screen.queryByText("Administrativo/a Técnico SACYC")).toBeNull();
    expect(screen.getByText("Control de Calidad")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Valoración" }));
    expect(screen.getByTitle("Valoración Retributiva").textContent).toBe("Valoración");
    expect(screen.getByText("[SIN DEFINIR]")).toBeTruthy();
  });

  test("derives grouped headers from flat columns for legacy grouped Excel sheets", () => {
    appState.value.result.groupedExcelSheets = structuredClone(groupedExcelSheetsFixture).map((sheet) =>
      sheet.sheetName === "Análisis por puesto" ? { ...sheet, groupedHeaders: undefined } : sheet,
    );

    render(<TablesView mode="agrupaciones" />);

    expect(screen.getByRole("columnheader", { name: "TOTAL PERSONAS" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Salario" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Media" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader", { name: "Mujeres" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("columnheader", { name: "Varones" })).toBeTruthy();
    expect(screen.getByText("Administrativo/a Técnico SACYC")).toBeTruthy();
  });

  test("shows clean states for missing, empty, legacy and truncated grouped sheets", () => {
    render(<TablesView mode="agrupaciones" />);

    fireEvent.click(screen.getByRole("tab", { name: "Categoría" }));
    expect(screen.getByText("No se ha encontrado esta hoja en el Excel Reg. Retrib.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Familia" }));
    expect(screen.getByText("No hay datos visibles en esta hoja.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Cat. personal" }));
    expect(screen.getByText("Esta hoja se guardó parcialmente en Historial para mantener el rendimiento. Vuelve a analizar el Excel para ver todos los datos.")).toBeTruthy();

    appState.value.result.groupedExcelSheets = undefined as never;
    render(<TablesView mode="agrupaciones" />);
    expect(screen.getByText("Este análisis no contiene datos de hojas agrupadas. Vuelve a analizar el Excel para visualizarlas.")).toBeTruthy();
  });

  test.skip("legacy grouped PDF comparison is removed", () => {
    appState.value.result.groupings = [
      {
        sourceSheet: "Análisis por puesto",
        groupingType: "puesto",
        groupId: "ATSACYC",
        groupName: "Administrativo/a Técnico SACYC",
        registroBase: "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES",
        block: "Salario",
        metric: "Media",
        segment: "Diferencia %",
        registroSheetValue: 0,
        registroRecalculatedValue: 0,
        excelDifference: 0,
        peopleCount: 1,
        womenCount: 1,
        menCount: 0,
        status: "OK",
        pdfStatus: "No aplica",
        excludedPdfWithoutRegistroCount: 1,
        detail: "Hoja agrupada comparada contra Empleados.",
      },
      {
        sourceSheet: "Análisis por puesto",
        groupingType: "puesto",
        groupId: "ATSACYC",
        groupName: "Administrativo/a Técnico SACYC",
        registroBase: "RETRIBUCIONES (PERIODO COMPLETO)",
        block: "Salario",
        metric: "Media",
        segment: "Mujeres",
        registroSheetValue: 100,
        registroRecalculatedValue: 100,
        excelDifference: 0,
        pdfRegistroRecalculatedValue: 100,
        pdfRecalculatedValue: 130,
        pdfDifference: 30,
        peopleCount: 2,
        matchedPeopleCount: 1,
        womenCount: 1,
        menCount: 1,
        matchedWomenCount: 1,
        matchedMenCount: 0,
        excludedPdfWithoutRegistroCount: 1,
        status: "OK",
        pdfStatus: "Diferencia",
        detail: "Hoja agrupada comparada contra Empleados.",
      },
      {
        sourceSheet: "Análisis por puesto",
        groupingType: "puesto",
        groupId: "ATSACYC",
        groupName: "Administrativo/a Técnico SACYC",
        registroBase: "RETRIBUCIONES (PERIODO COMPLETO)",
        block: "Salario",
        metric: "Media",
        segment: "Diferencia %",
        registroSheetValue: 0,
        registroRecalculatedValue: 0,
        excelDifference: 0,
        pdfRegistroRecalculatedValue: 0.1,
        pdfRecalculatedValue: 10.1,
        pdfDifference: 10,
        peopleCount: 2,
        matchedPeopleCount: 1,
        womenCount: 1,
        menCount: 1,
        matchedWomenCount: 1,
        matchedMenCount: 0,
        excludedPdfWithoutRegistroCount: 1,
        status: "OK",
        pdfStatus: "Diferencia",
        detail: "Hoja agrupada comparada contra Empleados.",
      },
    ];

    render(<TablesView mode="agrupaciones" />);

    expect(screen.getAllByText("Validación Excel").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Comparación Recibo").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/usa solo personas matched y excluye matrículas Recibo sin Reg\. Retrib\./i).length).toBeGreaterThan(0);
    expect(screen.getByText("Las hojas agrupadas cuadran con Empleados.")).toBeTruthy();
    expect(screen.getByText("Hojas analizadas")).toBeTruthy();
    expect(screen.getByText("Agrupaciones calculadas")).toBeTruthy();
    expect(screen.queryByText("Filas Excel OK")).toBeNull();
    expect(screen.getByText("Filas Excel con diferencia")).toBeTruthy();
    expect(screen.getByText("Filas Recibo con diferencia")).toBeTruthy();
    expect(screen.getByText("Recibo sin Reg. Retrib. excluidos")).toBeTruthy();
    expect(screen.queryByText("Dif. Recibo Salario")).toBeNull();
    expect(screen.queryByText("Dif. Recibo C. Salarial")).toBeNull();
    expect(screen.queryByText("Dif. Recibo Extrasalarial")).toBeNull();
    const maxPdfCard = screen.getByText("Mayor diferencia Recibo").closest("div");
    const affectedCard = screen.getByText("Agrupaciones Recibo afectadas").closest("div");
    expect(maxPdfCard).toBeTruthy();
    expect(affectedCard).toBeTruthy();
    expect(within(maxPdfCard as HTMLElement).getByText("30,00 EUR")).toBeTruthy();
    expect(within(affectedCard as HTMLElement).getByText("1")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Base Reg. Retrib." })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /Recibo recalculado/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Dif. Recibo/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Comparación Recibo" }));

    expect(screen.getByDisplayValue("RETRIBUCIONES (PERIODO COMPLETO)")).toBeTruthy();
    expect(screen.getByText(/Las diferencias Recibo se muestran por métrica agrupada/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Reg. Retrib. periodo completo matched" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Recibo recalculado" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Dif. Recibo" })).toBeTruthy();
    expect(screen.queryByText("TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES")).toBeNull();

    const groupingCell = screen.getAllByText("Administrativo/a Técnico SACYC").find((element) => element.tagName === "TD");
    expect(groupingCell).toBeTruthy();
    fireEvent.click(groupingCell as HTMLElement);

    expect(screen.getByRole("dialog", { name: /Detalle agrupación/i })).toBeTruthy();
    expect(screen.getByText("Población Excel")).toBeTruthy();
    expect(screen.getByText("Población matched Recibo")).toBeTruthy();
    expect(screen.getByText("Diferencia Excel")).toBeTruthy();
    expect(screen.getByText("Diferencia Recibo")).toBeTruthy();
    expect(screen.getAllByText("Esta diferencia corresponde a la métrica agrupada seleccionada.").length).toBeGreaterThan(0);
  });

  test.skip("legacy grouped PDF negative-zero display is removed", () => {
    appState.value.result.groupings = [
      {
        sourceSheet: "Análisis por puesto",
        groupingType: "puesto",
        groupId: "ATSACYC",
        groupName: "Administrativo/a Técnico SACYC",
        registroBase: "RETRIBUCIONES (PERIODO COMPLETO)",
        block: "Salario",
        metric: "Media",
        segment: "Mujeres",
        registroSheetValue: 100,
        registroRecalculatedValue: 100,
        excelDifference: 0,
        pdfRegistroRecalculatedValue: 100,
        pdfRecalculatedValue: 99.996,
        pdfDifference: -0.004,
        peopleCount: 1,
        matchedPeopleCount: 1,
        womenCount: 1,
        menCount: 0,
        matchedWomenCount: 1,
        matchedMenCount: 0,
        excludedPdfWithoutRegistroCount: 0,
        status: "OK",
        pdfStatus: "OK",
        detail: "Hoja agrupada comparada contra Empleados.",
      },
    ];

    render(<TablesView mode="agrupaciones" />);
    fireEvent.click(screen.getByRole("button", { name: "Comparación Recibo" }));

    expect(screen.queryByText(/-0,00/)).toBeNull();
    expect(screen.getAllByText("0,00 EUR").length).toBeGreaterThan(0);
  });
});
