import type {
  AnalysisResult,
  AnalysisStatus,
  ConceptComparisonRow,
  ConceptMappingRule,
  IgnoredConceptRow,
  InternalExcelCheckRow,
  MoneyByBlock,
  NormalizedVsRealRow,
  PayrollConcept,
  PayrollRecord,
  PersonComparisonRow,
  RegistroEmployee,
  UnmappedConceptRow,
} from "@/lib/types";
import { findConceptRule, mappingStatusFromConceptType } from "@/lib/compare/conceptMapping";
import { roundMoney } from "@/lib/utils/money";
import { normalizeComparableText, normalizeEmployeeNumber } from "@/lib/utils/normalize";

export interface CompareOptions {
  readonly tolerance: number;
  readonly enableAI?: boolean;
  readonly aiModel?: string;
  readonly reviewThreshold?: number;
  readonly incidentThreshold?: number;
  readonly conceptMap?: readonly ConceptMappingRule[];
  readonly internalExcelChecks?: readonly InternalExcelCheckRow[];
}

interface PayrollAggregate {
  readonly records: PayrollRecord[];
  readonly included: Map<string, { amount: number; pdfConcepts: Set<string> }>;
  readonly totals: { salary: number; salaryComplement: number; extraSalary: number };
  readonly unmapped: Map<string, { amount: number; people: Set<string>; payrolls: Set<string> }>;
  readonly ignored: Map<string, { amount: number; people: Set<string>; payrolls: Set<string>; reason: string }>;
}

const DISALLOWED_INCLUDED_TYPES = new Set(["retencion", "cotizacion", "deduccion", "especie", "coste_empresa"]);

interface IncludedCandidate {
  readonly concept: PayrollConcept;
  readonly rule: ConceptMappingRule & { registroCode: string };
  readonly employeeNumber: string;
  readonly payrollId: string;
}

function emptyMoney(): MoneyByBlock {
  return { salary: 0, salaryComplement: 0, extraSalary: 0, total: 0 };
}

function statusFromDifference(difference: number, options: CompareOptions): AnalysisStatus {
  const abs = Math.abs(difference);
  const tolerance = Math.max(0, options.tolerance);
  const incidentThreshold = Math.max(options.reviewThreshold ?? tolerance, options.incidentThreshold ?? 50);
  if (abs <= tolerance) {
    return "OK";
  }
  return abs >= incidentThreshold ? "Diferencia" : "Revisar";
}

function worstStatus(statuses: readonly AnalysisStatus[]): AnalysisStatus {
  if (statuses.includes("Sin Registro")) return "Sin Registro";
  if (statuses.includes("Sin PDF")) return "Sin PDF";
  if (statuses.includes("Sin mapear")) return "Sin mapear";
  if (statuses.includes("Diferencia")) return "Diferencia";
  if (statuses.includes("Revisar")) return "Revisar";
  return "OK";
}

function groupPayroll(records: readonly PayrollRecord[]): Map<string, PayrollRecord[]> {
  const grouped = new Map<string, PayrollRecord[]>();
  records.forEach((record) => {
    const key = normalizeEmployeeNumber(record.employeeNumber);
    if (!key) {
      return;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  });
  return grouped;
}

function addGrouped(
  map: Map<string, { amount: number; people: Set<string>; payrolls: Set<string>; reason?: string }>,
  key: string,
  amount: number,
  employeeNumber: string,
  payrollId: string,
  reason?: string,
): void {
  const current = map.get(key) ?? { amount: 0, people: new Set<string>(), payrolls: new Set<string>(), reason };
  current.amount = roundMoney(current.amount + amount);
  current.people.add(employeeNumber);
  current.payrolls.add(payrollId);
  if (reason) {
    current.reason = reason;
  }
  map.set(key, current);
}

function shouldIncludeConcept(rule: ConceptMappingRule | undefined, concept: PayrollConcept): rule is ConceptMappingRule & { registroCode: string } {
  if (!rule?.registroCode || rule.status !== "Incluido" || rule.includedInComparison === false || DISALLOWED_INCLUDED_TYPES.has(concept.type)) {
    return false;
  }
  if (concept.type === "informativo" && !rule.allowInformative) {
    return false;
  }
  return true;
}

function priorityValue(candidate: IncludedCandidate): number {
  return candidate.rule.dedupePriority === "informativo" || candidate.concept.type === "informativo" ? 1 : 2;
}

function addIncludedConcept(aggregate: PayrollAggregate, candidate: IncludedCandidate): void {
  const { concept, rule } = candidate;
  const current = aggregate.included.get(rule.registroCode) ?? { amount: 0, pdfConcepts: new Set<string>() };
  current.amount = roundMoney(current.amount + concept.amount);
  current.pdfConcepts.add(concept.name);
  aggregate.included.set(rule.registroCode, current);
  aggregate.totals[rule.blockKey] = roundMoney(aggregate.totals[rule.blockKey] + concept.amount);
}

function addIgnoredCandidate(aggregate: PayrollAggregate, candidate: IncludedCandidate, reason: string): void {
  addGrouped(aggregate.ignored, candidate.concept.name, candidate.concept.amount, candidate.employeeNumber, candidate.payrollId, reason);
}

function addIncludedCandidatesForRecord(aggregate: PayrollAggregate, candidates: readonly IncludedCandidate[]): void {
  const byRegistroCode = new Map<string, IncludedCandidate[]>();
  candidates.forEach((candidate) => {
    byRegistroCode.set(candidate.rule.registroCode, [...(byRegistroCode.get(candidate.rule.registroCode) ?? []), candidate]);
  });

  byRegistroCode.forEach((codeCandidates) => {
    const bestPriority = Math.max(...codeCandidates.map(priorityValue));
    const selected = codeCandidates.filter((candidate) => priorityValue(candidate) === bestPriority);
    const selectedSignatures = new Set<string>();

    selected.forEach((candidate) => {
      const signature = `${normalizeComparableText(candidate.concept.name)}|${candidate.concept.amount}|${candidate.concept.type}`;
      if (selectedSignatures.has(signature)) {
        addIgnoredCandidate(aggregate, candidate, "Duplicado exacto detectado dentro del mismo recibo.");
        return;
      }
      selectedSignatures.add(signature);
      addIncludedConcept(aggregate, candidate);
    });

    codeCandidates
      .filter((candidate) => priorityValue(candidate) < bestPriority)
      .forEach((candidate) =>
        addIgnoredCandidate(
          aggregate,
          candidate,
          "Concepto informativo descartado porque existe un devengo real para el mismo codigo en el mismo recibo.",
        ),
      );
  });
}

function aggregatePayroll(records: readonly PayrollRecord[], conceptMap: readonly ConceptMappingRule[]): PayrollAggregate {
  const aggregate: PayrollAggregate = {
    records: [...records],
    included: new Map(),
    totals: { salary: 0, salaryComplement: 0, extraSalary: 0 },
    unmapped: new Map(),
    ignored: new Map(),
  };

  records.forEach((record) => {
    const employeeNumber = normalizeEmployeeNumber(record.employeeNumber) || "SIN_MATRICULA";
    const payrollId = `${record.sourceFile}${record.pageNumber ? ` p.${record.pageNumber}` : ""}`;
    const includedCandidates: IncludedCandidate[] = [];

    record.concepts.forEach((concept) => {
      const rule = findConceptRule(conceptMap, concept.name);
      if (shouldIncludeConcept(rule, concept)) {
        includedCandidates.push({ concept, rule, employeeNumber, payrollId });
        return;
      }

      if (rule?.status === "Ignorado" || mappingStatusFromConceptType(concept.type) === "Ignorado") {
        addGrouped(
          aggregate.ignored,
          concept.name,
          concept.amount,
          employeeNumber,
          payrollId,
          rule?.reason ?? "Concepto excluido por tipo conservador.",
        );
        return;
      }

      addGrouped(aggregate.unmapped, concept.name, concept.amount, employeeNumber, payrollId);
    });

    addIncludedCandidatesForRecord(aggregate, includedCandidates);
  });

  return aggregate;
}

function payrollControlTotal(records: readonly PayrollRecord[]): number {
  return roundMoney(records.reduce((sum, record) => sum + (record.totalDevengado ?? 0), 0));
}

function personStatus(input: {
  readonly hasRegistro: boolean;
  readonly hasPdf: boolean;
  readonly unmappedCount: number;
  readonly differences: readonly number[];
  readonly options: CompareOptions;
}): AnalysisStatus {
  if (!input.hasRegistro) return "Sin Registro";
  if (!input.hasPdf) return "Sin PDF";
  const diffStatus = worstStatus(input.differences.map((difference) => statusFromDifference(difference, input.options)));
  if (diffStatus === "OK" && input.unmappedCount > 0) return "Sin mapear";
  return diffStatus;
}

function justification(employee: RegistroEmployee | undefined, aggregate: PayrollAggregate | undefined): string {
  if (!employee) return "Persona detectada en PDF sin línea equivalente en Registro.";
  if (!aggregate?.records.length) return "No se han detectado PDFs para la matrícula.";
  if (aggregate.unmapped.size) return "Conceptos no mapeados pendientes de revisión.";
  if (
    employee.nonNormalized.salaryComplementVariable ||
    employee.nonNormalized.extraSalaryVariable ||
    employee.nonNormalized.salaryPpe ||
    employee.nonNormalized.salaryComplementPpe ||
    employee.nonNormalized.salaryIt ||
    employee.nonNormalized.salaryComplementIt
  ) {
    return "Registro contiene importes variables, PPE o IT que pueden explicar diferencias entre normalizado y real.";
  }
  return "Sin justificación detectada.";
}

function createConceptRows(
  employee: RegistroEmployee,
  aggregate: PayrollAggregate | undefined,
  options: CompareOptions,
): ConceptComparisonRow[] {
  const rows: ConceptComparisonRow[] = [];
  employee.concepts.forEach((concept) => {
    const pdf = aggregate?.included.get(concept.code);
    const pdfAmount = pdf?.amount ?? 0;
    if (!concept.amount && !pdfAmount) {
      return;
    }
    const difference = roundMoney(pdfAmount - concept.amount);
    rows.push({
      employeeNumber: employee.employeeNumber,
      person: employee.workerName,
      block: concept.block,
      blockKey: concept.blockKey,
      registroCode: concept.code,
      pdfConcept: pdf ? [...pdf.pdfConcepts].join("; ") : undefined,
      registroAmount: concept.amount,
      pdfAmount,
      difference,
      status: statusFromDifference(difference, options),
      detail: "Comparación por código de concepto del Registro frente a conceptos PDF incluidos por el mapa.",
    });
  });
  return rows;
}

function createUnmappedRows(aggregates: readonly PayrollAggregate[]): UnmappedConceptRow[] {
  const combined = new Map<string, { amount: number; people: Set<string>; payrolls: Set<string> }>();
  aggregates.forEach((aggregate) => {
    aggregate.unmapped.forEach((value, key) => {
      const current = combined.get(key) ?? { amount: 0, people: new Set<string>(), payrolls: new Set<string>() };
      current.amount = roundMoney(current.amount + value.amount);
      value.people.forEach((item) => current.people.add(item));
      value.payrolls.forEach((item) => current.payrolls.add(item));
      combined.set(key, current);
    });
  });

  return [...combined.entries()]
    .map(([pdfConcept, value]) => ({
      pdfConcept,
      totalDetected: value.amount,
      peopleCount: value.people.size,
      payrollCount: value.payrolls.size,
      exampleEmployeeNumbers: [...value.people].slice(0, 5),
      action: "Pendiente revisión" as const,
    }))
    .sort((a, b) => Math.abs(b.totalDetected) - Math.abs(a.totalDetected));
}

function createIgnoredRows(aggregates: readonly PayrollAggregate[]): IgnoredConceptRow[] {
  const combined = new Map<string, { amount: number; people: Set<string>; payrolls: Set<string>; reason: string }>();
  aggregates.forEach((aggregate) => {
    aggregate.ignored.forEach((value, key) => {
      const current = combined.get(key) ?? { amount: 0, people: new Set<string>(), payrolls: new Set<string>(), reason: value.reason };
      current.amount = roundMoney(current.amount + value.amount);
      value.people.forEach((item) => current.people.add(item));
      value.payrolls.forEach((item) => current.payrolls.add(item));
      combined.set(key, current);
    });
  });

  return [...combined.entries()]
    .map(([pdfConcept, value]) => ({
      pdfConcept,
      totalDetected: value.amount,
      peopleCount: value.people.size,
      payrollCount: value.payrolls.size,
      reason: value.reason,
    }))
    .sort((a, b) => Math.abs(b.totalDetected) - Math.abs(a.totalDetected));
}

export async function compareAnalysis(
  payrollRecords: readonly PayrollRecord[],
  registroRecords: readonly RegistroEmployee[],
  options: CompareOptions,
): Promise<AnalysisResult> {
  const conceptMap = options.conceptMap ?? [];
  const payrollByEmployee = groupPayroll(payrollRecords);
  const registroByEmployee = new Map(registroRecords.map((record) => [normalizeEmployeeNumber(record.employeeNumber), record]));
  const allEmployeeNumbers = new Set([...registroByEmployee.keys(), ...payrollByEmployee.keys()]);
  const people: PersonComparisonRow[] = [];
  const normalizedVsReal: NormalizedVsRealRow[] = [];
  const concepts: ConceptComparisonRow[] = [];
  const aggregates: PayrollAggregate[] = [];

  allEmployeeNumbers.forEach((employeeNumber) => {
    const employee = registroByEmployee.get(employeeNumber);
    const records = payrollByEmployee.get(employeeNumber) ?? [];
    const aggregate = aggregatePayroll(records, conceptMap);
    aggregates.push(aggregate);
    const pdfTotal = roundMoney(aggregate.totals.salary + aggregate.totals.salaryComplement + aggregate.totals.extraSalary);
    const registro = employee?.periodComplete ?? emptyMoney();
    const salaryDifference = roundMoney(aggregate.totals.salary - registro.salary);
    const salaryComplementDifference = roundMoney(aggregate.totals.salaryComplement - registro.salaryComplement);
    const extraSalaryDifference = roundMoney(aggregate.totals.extraSalary - registro.extraSalary);
    const totalDifference = roundMoney(pdfTotal - registro.total);
    const unmappedCount = [...aggregate.unmapped.values()].reduce((sum, item) => sum + item.payrolls.size, 0);
    const status = personStatus({
      hasRegistro: Boolean(employee),
      hasPdf: records.length > 0,
      unmappedCount,
      differences: [salaryDifference, salaryComplementDifference, extraSalaryDifference, totalDifference],
      options,
    });
    const person = records[0]?.workerName || employee?.workerName;

    people.push({
      employeeNumber,
      person,
      workplace: employee?.workplace ?? records[0]?.workplace,
      position: employee?.position,
      category: employee?.category ?? records[0]?.professionalGroup,
      salaryRegistro: registro.salary,
      salaryPdf: aggregate.totals.salary,
      salaryDifference,
      salaryComplementRegistro: registro.salaryComplement,
      salaryComplementPdf: aggregate.totals.salaryComplement,
      salaryComplementDifference,
      extraSalaryRegistro: registro.extraSalary,
      extraSalaryPdf: aggregate.totals.extraSalary,
      extraSalaryDifference,
      registroTotal: registro.total,
      pdfTotal,
      totalDifference,
      pdfControlTotalDevengado: payrollControlTotal(records),
      payrollCount: records.length,
      unmappedConceptsCount: unmappedCount,
      status,
      detail: "PDF calculado como suma de conceptos incluidos por mapa. Total Devengado se conserva solo como control auxiliar.",
      periods: [...new Set(records.map((record) => record.periodLabel))],
      files: [...new Set(records.map((record) => `${record.sourceFile}${record.pageNumber ? ` p.${record.pageNumber}` : ""}`))],
    });

    if (employee) {
      concepts.push(...createConceptRows(employee, aggregate, options));
      const normalizedPlusVariables = employee.normalizedPlusVariables.total;
      const normalized = employee.normalized.total;
      const periodComplete = employee.periodComplete.total;
      const diffPdfVsPeriodComplete = roundMoney(pdfTotal - periodComplete);
      const diffPdfVsNormalizedPlusVariables = roundMoney(pdfTotal - normalizedPlusVariables);
      const diffPdfVsNormalized = roundMoney(pdfTotal - normalized);
      normalizedVsReal.push({
        employeeNumber,
        person,
        workplace: employee.workplace,
        position: employee.position,
        category: employee.category,
        normalizedPlusVariables,
        normalized,
        periodComplete,
        realPdf: pdfTotal,
        diffPdfVsPeriodComplete,
        diffPdfVsNormalizedPlusVariables,
        diffPdfVsNormalized,
        possibleJustification: justification(employee, aggregate),
        status: worstStatus(
          [diffPdfVsPeriodComplete, diffPdfVsNormalizedPlusVariables, diffPdfVsNormalized].map((difference) =>
            statusFromDifference(difference, options),
          ),
        ),
        detail: "Real PDF calculado desde conceptos incluidos por mapa; no usa líquido, coste empresa ni total devengado como importe comparativo.",
      });
    }
  });

  const unmappedConcepts = createUnmappedRows(aggregates);
  const ignoredConcepts = createIgnoredRows(aggregates);
  const peopleWithDifferences = people.filter((row) => row.status !== "OK").length;
  const reviewThreshold = options.reviewThreshold ?? options.tolerance;
  const incidentThreshold = options.incidentThreshold ?? 50;

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      pdfsAnalyzed: payrollRecords.length,
      pdfsFailed: 0,
      uniquePeople: allEmployeeNumbers.size,
      peopleWithDifferences,
      totalSalaryDifference: roundMoney(people.reduce((sum, row) => sum + row.salaryDifference, 0)),
      totalSalaryComplementDifference: roundMoney(people.reduce((sum, row) => sum + row.salaryComplementDifference, 0)),
      totalExtraSalaryDifference: roundMoney(people.reduce((sum, row) => sum + row.extraSalaryDifference, 0)),
      totalGlobalDifference: roundMoney(people.reduce((sum, row) => sum + row.totalDifference, 0)),
      conceptsUnmapped: unmappedConcepts.length,
      internalExcelDifferences: (options.internalExcelChecks ?? []).filter((row) => row.status !== "OK").length,
      groupingDifferences: 0,
      tolerance: options.tolerance,
      aiEnabled: options.enableAI !== false,
      aiModel: options.aiModel,
      reviewThreshold,
      incidentThreshold,
    },
    payrollRecords,
    registroEmployees: registroRecords,
    people: people.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es")),
    normalizedVsReal: normalizedVsReal.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es")),
    concepts,
    unmappedConcepts,
    ignoredConcepts,
    groupings: [],
    internalExcelChecks: options.internalExcelChecks ?? [],
    conceptMap,
    errors: [],
    criteria: [
      "Clave principal: matricula / ID RH.",
      "No se muestra ni exporta NIF.",
      "PDF comparativo = suma de conceptos incluidos por mapa editable.",
      "Total Devengado PDF se usa solo como control auxiliar.",
      `Tolerancia usada: ${options.tolerance} EUR.`,
      `Umbral revisar: ${reviewThreshold} EUR; umbral diferencia: ${incidentThreshold} EUR.`,
      options.enableAI === false
        ? "IA desactivada; justificaciones deterministas."
        : "Gemini solo puede sugerir textos y mapeos, nunca calcular importes.",
    ],
  };
}
