import { z } from "zod";
import type { AnalysisResult, ConceptComparisonRow, MoneyByBlock } from "@/lib/types";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";
import { selectPersonCuadreReg, selectPersonProfile } from "@/lib/assistant/tools/sharedSelectors";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";

// The request transports the tool payload and its local presentation. Keeping each
// representation below 48 KiB leaves room inside the existing 128 KiB envelope.
export const MAX_PERSON_ANALYSIS_EVIDENCE_BYTES = 48 * 1024;

const optionalText = z.string().max(256).optional();
const moneyTripleSchema = z.object({ registro: z.number(), payroll: z.number(), difference: z.number() }).strict();
const moneyByBlockSchema = z.object({ salary: z.number(), salaryComplement: z.number(), extraSalary: z.number(), total: z.number() }).strict();
const causeSchema = z.object({
  label: z.string().max(128), description: z.string().max(1_000), review: z.string().max(1_000),
  confidence: z.enum(["alta", "media", "baja"]), facts: z.array(z.string().max(500)).max(12), missingEvidence: z.array(z.string().max(500)).max(12),
}).strict();
const cohortSchema = z.object({ dimension: z.enum(["puesto", "categoria", "centro"]), value: z.string().max(256), peopleCount: z.number().int().min(3), averagePayrollAmount: z.number(), averageRegistroAmount: z.number(), averageDifference: z.number() }).strict();
const comparisonSchema = z.object({
  block: z.string().max(128), blockKey: z.string().max(64), registroCode: z.string().max(256), pdfConcept: z.string().max(256).optional(),
  registroAmount: z.number(), payrollAmount: z.number(), difference: z.number(), status: z.string().max(64), detail: z.string().max(1_000),
  grossDifference: z.number().optional(), justifiedAmount: z.number().optional(), adjustedDifference: z.number().optional(), justificationReason: z.string().max(1_000).optional(),
  cause: causeSchema, cohorts: z.array(cohortSchema).max(3),
}).strict();
const breakdownSchema = z.object({
  personId: z.string().min(1).max(64), salaryPeriod: z.number(), salaryBreakdown: z.number(), salaryDifference: z.number(),
  salaryComplementPeriod: z.number(), salaryComplementBreakdown: z.number(), salaryComplementDifference: z.number(),
  extraSalaryPeriod: z.number(), extraSalaryBreakdown: z.number(), extraSalaryDifference: z.number(), status: z.string().max(64),
}).strict();
const normalizedVariablesSchema = z.object({
  personId: z.string().min(1).max(64), salaryPeriod: z.number(), salaryNormalizedPlusVariables: z.number(), salaryDifference: z.number(),
  salaryComplementPeriod: z.number(), salaryComplementNormalizedPlusVariables: z.number(), salaryComplementDifference: z.number(),
  extraSalaryPeriod: z.number(), extraSalaryNormalizedPlusVariables: z.number(), extraSalaryDifference: z.number(),
  totalPeriod: z.number(), totalNormalizedPlusVariables: z.number(), totalDifference: z.number(), status: z.string().max(64),
}).strict();

export const personAnalysisEvidenceSchema = z.object({
  personId: z.string().min(1).max(64),
  laborContext: z.object({ workplace: optionalText, position: optionalText, category: optionalText, professionalGroup: optionalText, valuation: optionalText, family: optionalText, personalCategoryGroup: optionalText }).strict(),
  totals: moneyTripleSchema,
  blocks: z.object({ salary: moneyTripleSchema, salaryComplement: moneyTripleSchema, extraSalary: moneyTripleSchema }).strict(),
  status: z.string().max(64), periods: z.array(z.string().max(128)).max(240),
  registro: z.object({
    concepts: z.array(z.object({ block: z.string().max(128), blockKey: z.string().max(64), code: z.string().max(256), amount: z.number() }).strict()).max(2_000),
    normalizedPlusVariables: moneyByBlockSchema.optional(), normalized: moneyByBlockSchema.optional(), periodComplete: moneyByBlockSchema.optional(), lastSituation: moneyByBlockSchema.optional(),
    nonNormalized: z.object({ salaryComplementVariable: z.number(), extraSalaryVariable: z.number(), salaryPpe: z.number(), salaryComplementPpe: z.number(), salaryIt: z.number(), salaryComplementIt: z.number() }).strict().optional(),
    excelBreakdownDiffs: z.object({ salary: z.number(), salaryComplement: z.number(), extraSalary: z.number() }).strict().optional(),
  }).strict(),
  payroll: z.object({ periods: z.array(z.object({
    period: z.string().max(128), workplace: optionalText, professionalGroup: optionalText,
    concepts: z.array(z.object({ name: z.string().max(256), amount: z.number(), type: z.string().max(64) }).strict()).max(500),
    totals: z.object({ totalDevengado: z.number().optional(), totalDeducir: z.number().optional(), netPay: z.number().optional() }).strict(),
    bases: z.object({ irpfBaseAccumulated: z.number().optional(), irpfFeeAccumulated: z.number().optional(), ssFeeAccumulated: z.number().optional() }).strict(),
  }).strict()).max(240) }).strict(),
  comparisons: z.array(comparisonSchema).max(2_000),
  cuadre: z.object({ breakdown: breakdownSchema.optional(), normalizedVariables: normalizedVariablesSchema.optional() }).strict(),
  normalizedData: z.object({ normalizedPlusVariables: z.number(), normalized: z.number(), periodComplete: z.number(), realPdf: z.number(), diffPdfVsPeriodComplete: z.number(), diffPdfVsNormalizedPlusVariables: z.number(), diffPdfVsNormalized: z.number(), status: z.string().max(64), possibleJustification: z.string().max(1_000).optional() }).strict().optional(),
  completeness: z.object({ registroConcepts: z.number().int().nonnegative(), payrollPeriods: z.number().int().nonnegative(), payrollConcepts: z.number().int().nonnegative(), comparisons: z.number().int().nonnegative(), mismatches: z.number().int().nonnegative() }).strict(),
}).strict();

export type PersonAnalysisEvidence = z.infer<typeof personAnalysisEvidenceSchema>;
export const personAnalysisPresentationSchema = z.object({ kind: z.literal("person_analysis"), personId: z.string().min(1).max(64), evidence: personAnalysisEvidenceSchema }).strict();
export type PersonAnalysisPresentation = z.infer<typeof personAnalysisPresentationSchema>;

function rounded(value: number): number { return Math.round(value * 100) / 100; }
function isMismatch(row: Pick<ConceptComparisonRow, "adjustedDifference" | "difference" | "status">): boolean { return Math.abs(row.adjustedDifference ?? row.difference) > 0.009 || row.status !== "OK"; }
function includesTelework(value: string): boolean {
  const normalized = canonicalizePrivacyText(value);
  return normalized.includes("teletrabajo") || normalized.includes("teletr");
}

function deterministicCause(row: ConceptComparisonRow): PersonAnalysisEvidence["comparisons"][number]["cause"] {
  const explicitTelework = includesTelework(`${row.pdfConcept ?? ""} ${row.registroCode} ${row.detail}`);
  const amountTelework = Math.abs(Math.abs(row.difference) - 208) <= 2;
  if (explicitTelework || amountTelework) return {
    label: "Teletrabajo",
    description: explicitTelework
      ? "El concepto de los recibos identifica expresamente un abono de teletrabajo que no figura con el mismo importe en el Registro Retributivo."
      : "El patrón de importe coincide con un posible abono de teletrabajo, aunque el concepto no lo documenta expresamente.",
    review: "Contrastar el criterio de inclusión del abono extrasalarial y su código en el Registro Retributivo.",
    confidence: explicitTelework ? "alta" : "media",
    facts: [
      `${row.pdfConcept ?? row.registroCode}: Registro ${rounded(row.registroAmount)} EUR; recibos ${rounded(row.pdfAmount)} EUR.`,
      `Diferencia ${rounded(row.difference)} EUR en ${row.block}.`,
    ],
    missingEvidence: ["Confirmar documentalmente el motivo del abono y el criterio aplicado para incluirlo o excluirlo del Registro Retributivo."],
  };
  if (row.status === "Sin mapear" || row.status === "Revisar") return {
    label: "Mapeo pendiente", description: "La comparación no dispone de una regla de correspondencia confirmada.",
    review: "Revisar el concepto del recibo, el bloque y el código del Registro Retributivo.", confidence: "media",
    facts: [`Estado de comparación: ${row.status}.`, `Diferencia ${rounded(row.difference)} EUR en ${row.block}.`],
    missingEvidence: ["Confirmar la regla de mapeo y el criterio de inclusión del concepto."],
  };
  return {
    label: "Diferencia sin causa documentada", description: "Los importes no cuadran, pero los datos estructurados no documentan por sí solos el motivo.",
    review: "Contrastar el detalle del recibo, el código del Registro y la política retributiva aplicable.", confidence: "baja",
    facts: [`${row.pdfConcept ?? row.registroCode}: Registro ${rounded(row.registroAmount)} EUR; recibos ${rounded(row.pdfAmount)} EUR.`, `Diferencia ${rounded(row.difference)} EUR en ${row.block}.`],
    missingEvidence: ["Aportar la justificación o documentación que explique el tratamiento del concepto."],
  };
}

function cohortAggregates(result: AnalysisResult, target: ConceptComparisonRow) {
  const dimensions = [
    ["puesto", "position"], ["categoria", "category"], ["centro", "workplace"],
  ] as const;
  const person = result.people.find((candidate) => candidate.employeeNumber === target.employeeNumber);
  return dimensions.flatMap(([dimension, key]) => {
    const value = person?.[key];
    if (!value) return [];
    const memberIds = new Set(result.people.filter((candidate) => candidate[key] === value).map((candidate) => candidate.employeeNumber));
    if (memberIds.size < 3) return [];
    const comparable = result.concepts.filter((row) => memberIds.has(row.employeeNumber) && row.registroCode === target.registroCode && row.pdfConcept === target.pdfConcept);
    if (comparable.length < 3) return [];
    return [{
      dimension, value, peopleCount: memberIds.size,
      averagePayrollAmount: rounded(comparable.reduce((sum, row) => sum + row.pdfAmount, 0) / comparable.length),
      averageRegistroAmount: rounded(comparable.reduce((sum, row) => sum + row.registroAmount, 0) / comparable.length),
      averageDifference: rounded(comparable.reduce((sum, row) => sum + row.difference, 0) / comparable.length),
    }];
  });
}

function safeMoney(value: MoneyByBlock | undefined): MoneyByBlock | undefined { return value ? { salary: value.salary, salaryComplement: value.salaryComplement, extraSalary: value.extraSalary, total: value.total } : undefined; }

export function buildPersonAnalysisEvidence(result: AnalysisResult, personId: string): PersonAnalysisEvidence {
  const profile = selectPersonProfile(result, personId);
  if (!profile) throw new Error("No existe una persona con esa matrícula en el análisis.");
  const registro = result.registroEmployees.find((row) => row.employeeNumber === personId);
  const payrollRows = result.payrollRecords.filter((row) => row.employeeNumber === personId);
  const comparisonRows = result.concepts.filter((row) => row.employeeNumber === personId);
  const normalized = result.normalizedVsReal.find((row) => row.employeeNumber === personId);
  const comparisons = comparisonRows.map((row) => ({
    block: row.block, blockKey: row.blockKey, registroCode: row.registroCode, ...(row.pdfConcept ? { pdfConcept: row.pdfConcept } : {}),
    registroAmount: row.registroAmount, payrollAmount: row.pdfAmount, difference: row.difference, status: row.status, detail: row.detail,
    ...(row.grossDifference === undefined ? {} : { grossDifference: row.grossDifference }), ...(row.justifiedAmount === undefined ? {} : { justifiedAmount: row.justifiedAmount }),
    ...(row.adjustedDifference === undefined ? {} : { adjustedDifference: row.adjustedDifference }), ...(row.justificationReason ? { justificationReason: row.justificationReason } : {}),
    cause: deterministicCause(row), cohorts: cohortAggregates(result, row),
  })).sort((a, b) => Number(isMismatch(b)) - Number(isMismatch(a)) || Math.abs(b.difference) - Math.abs(a.difference));
  const cuadre = selectPersonCuadreReg(result, personId);
  const evidence: PersonAnalysisEvidence = {
    personId,
    laborContext: {
      ...(profile.workplace ? { workplace: profile.workplace } : {}), ...(profile.position ? { position: profile.position } : {}), ...(profile.category ? { category: profile.category } : {}),
      ...(registro?.professionalGroup ? { professionalGroup: registro.professionalGroup } : {}), ...(registro?.valuation ? { valuation: registro.valuation } : {}),
      ...(registro?.family ? { family: registro.family } : {}), ...(registro?.personalCategoryGroup ? { personalCategoryGroup: registro.personalCategoryGroup } : {}),
    },
    totals: profile.totals, blocks: profile.blocks, status: profile.status, periods: profile.periods,
    registro: {
      concepts: (registro?.concepts ?? []).map(({ block, blockKey, code, amount }) => ({ block, blockKey, code, amount })),
      ...(registro ? { normalizedPlusVariables: safeMoney(registro.normalizedPlusVariables), normalized: safeMoney(registro.normalized), periodComplete: safeMoney(registro.periodComplete), lastSituation: safeMoney(registro.lastSituation), nonNormalized: { ...registro.nonNormalized }, excelBreakdownDiffs: { ...registro.excelBreakdownDiffs } } : {}),
    },
    payroll: { periods: payrollRows.map((row) => ({
      period: row.periodLabel, ...(row.workplace ? { workplace: row.workplace } : {}), ...(row.professionalGroup ? { professionalGroup: row.professionalGroup } : {}),
      concepts: row.concepts.map(({ name, amount, type }) => ({ name, amount, type })),
      totals: { ...(row.totalDevengado === undefined ? {} : { totalDevengado: row.totalDevengado }), ...(row.totalDeducir === undefined ? {} : { totalDeducir: row.totalDeducir }), ...(row.netPay === undefined ? {} : { netPay: row.netPay }) },
      bases: { ...(row.irpfBaseAccumulated === undefined ? {} : { irpfBaseAccumulated: row.irpfBaseAccumulated }), ...(row.irpfFeeAccumulated === undefined ? {} : { irpfFeeAccumulated: row.irpfFeeAccumulated }), ...(row.ssFeeAccumulated === undefined ? {} : { ssFeeAccumulated: row.ssFeeAccumulated }) },
    })) },
    comparisons,
    cuadre: { ...(cuadre?.breakdown ? { breakdown: cuadre.breakdown } : {}), ...(cuadre?.normalizedVariables ? { normalizedVariables: cuadre.normalizedVariables } : {}) },
    ...(normalized ? { normalizedData: { normalizedPlusVariables: normalized.normalizedPlusVariables, normalized: normalized.normalized, periodComplete: normalized.periodComplete, realPdf: normalized.realPdf, diffPdfVsPeriodComplete: normalized.diffPdfVsPeriodComplete, diffPdfVsNormalizedPlusVariables: normalized.diffPdfVsNormalizedPlusVariables, diffPdfVsNormalized: normalized.diffPdfVsNormalized, status: normalized.status, ...(normalized.possibleJustification ? { possibleJustification: normalized.possibleJustification } : {}) } } : {}),
    completeness: { registroConcepts: registro?.concepts.length ?? 0, payrollPeriods: payrollRows.length, payrollConcepts: payrollRows.reduce((sum, row) => sum + row.concepts.length, 0), comparisons: comparisons.length, mismatches: comparisonRows.filter(isMismatch).length },
  };
  const parsed = personAnalysisEvidenceSchema.parse(evidence);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_PERSON_ANALYSIS_EVIDENCE_BYTES) throw new ProviderAdapterError("context", "person_evidence_too_large");
  return parsed;
}

export function buildPersonAnalysisPresentation(evidence: PersonAnalysisEvidence) {
  return personAnalysisPresentationSchema.parse({ kind: "person_analysis", personId: evidence.personId, evidence });
}

export function personAnalysisExcerpt(evidence: PersonAnalysisEvidence): string {
  return `Matrícula ${evidence.personId}: Registro ${evidence.totals.registro.toFixed(2)} EUR; recibos ${evidence.totals.payroll.toFixed(2)} EUR; diferencia ${evidence.totals.difference.toFixed(2)} EUR. ${evidence.completeness.mismatches} conceptos descuadrados.`;
}
