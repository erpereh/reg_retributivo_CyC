import type { AnalysisResult, FieldIssue, PayrollRecord, RegistroRecord, SalaryDifference } from "@/lib/types";
import { generateIssueObservation } from "@/lib/ai/observations";
import { areFieldValuesEqual } from "@/lib/compare/compareFields";
import { calculateDifference, DEFAULT_INCIDENT_THRESHOLD, DEFAULT_REVIEW_THRESHOLD, salaryStatus } from "@/lib/compare/salaryDiff";
import { severityForField } from "@/lib/compare/severity";
import { normalizeComparableText, normalizeEmployeeNumber, normalizeNif } from "@/lib/utils/normalize";

export interface CompareOptions {
  readonly tolerance: number;
  readonly enableAI?: boolean;
  readonly aiModel?: string;
  readonly reviewThreshold?: number;
  readonly incidentThreshold?: number;
}

function keyByNif(records: readonly RegistroRecord[]): Map<string, RegistroRecord> {
  const entries: Array<[string, RegistroRecord]> = [];
  records.forEach((record) => {
    const key = normalizeNif(record.workerNif);
    if (key) {
      entries.push([key, record]);
    }
  });
  return new Map(entries);
}

function keyByEmployee(records: readonly RegistroRecord[]): Map<string, RegistroRecord> {
  const entries: Array<[string, RegistroRecord]> = [];
  records.forEach((record) => {
    const key = normalizeEmployeeNumber(record.employeeNumber);
    if (key) {
      entries.push([key, record]);
    }
  });
  return new Map(entries);
}

function groupPayroll(records: readonly PayrollRecord[]): Map<string, PayrollRecord[]> {
  const grouped = new Map<string, PayrollRecord[]>();
  for (const record of records) {
    const key = normalizeNif(record.workerNif) || normalizeEmployeeNumber(record.employeeNumber) || normalizeComparableText(record.workerName);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  return grouped;
}

function findRegistro(record: PayrollRecord, nifMap: Map<string, RegistroRecord>, employeeMap: Map<string, RegistroRecord>, records: readonly RegistroRecord[]): RegistroRecord | undefined {
  return (
    nifMap.get(normalizeNif(record.workerNif)) ??
    employeeMap.get(normalizeEmployeeNumber(record.employeeNumber)) ??
    records.find(
      (registro) =>
        normalizeComparableText(registro.workerName) === normalizeComparableText(record.workerName) &&
        normalizeComparableText(registro.workplace) === normalizeComparableText(record.workplace),
    )
  );
}

async function createIssue(input: {
  readonly payroll: readonly PayrollRecord[];
  readonly registro?: RegistroRecord;
  readonly field: string;
  readonly shouldBe: string;
  readonly actual: string;
  readonly salaryShouldBe?: number;
  readonly salaryActual?: number;
  readonly salaryDifference?: number;
  readonly options: CompareOptions;
}): Promise<FieldIssue> {
  const first = input.payroll[0];
  const severity = severityForField(input.field, input.salaryDifference);
  const observation = await generateIssueObservation({
    field: input.field,
    shouldBe: input.shouldBe,
    actual: input.actual,
    context: input.payroll.map((record) => record.periodLabel).join(", "),
    salaryDifference: input.salaryDifference,
    severity,
    issueType: input.field,
  }, { enableAI: input.options.enableAI, model: input.options.aiModel });

  return {
    workerNif: first.workerNif,
    workerName: first.workerName,
    employeeNumber: first.employeeNumber,
    field: input.field,
    shouldBe: input.shouldBe,
    actual: input.actual,
    affectedPeriods: [...new Set(input.payroll.map((record) => record.periodLabel))],
    affectedFiles: [...new Set(input.payroll.map((record) => `${record.sourceFile}${record.pageNumber ? ` p.${record.pageNumber}` : ""}`))],
    salaryShouldBe: input.salaryShouldBe,
    salaryActual: input.salaryActual,
    salaryDifference: input.salaryDifference,
    severity: observation.severity ?? severity,
    observations: observation.observations,
    recommendedAction: observation.recommendedAction,
  };
}

export async function compareAnalysis(
  payrollRecords: readonly PayrollRecord[],
  registroRecords: readonly RegistroRecord[],
  options: CompareOptions,
): Promise<AnalysisResult> {
  const nifMap = keyByNif(registroRecords);
  const employeeMap = keyByEmployee(registroRecords);
  const grouped = groupPayroll(payrollRecords);
  const fieldIssues: FieldIssue[] = [];
  const salaryDifferences: SalaryDifference[] = [];

  for (const payrollGroup of grouped.values()) {
    const first = payrollGroup[0];
    const registro = findRegistro(first, nifMap, employeeMap, registroRecords);
    const totalActual = Number(
      payrollGroup.reduce((sum, payroll) => sum + (payroll.totalDevengado ?? 0), 0).toFixed(2),
    );

    if (!registro) {
      fieldIssues.push(
        await createIssue({
          payroll: payrollGroup,
          field: "Persona / matricula en Registro",
          shouldBe: `Matricula ${first.employeeNumber ?? first.workerNif} incluida en Registro, si entra en alcance`,
          actual: "No existe en el Registro Retributivo aportado",
          salaryActual: totalActual,
          salaryDifference: totalActual,
          options,
        }),
      );
      salaryDifferences.push({
        workerNif: first.workerNif,
        workerName: first.workerName,
        employeeNumber: first.employeeNumber,
        workplace: first.workplace,
        professionalGroup: first.professionalGroup,
        gt: first.gt,
        totalShouldBe: 0,
        totalActual,
        difference: totalActual,
        payrollCount: payrollGroup.length,
        periodsIncluded: [...new Set(payrollGroup.map((payroll) => payroll.periodLabel))],
        status: "Falta en Registro",
        observations: "Aparece en nominas, pero no tiene linea equivalente en el Registro.",
      });
      continue;
    }

    const totalShouldBe = registro.expectedSalary ?? 0;
    const difference = calculateDifference(totalActual, totalShouldBe);
    const fields: ReadonlyArray<[string, unknown, unknown]> = [
      ["Nombre", registro.workerName, first.workerName],
      ["Matricula", registro.employeeNumber, first.employeeNumber],
      ["Centro de trabajo", registro.workplace, first.workplace],
      ["Grupo profesional / categoria", registro.professionalGroup, first.professionalGroup],
      ["GT / Grupo de cotizacion", registro.gt, first.gt],
      ["Antiguedad", registro.seniorityDate, first.seniorityDate],
    ];

    for (const [field, expected, actual] of fields) {
      if (expected && actual && !areFieldValuesEqual(field, expected, actual)) {
        fieldIssues.push(
          await createIssue({
            payroll: payrollGroup,
            registro,
            field,
            shouldBe: String(expected),
            actual: String(actual),
            salaryShouldBe: totalShouldBe,
            salaryActual: totalActual,
            salaryDifference: difference,
            options,
          }),
        );
      }
    }

    salaryDifferences.push({
      workerNif: first.workerNif,
      workerName: first.workerName,
      employeeNumber: first.employeeNumber,
      workplace: first.workplace ?? registro.workplace,
      professionalGroup: first.professionalGroup ?? registro.professionalGroup,
      gt: first.gt ?? registro.gt,
      totalShouldBe,
      totalActual,
      difference,
      payrollCount: payrollGroup.length,
      periodsIncluded: [...new Set(payrollGroup.map((payroll) => payroll.periodLabel))],
      status: salaryStatus(difference, {
        tolerance: options.tolerance,
        reviewThreshold: options.reviewThreshold,
        incidentThreshold: options.incidentThreshold,
      }),
      observations: "La diferencia compara Total Devengado de PDFs frente al total del Registro.",
    });
  }

  const peopleWithIssues = new Set(fieldIssues.map((issue) => issue.workerNif));
  const reviewThreshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const incidentThreshold = options.incidentThreshold ?? DEFAULT_INCIDENT_THRESHOLD;
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      pdfsAnalyzed: payrollRecords.length,
      pdfsFailed: 0,
      uniquePeople: grouped.size,
      peopleWithIssues: peopleWithIssues.size,
      fieldIssuesCount: fieldIssues.length,
      salaryIssuesCount: salaryDifferences.filter((item) => item.status !== "OK").length,
      salaryDifferenceTotal: Number(salaryDifferences.reduce((sum, item) => sum + item.difference, 0).toFixed(2)),
      salaryDifferenceAbsTotal: Number(salaryDifferences.reduce((sum, item) => sum + Math.abs(item.difference), 0).toFixed(2)),
      tolerance: options.tolerance,
      aiEnabled: options.enableAI !== false,
      aiModel: options.aiModel,
      reviewThreshold,
      incidentThreshold,
    },
    payrollRecords,
    registroRecords,
    fieldIssues,
    salaryDifferences,
    errors: [],
    criteria: [
      "Cruce principal por NIF; fallback por matricula y nombre normalizado + centro.",
      "Diferencia salarial = Total esta en nominas - Total deberia en Registro.",
      `Tolerancia usada: ${options.tolerance} EUR.`,
      `Umbral revisar: ${reviewThreshold} EUR; umbral incidencia: ${incidentThreshold} EUR.`,
      options.enableAI === false
        ? "IA desactivada para observaciones; se usan textos deterministas."
        : "Gemini solo se usa para observaciones; los importes son deterministas.",
      "Los datos bancarios se ignoran por privacidad.",
    ],
  };
}
