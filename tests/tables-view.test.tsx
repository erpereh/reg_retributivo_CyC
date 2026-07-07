// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TablesView } from "@/components/tables/TablesView";

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
          extraSalaryPdf: 50,
          extraSalaryDifference: 0,
          registroTotal: 1550,
          pdfTotal: 1550,
          totalDifference: 0,
          pdfControlTotalDevengado: 1550,
          payrollCount: 1,
          unmappedConceptsCount: 0,
          status: "OK",
          detail: "Detalle",
          periods: ["Enero 2025"],
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
          action: "Pendiente revisiÃ³n",
          recommendedAction: "Revisar codigo Registro",
          reason: "No existe codigo exacto",
        },
      ],
      groupings: [],
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
    expect(screen.getByText(/Compara por matrícula los importes del Registro frente a los importes detectados en nóminas PDF/i)).toBeTruthy();
    expect(screen.getByText(/Salario, Complemento Salarial y Extrasalarial/i)).toBeTruthy();

    rerender(<TablesView mode="conceptos" />);
    expect(screen.getByRole("heading", { name: "Conceptos" })).toBeTruthy();
    expect(screen.getByText(/Revisa el detalle concepto a concepto/i)).toBeTruthy();

    rerender(<TablesView mode="agrupaciones" />);
    expect(screen.getByRole("heading", { name: "Agrupaciones" })).toBeTruthy();
    expect(screen.getByText(/Comprueba que las hojas agrupadas del Registro cuadran con los datos recalculados desde la hoja Empleados/i)).toBeTruthy();
  });

  test("does not use technical implementation copy as the main table subtitle", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByText(/scroll horizontal|sticky|clicar cualquier fila/i)).toBeNull();
  });

  test("opens a deterministic person detail modal from the whole clickable row", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("dialog", { name: /Detalle persona/i })).toBeNull();

    fireEvent.click(screen.getByText("10048"));

    expect(screen.getByRole("dialog", { name: /Detalle persona/i })).toBeTruthy();
    expect(screen.getByText(/Causa probable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar con IA/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("IA no configurada. Añade GEMINI_API_KEY en .env")).toBeTruthy();
  });

  test("shows a compact person concept table before AI with filters, ordering and expandable detail", () => {
    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10048"));

    const conceptSection = screen.getByRole("region", { name: /Conceptos de la persona/i });

    expect(within(conceptSection).getByText("Conceptos de la persona")).toBeTruthy();
    expect(within(conceptSection).getByText(/Comparativa de conceptos del Registro/i)).toBeTruthy();
    expect(within(conceptSection).queryByRole("columnheader", { name: "Persona" })).toBeNull();
    expect(within(conceptSection).queryByRole("columnheader", { name: "Matrícula" })).toBeNull();
    expect(within(conceptSection).getByText(/Diferencia total de conceptos visibles/i)).toBeTruthy();
    expect(within(conceptSection).getByText(/Conceptos con diferencia real/i)).toBeTruthy();
    expect(within(conceptSection).getByText(/Conceptos OK/i)).toBeTruthy();

    const content = conceptSection.textContent ?? "";
    expect(content.indexOf("Abono teletrabajo")).toBeLessThan(content.indexOf("Salario Base"));
    expect(content.indexOf("Salario Base")).toBeLessThan(content.indexOf("Seguro Medico"));

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

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByText("10123"));
    conceptSection = screen.getByRole("region", { name: /Conceptos de la persona/i });
    content = conceptSection.textContent ?? "";
    expect(content.indexOf("Prestacion enfermedad 75")).toBeLessThan(content.indexOf("Ajuste extrasalarial"));
    expect(content.indexOf("Complemento IT")).toBeLessThan(content.indexOf("Ajuste extrasalarial"));
  });

  test("requests an AI explanation on demand without sending the person name", async () => {
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-3.1-flash-lite" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
    expect(screen.getByText(/revisar en Registro/i)).toBeTruthy();
    expect(screen.getByText(/revisar en PDF/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerar/i })).toBeTruthy();
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

  test("separates Excel validation from grouped PDF comparison", () => {
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
    expect(screen.getAllByText("Comparación PDF").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/usa solo personas matched y excluye matrículas PDF sin Registro/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Las hojas agrupadas cuadran con Empleados.")).toBeTruthy();
    expect(screen.getByText("Hojas analizadas")).toBeTruthy();
    expect(screen.getByText("Agrupaciones calculadas")).toBeTruthy();
    expect(screen.queryByText("Filas Excel OK")).toBeNull();
    expect(screen.getByText("Filas Excel con diferencia")).toBeTruthy();
    expect(screen.getByText("Filas PDF con diferencia")).toBeTruthy();
    expect(screen.getByText("PDF sin Registro excluidos")).toBeTruthy();
    expect(screen.queryByText("Dif. PDF Salario")).toBeNull();
    expect(screen.queryByText("Dif. PDF C. Salarial")).toBeNull();
    expect(screen.queryByText("Dif. PDF Extrasalarial")).toBeNull();
    const maxPdfCard = screen.getByText("Mayor diferencia PDF").closest("div");
    const affectedCard = screen.getByText("Agrupaciones PDF afectadas").closest("div");
    expect(maxPdfCard).toBeTruthy();
    expect(affectedCard).toBeTruthy();
    expect(within(maxPdfCard as HTMLElement).getByText("30,00 EUR")).toBeTruthy();
    expect(within(affectedCard as HTMLElement).getByText("1")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Base Registro" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /PDF recalculado/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Dif. PDF/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Comparación PDF" }));

    expect(screen.getByDisplayValue("RETRIBUCIONES (PERIODO COMPLETO)")).toBeTruthy();
    expect(screen.getByText(/Las diferencias PDF se muestran por métrica agrupada/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Registro periodo completo matched" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "PDF recalculado" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Dif. PDF" })).toBeTruthy();
    expect(screen.queryByText("TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES")).toBeNull();

    const groupingCell = screen.getAllByText("Administrativo/a Técnico SACYC").find((element) => element.tagName === "TD");
    expect(groupingCell).toBeTruthy();
    fireEvent.click(groupingCell as HTMLElement);

    expect(screen.getByRole("dialog", { name: /Detalle agrupación/i })).toBeTruthy();
    expect(screen.getByText("Población Excel")).toBeTruthy();
    expect(screen.getByText("Población matched PDF")).toBeTruthy();
    expect(screen.getByText("Diferencia Excel")).toBeTruthy();
    expect(screen.getByText("Diferencia PDF")).toBeTruthy();
    expect(screen.getAllByText("Esta diferencia corresponde a la métrica agrupada seleccionada.").length).toBeGreaterThan(0);
  });

  test("normalizes negative zero in grouped PDF display", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Comparación PDF" }));

    expect(screen.queryByText(/-0,00/)).toBeNull();
    expect(screen.getAllByText("0,00 EUR").length).toBeGreaterThan(0);
  });
});
