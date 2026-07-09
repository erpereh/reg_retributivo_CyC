// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CuadreExcelView } from "@/components/cuadre-excel/CuadreExcelView";

const appState = vi.hoisted(() => ({
  value: {
    result: {
      internalExcelChecks: [
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
  test("renders summary cards and the internal Excel check table", () => {
    render(<CuadreExcelView />);

    expect(screen.getByRole("heading", { name: "Cuadre interno del Excel" })).toBeTruthy();
    expect(screen.getByText("Valida que las retribuciones del periodo completo cuadran con el desglose de conceptos dentro del propio Reg. Retrib.")).toBeTruthy();

    ["Empleados comprobados", "Empleados OK", "Empleados con diferencia", "Diferencia total Salario", "Diferencia total C. Salarial", "Diferencia total Extrasalarial"].forEach((label) =>
      expect(screen.getByText(label)).toBeTruthy(),
    );

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

    expect(screen.getByRole("dialog", { name: /Detalle cuadre Excel/i })).toBeTruthy();
    expect(screen.getByText("Diferencia interna")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar con IA/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("IA no configurada. Añade GEMINI_API_KEY en .env")).toBeTruthy();
  });

  test("shows a clear OK message when every internal row matches", () => {
    appState.value.result.internalExcelChecks = appState.value.result.internalExcelChecks.map((row) => ({ ...row, status: "OK", salaryDifference: 0, salaryComplementDifference: 0 }));

    render(<CuadreExcelView />);

    expect(screen.getByText("El Excel cuadra internamente con su desglose de conceptos.")).toBeTruthy();
  });
});
