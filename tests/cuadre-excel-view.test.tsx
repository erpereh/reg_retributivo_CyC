// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CuadreExcelView } from "@/components/cuadre-excel/CuadreExcelView";

const appState = vi.hoisted(() => ({
  internalExcelChecksFixture: [
    {
      employeeNumber: "10048",
      salaryPeriod: 1000,
      salaryBreakdown: 1000,
      salaryDifference: 0,
      salaryComplementPeriod: 500,
      salaryComplementBreakdown: 500,
      salaryComplementDifference: 0,
      extraSalaryPeriod: 120,
      extraSalaryBreakdown: 120,
      extraSalaryDifference: 0,
      status: "OK",
      detail: "Cuadre correcto",
    },
    {
      employeeNumber: "10050",
      salaryPeriod: 1000,
      salaryBreakdown: 900,
      salaryDifference: 100,
      salaryComplementPeriod: 500,
      salaryComplementBreakdown: 400,
      salaryComplementDifference: 100,
      extraSalaryPeriod: 120,
      extraSalaryBreakdown: 120,
      extraSalaryDifference: 0,
      status: "Diferencia",
      detail: "Diferencia interna",
    },
  ],
  normalizedVariablesChecksFixture: [
    {
      employeeNumber: "10048",
      person: "Persona OK",
      workplace: "Bilbao",
      position: "Analista",
      category: "Grupo A",
      salaryPeriod: 1000,
      salaryNormalizedPlusVariables: 1000,
      salaryDifference: 0,
      salaryComplementPeriod: 500,
      salaryComplementNormalizedPlusVariables: 500,
      salaryComplementDifference: 0,
      extraSalaryPeriod: 120,
      extraSalaryNormalizedPlusVariables: 120,
      extraSalaryDifference: 0,
      totalPeriod: 1620,
      totalNormalizedPlusVariables: 1620,
      totalDifference: 0,
      status: "OK",
      detail: "Periodo completo cuadra con normalizado mas variables.",
    },
    {
      employeeNumber: "10051",
      person: "Persona Revisar",
      workplace: "Madrid",
      position: "Consultor",
      category: "Grupo B",
      salaryPeriod: 1000,
      salaryNormalizedPlusVariables: 990,
      salaryDifference: 10,
      salaryComplementPeriod: 500,
      salaryComplementNormalizedPlusVariables: 500,
      salaryComplementDifference: 0,
      extraSalaryPeriod: 120,
      extraSalaryNormalizedPlusVariables: 120,
      extraSalaryDifference: 0,
      totalPeriod: 1620,
      totalNormalizedPlusVariables: 1610,
      totalDifference: 10,
      status: "Revisar",
      detail: "Diferencia menor o igual a 50 EUR.",
    },
    {
      employeeNumber: "10052",
      person: "Persona Diferencia",
      workplace: "Sevilla",
      position: "Manager",
      category: "Grupo C",
      salaryPeriod: 1200,
      salaryNormalizedPlusVariables: 1000,
      salaryDifference: 200,
      salaryComplementPeriod: 500,
      salaryComplementNormalizedPlusVariables: 500,
      salaryComplementDifference: 0,
      extraSalaryPeriod: 120,
      extraSalaryNormalizedPlusVariables: 120,
      extraSalaryDifference: 0,
      totalPeriod: 1820,
      totalNormalizedPlusVariables: 1620,
      totalDifference: 200,
      status: "Diferencia",
      detail: "Diferencia mayor de 50 EUR.",
    },
  ],
  value: {
    result: {
      internalExcelChecks: [],
      internalExcelNormalizedVariablesChecks: [],
    },
    activeAnalysis: { id: "analysis-1" },
    settings: { autoExplainOnOpen: false },
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
    pushToast: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("CuadreExcelView", () => {
  beforeEach(() => {
    appState.value.result = {
      internalExcelChecks: structuredClone(appState.internalExcelChecksFixture),
      internalExcelNormalizedVariablesChecks: structuredClone(appState.normalizedVariablesChecksFixture),
    };
  });

  test("renders Cuadre Reg. with submenu and opens No norm. / Desglose by default", () => {
    render(<CuadreExcelView />);

    expect(screen.getByRole("heading", { name: "Cuadre Reg." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No norm. / Desglose" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "No norm. / Norm. + variables" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Compara las retribuciones del periodo completo frente a la suma de conceptos desglosados.")).toBeTruthy();

    const metricCards = screen.getAllByText("Empleados analizados")[0].closest("section") as HTMLElement;
    ["Empleados analizados", "OK", "Con diferencia", "Mayor diferencia", "Diferencia total visible"].forEach((label) => expect(within(metricCards).getByText(label)).toBeTruthy());
    expect(within(metricCards).getByText("100,00 EUR")).toBeTruthy();

    [
      "Matrícula",
      "Salario periodo completo",
      "Salario desglose",
      "Dif. Salario",
      "C. Salarial periodo completo",
      "C. Salarial desglose",
      "Dif. C. Salarial",
      "Extrasalarial periodo completo",
      "Extrasalarial desglose",
      "Dif. Extrasalarial",
      "Estado",
    ].forEach((header) => expect(screen.getByRole("columnheader", { name: header })).toBeTruthy());

    fireEvent.click(screen.getByText("10050"));

    expect(screen.getByRole("dialog", { name: /Detalle Cuadre Reg\./i })).toBeTruthy();
    expect(screen.getByText("Diferencia interna")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar con IA/i }).hasAttribute("disabled")).toBe(true);
  });

  test("switches to No norm. / Norm. + variables with independent KPIs, search and status filter", () => {
    render(<CuadreExcelView />);

    fireEvent.click(screen.getByRole("button", { name: "No norm. / Norm. + variables" }));

    expect(screen.getByRole("button", { name: "No norm. / Norm. + variables" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Compara las retribuciones del periodo completo frente al total normalizado más variables del Excel Reg. Retrib.")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Persona" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader", { name: "No norm." }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole("columnheader", { name: "Norm. + variables" }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole("columnheader", { name: "Dif." }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("columnheader", { name: "Observación" })).toBeTruthy();

    const metricCards = screen.getAllByText("Empleados analizados")[0].closest("section") as HTMLElement;
    expect(within(metricCards).getByText("3")).toBeTruthy();
    expect(within(metricCards).getByText("200,00 EUR")).toBeTruthy();
    expect(within(metricCards).getByText("210,00 EUR")).toBeTruthy();

    expect(screen.getByText("Persona OK")).toBeTruthy();
    expect(screen.getByText("Persona Revisar")).toBeTruthy();
    expect(screen.getByText("Persona Diferencia")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Buscar en Cuadre Reg."), { target: { value: "madrid" } });
    expect(screen.queryByText("Persona OK")).toBeNull();
    expect(screen.getByText("Persona Revisar")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Diferencia" } });
    expect(screen.queryByText("Persona Revisar")).toBeNull();
    expect(screen.queryByText("Persona Diferencia")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Buscar en Cuadre Reg."), { target: { value: "" } });
    expect(screen.getByText("Persona Diferencia")).toBeTruthy();
  });

  test("shows a legacy fallback when normalized variables check is missing", () => {
    appState.value.result = {
      internalExcelChecks: structuredClone(appState.internalExcelChecksFixture),
    } as never;

    render(<CuadreExcelView />);
    fireEvent.click(screen.getByRole("button", { name: "No norm. / Norm. + variables" }));

    expect(screen.getByText("Este análisis no contiene el cuadre No norm. / Norm. + variables. Vuelve a analizar el Excel para generarlo.")).toBeTruthy();
  });

  test("shows a clear OK message when every breakdown row matches", () => {
    appState.value.result.internalExcelChecks = appState.value.result.internalExcelChecks.map((row) => ({
      ...row,
      status: "OK",
      salaryDifference: 0,
      salaryComplementDifference: 0,
    }));

    render(<CuadreExcelView />);

    expect(screen.getByText("El Cuadre Reg. no presenta diferencias en No norm. / Desglose.")).toBeTruthy();
  });
});
