// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
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
      ],
      concepts: [],
      unmappedConcepts: [],
      groupings: [],
    },
    filters: { query: "", center: "", group: "", status: "" },
    setFilters: vi.fn(),
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
});
