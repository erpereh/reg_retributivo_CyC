import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { compareAnalysis } from "@/lib/compare/comparePeople";
import { exportAnalysisToWorkbook } from "@/lib/export/exportExcel";
import { parsePayrollPdf } from "@/lib/parsers/payrollPdfParser";
import { parseRegistroRetributivo } from "@/lib/parsers/registroRetributivoParser";
import { formatEuro, parseSpanishMoney } from "@/lib/utils/money";
import { normalizeComparableText, normalizeProfessionalGroup } from "@/lib/utils/normalize";
import { parsePayrollPeriod, toIsoDate } from "@/lib/utils/spanishDates";

const root = process.cwd();
const fuentes = path.join(root, "fuentes");

describe("money utilities", () => {
  test("parses Spanish money formats", () => {
    expect(parseSpanishMoney("1.234,56")).toBe(1234.56);
    expect(parseSpanishMoney("-135,06")).toBe(-135.06);
    expect(parseSpanishMoney("")).toBeUndefined();
  });

  test("formats euro values in Spanish style", () => {
    expect(formatEuro(1234.5)).toContain("1.234,50");
  });
});

describe("normalization utilities", () => {
  test("normalizes accents, casing and duplicated whitespace", () => {
    expect(normalizeComparableText("  MARÍA   José  ")).toBe("maria jose");
  });

  test("normalizes professional group ordinal variants", () => {
    expect(normalizeProfessionalGroup("Grupo IV - Nivel V - Oficial de 1ª")).toBe(
      normalizeProfessionalGroup("grupo iv nivel v oficial de primera"),
    );
  });
});

describe("Spanish date utilities", () => {
  test("parses payroll period labels", () => {
    const period = parsePayrollPeriod("Del 1 al 31 Enero 2025");
    expect(period).toEqual({
      label: "Del 1 al 31 Enero 2025",
      start: "2025-01-01",
      end: "2025-01-31",
    });
  });

  test("normalizes dd/mm/yyyy and ISO dates", () => {
    expect(toIsoDate("01/02/1987")).toBe("1987-02-01");
    expect(toIsoDate("1987-02-01")).toBe("1987-02-01");
  });
});

describe("Registro Retributivo parser", () => {
  test("detects Empleados sheet, real header rows and salary columns", async () => {
    const file = readFileSync(
      path.join(fuentes, "IBER_Registro_Retributivo_(heredado)_20260630100936.xlsx"),
    );
    const result = await parseRegistroRetributivo(file);
    const first = result.records[0];

    expect(result.sheetName).toBe("Empleados");
    expect(result.headerRows).toEqual({ group: 11, subheader: 12, firstData: 13 });
    expect(result.columnMap.salary).toEqual(["F", "G", "H"]);
    expect(result.columnMap.gt).toEqual(["BV", "BW"]);
    expect(result.columnMap.workplace).toEqual(["CE", "CF"]);
    expect(result.columnMap.professionalGroup).toEqual(["AW", "AX"]);
    expect(first.employeeNumber).toBe("10048");
    expect(first.expectedSalary).toBeGreaterThan(60000);
  });
});

describe("Payroll PDF parser", () => {
  test("extracts first payroll page and excludes banking data", async () => {
    const file = readFileSync(path.join(fuentes, "RECIBOS_IBER_2025", "PDF_ENERO.pdf"));
    const result = await parsePayrollPdf(file, "PDF_ENERO.pdf");
    const first = result.records[0];

    expect(result.records.length).toBeGreaterThan(60);
    expect(first.workerNif).toBe("00397416E");
    expect(first.workerName).toBe("ISABEL CHAVERO TORRADO");
    expect(first.employeeNumber).toBe("10048");
    expect(first.workplace).toBe("Bilbao");
    expect(first.professionalGroup).toBe("Jefe de Primera");
    expect(first.gt).toBe("3");
    expect(first.totalDevengado).toBe(3641.26);
    expect(JSON.stringify(first)).not.toMatch(/ES\d{2}\s?\d{4}/);
  });
});

describe("comparison engine", () => {
  test("detects missing registro people and deterministic salary status", async () => {
    const result = await compareAnalysis(
      [
        {
          sourceFile: "PDF_TEST.pdf",
          periodLabel: "Del 1 al 31 Enero 2025",
          workerNif: "11111111H",
          workerName: "PERSONA AUSENTE",
          employeeNumber: "X1",
          concepts: [],
          totalDevengado: 100,
        },
        {
          sourceFile: "PDF_TEST.pdf",
          periodLabel: "Del 1 al 31 Enero 2025",
          workerNif: "22222222J",
          workerName: "PERSONA OK",
          employeeNumber: "X2",
          gt: "5",
          professionalGroup: "Jefe de Primera",
          concepts: [],
          totalDevengado: 150,
        },
      ],
      [
        {
          sourceRow: 13,
          workerNif: "22222222J",
          workerName: "PERSONA OK",
          employeeNumber: "X2",
          gt: "7",
          professionalGroup: "Jefe de Primera",
          expectedSalary: 120,
          raw: {},
        },
      ],
      { tolerance: 1 },
    );

    expect(result.fieldIssues.some((issue) => issue.workerNif === "11111111H" && issue.severity === "Alta")).toBe(
      true,
    );
    expect(result.fieldIssues.some((issue) => issue.workerNif === "22222222J" && issue.field.includes("GT"))).toBe(
      true,
    );
    expect(result.salaryDifferences.find((item) => item.workerNif === "22222222J")?.status).toBe("Revisar");
  });
});

describe("Excel export", () => {
  test("creates the four required sheets with styled headers and no banking data", async () => {
    const workbook = await exportAnalysisToWorkbook({
      summary: {
        generatedAt: "2026-07-02T10:00:00.000Z",
        pdfsAnalyzed: 1,
        pdfsFailed: 0,
        uniquePeople: 1,
        peopleWithIssues: 1,
        fieldIssuesCount: 1,
        salaryIssuesCount: 1,
        salaryDifferenceTotal: 30,
        salaryDifferenceAbsTotal: 30,
        tolerance: 1,
      },
      payrollRecords: [],
      registroRecords: [],
      fieldIssues: [
        {
          workerNif: "22222222J",
          workerName: "PERSONA OK",
          employeeNumber: "X2",
          field: "GT / Grupo de cotizacion",
          shouldBe: "7",
          actual: "5",
          affectedPeriods: ["Del 1 al 31 Enero 2025"],
          affectedFiles: ["PDF_TEST.pdf"],
          salaryShouldBe: 120,
          salaryActual: 150,
          salaryDifference: 30,
          severity: "Alta",
          observations: "Observacion sin datos bancarios.",
          recommendedAction: "Revisar dato maestro.",
        },
      ],
      salaryDifferences: [
        {
          workerNif: "22222222J",
          workerName: "PERSONA OK",
          employeeNumber: "X2",
          totalShouldBe: 120,
          totalActual: 150,
          difference: 30,
          payrollCount: 1,
          periodsIncluded: ["Del 1 al 31 Enero 2025"],
          status: "Revisar",
          observations: "Diferencia informativa.",
        },
      ],
      errors: [],
      criteria: ["Los datos bancarios se ignoran por privacidad."],
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Campos_mal",
      "Diferencia_Salarial",
      "Criterios",
    ]);
    expect(workbook.getWorksheet("Campos_mal")?.views[0]?.state).toBe("frozen");
    expect(workbook.getWorksheet("Campos_mal")?.getCell("A1").fill).toMatchObject({
      type: "pattern",
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    expect(JSON.stringify(reloaded.model)).not.toMatch(/IBAN|CUENTA|BANCO|ES\d{2}\s?\d{4}/i);
  });
});
