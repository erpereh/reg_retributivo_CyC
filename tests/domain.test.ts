import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { compareAnalysis } from "@/lib/compare/comparePeople";
import { buildDefaultConceptMap } from "@/lib/compare/conceptMapping";
import { exportAnalysisToWorkbook } from "@/lib/export/exportExcel";
import { buildRegistroGroupingComparisons, median, REGISTRO_GROUPING_BASES } from "@/lib/groupings/registroGroupings";
import { parsePayrollPdf } from "@/lib/parsers/payrollPdfParser";
import { parseRegistroRetributivo } from "@/lib/parsers/registroRetributivoParser";
import type { ConceptMappingRule, PayrollRecord, RegistroEmployee } from "@/lib/types";
import { formatEuro, parseSpanishMoney } from "@/lib/utils/money";
import { normalizeComparableText, normalizeProfessionalGroup } from "@/lib/utils/normalize";
import { parsePayrollPeriod, toIsoDate } from "@/lib/utils/spanishDates";

const root = process.cwd();
const fuentes = path.join(root, "fuentes");
const registroFile = path.join(fuentes, "IBER_Registro_Retributivo_(heredado)_20260630100936.xlsx");

function emptyRegistroEmployee(overrides: Partial<RegistroEmployee>): RegistroEmployee {
  return {
    sourceRow: 1,
    employeeNumber: "10048",
    normalizedPlusVariables: { salary: 0, salaryComplement: 0, extraSalary: 0, total: 0 },
    normalized: { salary: 0, salaryComplement: 0, extraSalary: 0, total: 0 },
    periodComplete: { salary: 0, salaryComplement: 0, extraSalary: 0, total: 0 },
    lastSituation: { salary: 0, salaryComplement: 0, extraSalary: 0, total: 0 },
    nonNormalized: {
      salaryComplementVariable: 0,
      extraSalaryVariable: 0,
      salaryPpe: 0,
      salaryComplementPpe: 0,
      salaryIt: 0,
      salaryComplementIt: 0,
    },
    excelBreakdownDiffs: { salary: 0, salaryComplement: 0, extraSalary: 0 },
    concepts: [],
    raw: {},
    ...overrides,
  };
}

function testRule(rule: Partial<ConceptMappingRule> & Pick<ConceptMappingRule, "pdfConcept" | "block" | "blockKey" | "status">) {
  return {
    normalizedPdfConcept: normalizeComparableText(rule.pdfConcept),
    ...rule,
  } as ConceptMappingRule;
}

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
  test("detects Empleados headers by real labels and extracts concept codes dynamically", async () => {
    const result = await parseRegistroRetributivo(readFileSync(registroFile));
    const first = result.records[0];

    expect(result.sheetName).toBe("Empleados");
    expect(result.headerRows).toEqual({ group: 11, subheader: 12, firstData: 13 });
    expect(result.columnMap.employeeNumber).toBe("A");
    expect(result.columnMap.sex).toBe("E");
    expect(result.columnMap.periodSalary).toBe("R");
    expect(result.columnMap.periodSalaryBreakdownDiff).toBe("S");
    expect(result.conceptCodes.salary).toContain("SSP_SAL_BASE");
    expect(result.conceptCodes.salaryComplement).toContain("SSP_ANTIGUEDAD");
    expect(result.conceptCodes.extraSalary).toContain("CYC_SEG_SALUD");
    expect(first.employeeNumber).toBe("10048");
    expect(first.sex).toBe("Mujer");
    expect(first.periodComplete.salary).toBe(29090.72);
    expect(first.concepts.some((concept) => concept.block === "Salario" && concept.code === "SSP_SAL_BASE")).toBe(true);
    expect(result.internalChecks.find((row) => row.employeeNumber === "10048")?.status).toBe("OK");
  });
});

describe("Registro grouped sheets", () => {
  test("calculates median robustly", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 1, 5, 7])).toBe(6);
    expect(median([undefined, Number.NaN, "x"])).toBe(0);
  });

  test("detects the five grouped sheets and recalculates the real Excel from Empleados", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const result = buildRegistroGroupingComparisons(readFileSync(registroFile), registro.records, {
      tolerance: 1,
      reviewThreshold: 1,
      incidentThreshold: 50,
    });

    expect(result.detectedSheets.map((sheet) => sheet.sourceSheet)).toEqual([
      "Análisis por puesto",
      "Análisis por valoración puesto",
      "Análisis por categoría",
      "Análisis por familia de puesto",
      "Agrupación Categoría Personal",
    ]);
    expect(result.groupCount).toBe(79);
    expect(new Set(result.rows.map((row) => row.registroBase))).toEqual(new Set(REGISTRO_GROUPING_BASES.map((base) => base.label)));
    expect(result.rows.length).toBeGreaterThan(4000);
    expect(result.rows.filter((row) => row.status !== "OK")).toEqual([]);
    expect(result.warnings).toEqual([]);

    const undefinedValuation = result.rows.find(
      (row) =>
        row.sourceSheet === "Análisis por valoración puesto" &&
        row.groupName === "[SIN DEFINIR]" &&
        row.registroBase === "RETRIBUCIONES (PERIODO COMPLETO)" &&
        row.block === "Salario" &&
        row.metric === "Media" &&
        row.segment === "Mujeres",
    );
    expect(undefinedValuation?.peopleCount).toBe(70);
    expect(undefinedValuation?.womenCount).toBe(30);
    expect(undefinedValuation?.menCount).toBe(40);

    const zeroMenDifference = result.rows.find(
      (row) =>
        row.sourceSheet === "Análisis por puesto" &&
        row.groupId === "ATSACYC" &&
        row.registroBase === "TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES" &&
        row.block === "Salario" &&
        row.metric === "Media" &&
        row.segment === "Diferencia %",
    );
    expect(zeroMenDifference?.registroSheetValue).toBe(0);
    expect(zeroMenDifference?.registroRecalculatedValue).toBe(0);
  });
});

describe("Payroll PDF parser", () => {
  test("extracts payroll concepts by employee number and classifies non-comparable lines conservatively", async () => {
    const result = await parsePayrollPdf(
      readFileSync(path.join(fuentes, "RECIBOS_IBER_2025", "PDF_ENERO.pdf")),
      "PDF_ENERO.pdf",
    );
    const first = result.records[0];

    expect(result.records.length).toBeGreaterThan(60);
    expect(first.employeeNumber).toBe("10048");
    expect(first.workerName).toBe("ISABEL CHAVERO TORRADO");
    expect(first.workplace).toBe("Bilbao");
    expect(first.totalDevengado).toBe(3641.26);
    expect(first.concepts.find((concept) => concept.name === "Salario Base")?.type).toBe("devengo");
    expect(first.concepts.find((concept) => normalizeComparableText(concept.name).includes("retencion a cuenta"))?.type).toBe("retencion");
    expect(first.concepts.find((concept) => normalizeComparableText(concept.name).includes("cotizacion regimen"))?.type).toBe("cotizacion");
    expect(first.concepts.find((concept) => normalizeComparableText(concept.name).includes("coste empresa"))?.type).toBe("coste_empresa");
    expect(first.concepts.find((concept) => normalizeComparableText(concept.name).includes("especie seguro"))?.type).toBe("especie");
    expect(first.concepts.find((concept) => normalizeComparableText(concept.name) === "seguro medico mensual")?.type).toBe("informativo");
    expect(first.concepts.map((concept) => normalizeComparableText(concept.name))).not.toContain(
      "suministrados en periodo de liquidacion",
    );
    expect(JSON.stringify(first)).not.toMatch(/ES\d{2}\s?\d{4}|IBAN|0128\s?8700/i);
  });
});

describe("concept mapping", () => {
  test("builds default mapping only with concept codes present in the loaded Excel", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const map = buildDefaultConceptMap(registro.conceptCodes);

    expect(map.find((rule) => rule.pdfConcept === "Salario Base")).toMatchObject({
      status: "Incluido",
      block: "Salario",
      registroCode: "SSP_SAL_BASE",
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "retencion a cuenta del irpf")?.status).toBe("Ignorado");
    expect(map.every((rule) => rule.status !== "Incluido" || rule.registroCode)).toBe(true);
    expect(map.every((rule) => rule.status !== "Incluido" || Boolean(rule.registroCode && registro.conceptCodes[rule.blockKey].includes(rule.registroCode)))).toBe(true);
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "seguro medico mensual")).toMatchObject({
      status: "Ignorado",
      includedInComparison: false,
      sourceType: "informativo",
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "complemento salario base organigrama")).toMatchObject({
      status: "Incluido",
      block: "C. Salarial",
      blockKey: "salaryComplement",
      registroCode: "CSP_I_COMP_SB_ORG",
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "prestacion de enfermedad al 75")).toMatchObject({
      status: "Incluido",
      block: "Salario",
      blockKey: "salary",
      registroCode: "SSP_PREST_ENF_75",
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "prestacion teorica maternidad")).toMatchObject({
      status: "Pendiente revisión",
      block: "C. Salarial",
      blockKey: "salaryComplement",
      registroCode: "CSP_I_AJUSTE_MATERNIDAD",
      includedInComparison: false,
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "kilometraje con retencion")).toMatchObject({
      status: "Incluido",
      registroCode: "SSP_KM_CON_RETEN",
    });
    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "kilometraje sin retencion")).toMatchObject({
      status: "Incluido",
      registroCode: "SSP_KM_SIN_RETEN",
    });
  });

  test("resolves rule block from the Excel concept code location instead of hardcoded defaults", () => {
    const map = buildDefaultConceptMap({
      salary: [],
      salaryComplement: ["CSP_I_PAGA_25_ANYOS"],
      extraSalary: [],
    });

    expect(map.find((rule) => normalizeComparableText(rule.pdfConcept) === "paga 25 anos")).toMatchObject({
      status: "Incluido",
      block: "C. Salarial",
      blockKey: "salaryComplement",
      registroCode: "CSP_I_PAGA_25_ANYOS",
    });
  });
});

describe("comparison engine", () => {
  test("uses employee number as key and calculates PDF totals from included mapped concepts", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const result = await compareAnalysis(
      [
        {
          sourceFile: "PDF_TEST.pdf",
          periodLabel: "Del 1 al 31 Enero 2025",
          workerNif: "11111111H",
          workerName: "PERSONA TEST",
          employeeNumber: "10048",
          concepts: [
            { name: "Salario Base", amount: 1000, type: "devengo" },
            { name: "Antiguedad", amount: 200, type: "devengo" },
            { name: "Retención a Cuenta del IRPF", amount: 300, type: "retencion" },
            { name: "Concepto Raro", amount: 50, type: "unknown" },
          ],
          totalDevengado: 1550,
        },
      ],
      registro.records,
      {
        tolerance: 1,
        conceptMap: buildDefaultConceptMap(registro.conceptCodes),
        enableAI: false,
      },
    );

    const person = result.people.find((row) => row.employeeNumber === "10048");
    expect(person?.pdfTotal).toBe(1200);
    expect(person?.pdfControlTotalDevengado).toBe(1550);
    expect(person?.salaryPdf).toBe(1000);
    expect(person?.salaryComplementPdf).toBe(200);
    expect(person?.unmappedConceptsCount).toBe(1);
    expect(result.unmappedConcepts.find((row) => row.pdfConcept === "Concepto Raro")).toMatchObject({
      totalDetected: 50,
      peopleCount: 1,
      payrollCount: 1,
    });
    expect(result.normalizedVsReal.find((row) => row.employeeNumber === "10048")?.realPdf).toBe(1200);
  });

  test("deduplicates informative health insurance when a real devengo exists in the same receipt only", async () => {
    const employee = emptyRegistroEmployee({
      employeeNumber: "10048",
      periodComplete: { salary: 0, salaryComplement: 0, extraSalary: 240, total: 240 },
      concepts: [{ block: "Extrasalarial", blockKey: "extraSalary", code: "CYC_SEG_SALUD", amount: 240 }],
    });
    const result = await compareAnalysis(
      [
        {
          sourceFile: "PDF_ENERO.pdf",
          pageNumber: 1,
          periodLabel: "Del 1 al 31 Enero 2025",
          workerName: "PERSONA TEST",
          employeeNumber: "10048",
          concepts: [
            { name: "Seguro Médico", amount: 120, type: "devengo" },
            { name: "Seguro Médico mensual", amount: 120, type: "informativo" },
          ],
        },
        {
          sourceFile: "PDF_FEBRERO.pdf",
          pageNumber: 1,
          periodLabel: "Del 1 al 28 Febrero 2025",
          workerName: "PERSONA TEST",
          employeeNumber: "10048",
          concepts: [
            { name: "Seguro Médico", amount: 120, type: "devengo" },
            { name: "Seguro Médico mensual", amount: 120, type: "informativo" },
          ],
        },
      ],
      [employee],
      {
        tolerance: 1,
        enableAI: false,
        conceptMap: [
          testRule({
            pdfConcept: "Seguro Médico",
            block: "Extrasalarial",
            blockKey: "extraSalary",
            registroCode: "CYC_SEG_SALUD",
            status: "Incluido",
            sourceType: "devengo",
            allowInformative: false,
            dedupePriority: "devengo",
            includedInComparison: true,
          } as Partial<ConceptMappingRule> & Pick<ConceptMappingRule, "pdfConcept" | "block" | "blockKey" | "status">),
          testRule({
            pdfConcept: "Seguro Médico mensual",
            block: "Extrasalarial",
            blockKey: "extraSalary",
            registroCode: "CYC_SEG_SALUD",
            status: "Incluido",
            sourceType: "informativo",
            allowInformative: true,
            dedupePriority: "informativo",
            includedInComparison: true,
          } as Partial<ConceptMappingRule> & Pick<ConceptMappingRule, "pdfConcept" | "block" | "blockKey" | "status">),
        ],
      },
    );

    const row = result.concepts.find((item) => item.registroCode === "CYC_SEG_SALUD");
    expect(row?.pdfAmount).toBe(240);
    expect(row?.pdfConcept).toContain("Seguro Médico");
    expect(result.ignoredConcepts.find((item) => item.pdfConcept === "Seguro Médico mensual")?.totalDetected).toBe(240);
  });

  test("allows explicitly mapped informative concepts when no real devengo exists", async () => {
    const employee = emptyRegistroEmployee({
      employeeNumber: "10048",
      periodComplete: { salary: 0, salaryComplement: 0, extraSalary: 50, total: 50 },
      concepts: [{ block: "Extrasalarial", blockKey: "extraSalary", code: "CYC_PLAN_PENSIONES_ORD", amount: 50 }],
    });
    const result = await compareAnalysis(
      [
        {
          sourceFile: "PDF_ENERO.pdf",
          pageNumber: 1,
          periodLabel: "Del 1 al 31 Enero 2025",
          workerName: "PERSONA TEST",
          employeeNumber: "10048",
          concepts: [{ name: "Plan de Pensiones Mensual", amount: 50, type: "informativo" }],
        },
      ],
      [employee],
      {
        tolerance: 1,
        enableAI: false,
        conceptMap: [
          testRule({
            pdfConcept: "Plan de Pensiones Mensual",
            block: "Extrasalarial",
            blockKey: "extraSalary",
            registroCode: "CYC_PLAN_PENSIONES_ORD",
            status: "Incluido",
            sourceType: "informativo",
            allowInformative: true,
            dedupePriority: "informativo",
            includedInComparison: true,
          } as Partial<ConceptMappingRule> & Pick<ConceptMappingRule, "pdfConcept" | "block" | "blockKey" | "status">),
        ],
      },
    );

    expect(result.concepts.find((item) => item.registroCode === "CYC_PLAN_PENSIONES_ORD")?.pdfAmount).toBe(50);
    expect(result.people.find((item) => item.employeeNumber === "10048")?.pdfTotal).toBe(50);
  });

  test("explains mostly compensated differences between retribution blocks", async () => {
    const employee = emptyRegistroEmployee({
      employeeNumber: "COMP01",
      periodComplete: { salary: 1000, salaryComplement: 1000, extraSalary: 0, total: 2000 },
      concepts: [
        { block: "Salario", blockKey: "salary", code: "SAL_TEST", amount: 1000 },
        { block: "C. Salarial", blockKey: "salaryComplement", code: "COMP_TEST", amount: 1000 },
      ],
    });
    const result = await compareAnalysis(
      [
        {
          sourceFile: "PDF_TEST.pdf",
          periodLabel: "Del 1 al 31 Enero 2025",
          workerName: "PERSONA TEST",
          employeeNumber: "COMP01",
          concepts: [
            { name: "Salario Test", amount: 1200, type: "devengo" },
            { name: "Complemento Test", amount: 800, type: "devengo" },
          ],
        },
      ],
      [employee],
      {
        tolerance: 1,
        enableAI: false,
        conceptMap: [
          testRule({
            pdfConcept: "Salario Test",
            block: "Salario",
            blockKey: "salary",
            registroCode: "SAL_TEST",
            status: "Incluido",
            includedInComparison: true,
          }),
          testRule({
            pdfConcept: "Complemento Test",
            block: "C. Salarial",
            blockKey: "salaryComplement",
            registroCode: "COMP_TEST",
            status: "Incluido",
            includedInComparison: true,
          }),
        ],
      },
    );

    expect(result.people.find((row) => row.employeeNumber === "COMP01")?.detail).toContain(
      "Diferencia principalmente compensada por reclasificacion entre bloques.",
    );
  });

  test("validates known Registro vs PDF corrections on real 2025 receipts", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const payrollDir = path.join(fuentes, "RECIBOS_IBER_2025");
    const payrollRecords: PayrollRecord[] = [];
    for (const fileName of readdirSync(payrollDir).filter((file) => file.toLowerCase().endsWith(".pdf")).sort()) {
      const parsed = await parsePayrollPdf(readFileSync(path.join(payrollDir, fileName)), fileName);
      payrollRecords.push(...parsed.records);
    }
    const result = await compareAnalysis(payrollRecords, registro.records, {
      tolerance: 1,
      conceptMap: buildDefaultConceptMap(registro.conceptCodes),
      enableAI: false,
    });

    const concept10048Health = result.concepts.find((row) => row.employeeNumber === "10048" && row.registroCode === "CYC_SEG_SALUD");
    const person10048 = result.people.find((row) => row.employeeNumber === "10048");
    const person10050 = result.people.find((row) => row.employeeNumber === "10050");
    const person10072 = result.people.find((row) => row.employeeNumber === "10072");
    const kmWithRetention = result.concepts.find((row) => row.employeeNumber === "10048" && row.registroCode === "SSP_KM_CON_RETEN");
    const kmWithoutRetention = result.concepts.find((row) => row.employeeNumber === "10048" && row.registroCode === "SSP_KM_SIN_RETEN");
    const km10099WithRetention = result.concepts.find((row) => row.employeeNumber === "10099" && row.registroCode === "SSP_KM_CON_RETEN");
    const km10099WithoutRetention = result.concepts.find((row) => row.employeeNumber === "10099" && row.registroCode === "SSP_KM_SIN_RETEN");
    const org10075 = result.concepts.find((row) => row.employeeNumber === "10075" && row.registroCode === "CSP_I_COMP_SB_ORG");
    const sick10123 = result.concepts.find((row) => row.employeeNumber === "10123" && row.registroCode === "SSP_PREST_ENF_75");
    const employee10358 = result.concepts.filter((row) => row.employeeNumber === "10358");

    expect(concept10048Health?.registroAmount).toBeCloseTo(817.11, 2);
    expect(concept10048Health?.pdfAmount).toBeCloseTo(817.11, 2);
    expect(Math.abs(person10048?.totalDifference ?? 0)).toBeCloseTo(208.05, 2);
    expect(Math.abs(person10050?.totalDifference ?? 0)).toBeCloseTo(208.01, 2);
    expect(person10072?.salaryComplementDifference).toBeCloseTo(841.92, 2);
    expect(Math.abs(person10072?.extraSalaryDifference ?? 0)).toBeCloseTo(208.01, 2);
    expect(kmWithRetention?.pdfAmount).toBeGreaterThan(0);
    expect(kmWithoutRetention?.pdfAmount).toBeGreaterThan(0);
    expect(km10099WithRetention?.pdfAmount).toBeCloseTo(km10099WithRetention?.registroAmount ?? 0, 2);
    expect(km10099WithoutRetention?.pdfAmount).toBeCloseTo(km10099WithoutRetention?.registroAmount ?? 0, 2);
    expect(org10075?.pdfAmount).toBeGreaterThan(0);
    expect(result.unmappedConcepts.map((row) => normalizeComparableText(row.pdfConcept))).not.toContain("complemento salario base organigrama");
    expect(sick10123?.pdfAmount).toBeGreaterThan(0);
    expect(result.unmappedConcepts.map((row) => normalizeComparableText(row.pdfConcept))).not.toContain("prestacion de enfermedad al 75");
    expect(employee10358.find((row) => row.registroCode === "SSP_SAL_BASE")?.pdfAmount).toBeGreaterThan(0);
    expect(employee10358.find((row) => row.registroCode === "SSP_ANTIGUEDAD")?.pdfAmount).toBeGreaterThan(0);
    expect(employee10358.find((row) => row.registroCode === "CSP_P_EXT_PRORRAT_NN")?.pdfAmount).toBeGreaterThan(0);
    expect(employee10358.find((row) => row.registroCode === "CSP_I_COMP_PTO_TRA")?.pdfAmount).toBeGreaterThan(0);
    expect(result.summary.totalGlobalDifference).toBe(result.summary.matchedTotalDifference);
    expect(result.summary.peopleInPdfWithoutRegistro).toBe(9);
    expect(result.summary.peopleInRegistroWithoutPdf).toBeGreaterThanOrEqual(0);
    expect(result.summary.conceptsPendingReview).toBe(2);
    expect(result.summary.conceptsIgnored).toBe(35);
    expect(result.summary.conceptsNotIncluded).toBe(37);
    expect(result.summary.conceptsRealUnmapped).toBe(0);
    expect(result.summary.pendingDecisionPdfTotal).toBeCloseTo(16358.04, 2);

    const nonIncludedOrder = result.unmappedConcepts.map((row) => row.decisionType);
    expect(nonIncludedOrder.slice(0, 2)).toEqual(["Pendiente revision", "Pendiente revision"]);
    expect(nonIncludedOrder.lastIndexOf("Pendiente revision")).toBe(1);

    const maternity = result.unmappedConcepts.find((row) => normalizeComparableText(row.pdfConcept) === "prestacion teorica maternidad");
    expect(maternity).toMatchObject({
      decisionType: "Pendiente revision",
      includedInComparison: false,
      suggestedBlock: "C. Salarial",
      suggestedRegistroCode: "CSP_I_AJUSTE_MATERNIDAD",
    });
    expect(maternity?.reason).toContain("teorica");

    const fortyYears = result.unmappedConcepts.find((row) => normalizeComparableText(row.pdfConcept) === "paga 40 anos");
    expect(fortyYears).toMatchObject({
      decisionType: "Pendiente revision",
      includedInComparison: false,
      suggestedBlock: "C. Salarial",
    });
    expect(fortyYears?.suggestedRegistroCode).toBeUndefined();
    expect(fortyYears?.reason).toContain("No existe codigo exacto");

    const ignoredHealth = result.unmappedConcepts.find((row) => normalizeComparableText(row.pdfConcept) === "seguro medico mensual");
    expect(ignoredHealth).toMatchObject({
      decisionType: "Ignorado",
      includedInComparison: false,
    });
    expect(ignoredHealth?.reason).toContain("duplicado");
  });
});


describe("Excel export", () => {
  test("creates phase 1 sheets and excludes NIF and banking data", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const analysis = await compareAnalysis([], [registro.records[0]], {
      tolerance: 1,
      conceptMap: buildDefaultConceptMap(registro.conceptCodes),
      enableAI: false,
    });
    const workbook = await exportAnalysisToWorkbook(analysis);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Personas",
      "Normalizado_vs_Real",
      "Conceptos",
      "Conceptos_no_incluidos",
      "PDF_sin_Registro",
      "Registro_sin_PDF",
      "Agrupaciones",
      "Cuadre_Interno_Excel",
      "Criterios",
    ]);
    expect(workbook.getWorksheet("Agrupaciones")?.getCell("A2").value).toBe("Pendiente de implementación / Sin datos calculados");
    const resumenValues = new Set(workbook.getWorksheet("Resumen")?.getColumn(1).values.map(String));
    expect(resumenValues.has("Conceptos sin mapear")).toBe(false);
    expect(resumenValues.has("Conceptos pendientes de revisión")).toBe(true);
    expect(resumenValues.has("Conceptos ignorados")).toBe(true);
    expect(resumenValues.has("Conceptos no incluidos")).toBe(true);
    expect(resumenValues.has("Conceptos sin mapear reales")).toBe(true);
    expect(resumenValues.has("Importe pendiente de decisión")).toBe(true);
    expect(
      [...(workbook.getWorksheet("Resumen")?.getColumn(2).values ?? [])].some(
        (value) =>
          typeof value === "string" &&
          value.includes("conceptos PDF pendientes de decisión") &&
          value.includes("diferencia matched"),
      ),
    ).toBe(true);
    expect(workbook.getWorksheet("Conceptos_no_incluidos")?.getRow(1).values).toEqual([
      undefined,
      "Tipo decisión",
      "Incluido en cálculo",
      "Concepto PDF",
      "Total detectado",
      "N personas",
      "N nóminas",
      "Ejemplos matrículas",
      "Sugerencia bloque",
      "Sugerencia código Registro",
      "Acción recomendada",
      "Motivo",
    ]);
    expect(workbook.getWorksheet("Personas")?.getRow(1).values).toContain("Detalle");

    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    const serialized = JSON.stringify(reloaded.model);
    expect(serialized).not.toMatch(/ES\d{2}\s?\d{4}|00397416E|0128\s?8700/i);
  });

  test("exports Agrupaciones with real Registro vs Empleados data and no PDF columns", async () => {
    const registro = await parseRegistroRetributivo(readFileSync(registroFile));
    const groupingResult = buildRegistroGroupingComparisons(readFileSync(registroFile), registro.records, {
      tolerance: 1,
      reviewThreshold: 1,
      incidentThreshold: 50,
    });
    const analysis = await compareAnalysis([], [registro.records[0]], {
      tolerance: 1,
      conceptMap: buildDefaultConceptMap(registro.conceptCodes),
      enableAI: false,
    });
    const workbook = await exportAnalysisToWorkbook({
      ...analysis,
      groupings: groupingResult.rows,
      summary: { ...analysis.summary, groupingDifferences: groupingResult.rows.filter((row) => row.status !== "OK").length },
    });
    const sheet = workbook.getWorksheet("Agrupaciones");

    expect(sheet?.getCell("A2").value).not.toBe("Pendiente de implementación");
    expect(sheet?.rowCount).toBeGreaterThan(4000);
    expect(sheet?.getRow(1).values).toContain("Base Registro");
    expect(sheet?.getRow(1).values).toContain("Valor hoja agrupada");
    expect(sheet?.getRow(1).values).toContain("Valor recalculado Empleados");
    expect(sheet?.getRow(1).values).not.toContain("PDF recalculado");
    expect(sheet?.getRow(1).values).not.toContain("Dif. PDF");
  });
});
