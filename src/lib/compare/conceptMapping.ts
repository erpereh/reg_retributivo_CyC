import type {
  AvailableConceptCodes,
  ConceptBlockKey,
  ConceptDedupePriority,
  ConceptMappingRule,
  ConceptMappingSourceType,
  MappingStatus,
  RetributionBlock,
} from "@/lib/types";
import { normalizeComparableText } from "@/lib/utils/normalize";

interface DefaultRule {
  readonly pdfConcept: string;
  readonly block: RetributionBlock;
  readonly blockKey: ConceptBlockKey;
  readonly registroCode: string;
  readonly sourceType?: ConceptMappingSourceType;
  readonly allowInformative?: boolean;
  readonly dedupePriority?: ConceptDedupePriority;
}

const DEFAULT_INCLUDED: readonly DefaultRule[] = [
  { pdfConcept: "Salario Base", block: "Salario", blockKey: "salary", registroCode: "SSP_SAL_BASE" },
  { pdfConcept: "Paga Extra Prorrateada", block: "Salario", blockKey: "salary", registroCode: "CSP_P_EXT_PRORRAT_NN" },
  { pdfConcept: "Paga Extra Junio", block: "Salario", blockKey: "salary", registroCode: "SSP_PAGA_EXTRA_1" },
  { pdfConcept: "Paga Extra Diciembre", block: "Salario", blockKey: "salary", registroCode: "SSP_PAGA_EXTRA_2" },
  { pdfConcept: "Paga 25 anos", block: "Salario", blockKey: "salary", registroCode: "CSP_I_PAGA_25_ANYOS" },
  { pdfConcept: "Antiguedad", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "SSP_ANTIGUEDAD" },
  { pdfConcept: "Complemento Puesto de trabajo", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_COMP_PTO_TRA" },
  { pdfConcept: "Complemento Personal", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_COMP_PERSONAL" },
  { pdfConcept: "Plus Convenio", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "SSP_PLUS_CONVENIO" },
  { pdfConcept: "Plus de Transporte", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "SSP_PLUS_TRANSPORTE" },
  { pdfConcept: "Retribucion Variable", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_RETRIB_VARIABLE" },
  { pdfConcept: "Variable Comercial", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_VARIABLE_COMERCIAL" },
  { pdfConcept: "Comisiones Cross Sell", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_COMISI_CROSS_SELL" },
  { pdfConcept: "Participacion en Resultados", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_PART_RESULTADOS" },
  { pdfConcept: "Gratificacion una sola Vez", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "CSP_I_GRATIF_1_VEZ" },
  { pdfConcept: "Bolsa de Vacaciones", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "SSP_VACACIONES" },
  { pdfConcept: "Complementos de I.T.", block: "C. Salarial", blockKey: "salaryComplement", registroCode: "SSP_COMP_TOT_IT" },
  { pdfConcept: "Compensacion Comida", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CSP_I_COMPENSACION_COMIDA" },
  { pdfConcept: "Abono teletrabajo", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CSP_I_COMP_TELETR_COVID" },
  { pdfConcept: "Lote de Navidad", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CSP_I_LOTE_NAVIDAD" },
  { pdfConcept: "Seguro Medico", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CYC_SEG_SALUD" },
  {
    pdfConcept: "Seguro Medico mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_SEG_SALUD",
    sourceType: "informativo",
    allowInformative: true,
    dedupePriority: "informativo",
  },
  {
    pdfConcept: "Seguro de vida mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CSP_COT_SEG_VIDA_MENS",
    sourceType: "informativo",
    allowInformative: true,
    dedupePriority: "informativo",
  },
  {
    pdfConcept: "Seguro de accidente mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CSP_COT_PRIMA_ACC_MENS",
    sourceType: "informativo",
    allowInformative: true,
    dedupePriority: "informativo",
  },
  {
    pdfConcept: "Plan de Pensiones Mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_PLAN_PENSIONES_ORD",
    sourceType: "informativo",
    allowInformative: true,
    dedupePriority: "informativo",
  },
  {
    pdfConcept: "Plan de Pensiones Extraordinario Mensual",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_PLAN_PENSIONES_EXTRAO_NN",
    sourceType: "informativo",
    allowInformative: true,
    dedupePriority: "informativo",
  },
  { pdfConcept: "Kilometraje con Retencion", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "SSP_KM_CON_RETEN" },
  { pdfConcept: "Kilometraje sin Retencion", block: "Extrasalarial", blockKey: "extraSalary", registroCode: "SSP_KM_SIN_RETEN" },
];

const IGNORED_CONCEPTS: ReadonlyArray<{ pdfConcept: string; sourceType?: ConceptMappingSourceType }> = [
  { pdfConcept: "Especie Seguro Medico", sourceType: "unknown" },
  { pdfConcept: "Descuento Seguro Medico", sourceType: "deduccion" },
  { pdfConcept: "Descuento Transporte", sourceType: "deduccion" },
  { pdfConcept: "Cancelacion Prov (Dieta y KM)", sourceType: "deduccion" },
  { pdfConcept: "Aportacion Personal al PPSE", sourceType: "deduccion" },
  { pdfConcept: "Retencion a Cuenta del IRPF", sourceType: "retencion" },
  { pdfConcept: "Retencion a Cuenta IRPF Pagos", sourceType: "retencion" },
  { pdfConcept: "Cotizacion Regimen General Ind", sourceType: "retencion" },
  { pdfConcept: "Cotizacion D+F+P+S Individuo", sourceType: "retencion" },
  { pdfConcept: "Cotiz. MEI Empleado", sourceType: "retencion" },
  { pdfConcept: "Coste Empresa", sourceType: "coste_empresa" },
];

export function normalizePdfConcept(value: string): string {
  return normalizeComparableText(value);
}

const INFORMATIVE_ALLOWED = new Set(
  DEFAULT_INCLUDED.filter((rule) => rule.allowInformative).map((rule) => normalizePdfConcept(rule.pdfConcept)),
);

function hasCode(codes: AvailableConceptCodes, blockKey: ConceptBlockKey, code: string): boolean {
  return codes[blockKey].some((available) => normalizeComparableText(available) === normalizeComparableText(code));
}

function defaultSourceTypeForRule(rule: Pick<ConceptMappingRule, "pdfConcept" | "status" | "sourceType">): ConceptMappingSourceType {
  if (rule.sourceType) {
    return rule.sourceType;
  }
  if (INFORMATIVE_ALLOWED.has(normalizePdfConcept(rule.pdfConcept))) {
    return "informativo";
  }
  return rule.status === "Incluido" ? "devengo" : "unknown";
}

function defaultAllowInformative(rule: Pick<ConceptMappingRule, "pdfConcept" | "allowInformative">): boolean {
  return rule.allowInformative ?? INFORMATIVE_ALLOWED.has(normalizePdfConcept(rule.pdfConcept));
}

function defaultDedupePriority(rule: Pick<ConceptMappingRule, "pdfConcept" | "dedupePriority" | "sourceType" | "status">): ConceptDedupePriority {
  if (rule.dedupePriority) {
    return rule.dedupePriority;
  }
  return defaultSourceTypeForRule(rule) === "informativo" ? "informativo" : "devengo";
}

function normalizeRule(rule: ConceptMappingRule): ConceptMappingRule {
  return {
    ...rule,
    normalizedPdfConcept: rule.normalizedPdfConcept || normalizePdfConcept(rule.pdfConcept),
    sourceType: defaultSourceTypeForRule(rule),
    allowInformative: defaultAllowInformative(rule),
    dedupePriority: defaultDedupePriority(rule),
    includedInComparison: rule.includedInComparison ?? rule.status === "Incluido",
  };
}

export function buildDefaultConceptMap(codes: AvailableConceptCodes): ConceptMappingRule[] {
  const rules: ConceptMappingRule[] = [];

  DEFAULT_INCLUDED.forEach((rule) => {
    const exists = hasCode(codes, rule.blockKey, rule.registroCode);
    rules.push({
      pdfConcept: rule.pdfConcept,
      normalizedPdfConcept: normalizePdfConcept(rule.pdfConcept),
      block: rule.block,
      blockKey: rule.blockKey,
      registroCode: exists ? rule.registroCode : undefined,
      status: exists ? "Incluido" : "Pendiente revisión",
      sourceType: rule.sourceType ?? "devengo",
      allowInformative: rule.allowInformative ?? false,
      dedupePriority: rule.dedupePriority ?? "devengo",
      includedInComparison: exists,
      reason: exists ? "Mapeo por defecto validado contra codigos del Excel." : `El codigo ${rule.registroCode} no existe en el Excel cargado.`,
    });
  });

  IGNORED_CONCEPTS.forEach(({ pdfConcept, sourceType }) => {
    rules.push({
      pdfConcept,
      normalizedPdfConcept: normalizePdfConcept(pdfConcept),
      block: "Extrasalarial",
      blockKey: "extraSalary",
      status: "Ignorado",
      sourceType: sourceType ?? "unknown",
      allowInformative: false,
      dedupePriority: "informativo",
      includedInComparison: false,
      reason: "Concepto conservadoramente excluido por ser deduccion, retencion, cotizacion, especie, informativo o coste empresa.",
    });
  });

  return mergeConceptMap(rules);
}

export function mergeConceptMap(rules: readonly ConceptMappingRule[]): ConceptMappingRule[] {
  const byName = new Map<string, ConceptMappingRule>();
  rules.forEach((rule) => {
    const normalized = rule.normalizedPdfConcept || normalizePdfConcept(rule.pdfConcept);
    byName.set(normalized, normalizeRule({ ...rule, normalizedPdfConcept: normalized }));
  });
  return [...byName.values()].sort((a, b) => a.pdfConcept.localeCompare(b.pdfConcept, "es"));
}

export function findConceptRule(
  rules: readonly ConceptMappingRule[],
  pdfConcept: string,
): ConceptMappingRule | undefined {
  const normalized = normalizePdfConcept(pdfConcept);
  return rules.find((rule) => (rule.normalizedPdfConcept || normalizePdfConcept(rule.pdfConcept)) === normalized);
}

export function mappingStatusFromConceptType(type: string): MappingStatus {
  return ["retencion", "cotizacion", "deduccion", "especie", "coste_empresa"].includes(type) ? "Ignorado" : "Pendiente revisión";
}

export function validateConceptMapForCodes(
  rules: readonly ConceptMappingRule[],
  codes: AvailableConceptCodes,
): ConceptMappingRule[] {
  return mergeConceptMap(
    rules.map((rule) => {
      if (rule.status !== "Incluido") {
        return rule;
      }
      const valid = Boolean(rule.registroCode && hasCode(codes, rule.blockKey, rule.registroCode));
      return valid
        ? rule
        : {
            ...rule,
            registroCode: undefined,
            status: "Pendiente revisión",
            includedInComparison: false,
            reason: "Regla no incluida porque el codigo no existe en el Excel cargado.",
          };
    }),
  );
}
