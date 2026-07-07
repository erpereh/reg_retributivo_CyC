"use client";

import {
  Copy,
  Download,
  FileJson,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { Toggle } from "@/components/common/Toggle";
import { mergeConceptMap, normalizeConceptMappingRule, normalizePdfConcept } from "@/lib/compare/conceptMapping";
import type {
  ConceptBlockKey,
  ConceptDedupePriority,
  ConceptMappingRule,
  ConceptMappingSourceType,
  MappingStatus,
  RetributionBlock,
  UnmappedConceptRow,
} from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { normalizeComparableText } from "@/lib/utils/normalize";

type StatusFilter = "Todos" | MappingStatus | "Sin regla";
type ActivationFilter = "Todas" | "Activadas" | "Desactivadas";
type DetectedFilter = "Todos" | "Detectado en análisis" | "No detectado";

interface RuleForm {
  readonly pdfConcept: string;
  readonly aliasesText: string;
  readonly registroCode: string;
  readonly block: RetributionBlock;
  readonly status: MappingStatus;
  readonly sourceType: ConceptMappingSourceType;
  readonly allowInformative: boolean;
  readonly dedupePriority: ConceptDedupePriority;
  readonly includedInComparison: boolean;
  readonly includedInAdjustedComparison: boolean;
  readonly active: boolean;
  readonly reason: string;
}

interface RuleMeta {
  readonly detected: boolean;
  readonly codeValid: boolean;
}

interface RuleTableBaseRow {
  readonly id: string;
  readonly kind: "rule" | "unmapped";
  readonly statusLabel: StatusFilter;
  readonly concept: string;
  readonly code?: string;
  readonly block: RetributionBlock;
  readonly detected: boolean;
  readonly active?: boolean;
  readonly reason?: string;
  readonly aliases: readonly string[];
  readonly sortRank: number;
}

interface RuleRow extends RuleTableBaseRow {
  readonly kind: "rule";
  readonly rule: ConceptMappingRule;
  readonly index: number;
}

interface UnmappedRow extends RuleTableBaseRow {
  readonly kind: "unmapped";
  readonly row: UnmappedConceptRow;
}

type ConceptMapRow = RuleRow | UnmappedRow;

const STATUSES: readonly MappingStatus[] = ["Incluido", "Justificado", "Pendiente revisión", "Ignorado"];
const STATUS_FILTERS: readonly StatusFilter[] = ["Todos", "Incluido", "Justificado", "Ignorado", "Pendiente revisión", "Sin regla"];
const ACTIVATION_FILTERS: readonly ActivationFilter[] = ["Todas", "Activadas", "Desactivadas"];
const DETECTED_FILTERS: readonly DetectedFilter[] = ["Todos", "Detectado en análisis", "No detectado"];
const BLOCKS: readonly RetributionBlock[] = ["Salario", "C. Salarial", "Extrasalarial"];
const SOURCE_TYPES: readonly ConceptMappingSourceType[] = ["devengo", "informativo", "deduccion", "retencion", "coste_empresa", "unknown"];
const DEDUPE_PRIORITIES: readonly ConceptDedupePriority[] = ["devengo", "informativo"];

const JUSTIFIED_HELP = "Visible y auditable, pero preparado para excluirse de la diferencia ajustada en una fase posterior.";
const MAP_NOTE = "Las reglas justificadas siguen visibles y auditables. La diferencia ajustada se aplicará en una subfase posterior.";
const TOP_ACTION_CLASS = "min-h-11 whitespace-nowrap rounded-full px-4";

const EMPTY_RULE_FORM: RuleForm = {
  pdfConcept: "",
  aliasesText: "",
  registroCode: "",
  block: "C. Salarial",
  status: "Pendiente revisión",
  sourceType: "devengo",
  allowInformative: false,
  dedupePriority: "devengo",
  includedInComparison: false,
  includedInAdjustedComparison: true,
  active: true,
  reason: "",
};

function blockKeyFromBlock(block: RetributionBlock): ConceptBlockKey {
  if (block === "Salario") return "salary";
  if (block === "Extrasalarial") return "extraSalary";
  return "salaryComplement";
}

function isStatus(value: unknown): value is MappingStatus {
  return typeof value === "string" && STATUSES.includes(value as MappingStatus);
}

function isBlock(value: unknown): value is RetributionBlock {
  return typeof value === "string" && BLOCKS.includes(value as RetributionBlock);
}

function isSourceType(value: unknown): value is ConceptMappingSourceType {
  return typeof value === "string" && SOURCE_TYPES.includes(value as ConceptMappingSourceType);
}

function isDedupePriority(value: unknown): value is ConceptDedupePriority {
  return typeof value === "string" && DEDUPE_PRIORITIES.includes(value as ConceptDedupePriority);
}

function normalizeAliases(input: unknown): readonly string[] {
  const values = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  return values
    .map((value) => String(value).trim())
    .filter((value) => {
      if (!value) return false;
      const normalized = normalizePdfConcept(value);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function coerceRule(input: unknown): ConceptMappingRule {
  const item = (typeof input === "object" && input ? input : {}) as Partial<ConceptMappingRule>;
  const pdfConcept = String(item.pdfConcept ?? "").trim();
  if (!pdfConcept) {
    throw new Error("Cada regla necesita Concepto PDF.");
  }
  const block = isBlock(item.block) ? item.block : "C. Salarial";
  const status = isStatus(item.status) ? item.status : "Pendiente revisión";
  return normalizeConceptMappingRule({
    pdfConcept,
    normalizedPdfConcept: item.normalizedPdfConcept || normalizePdfConcept(pdfConcept),
    aliases: normalizeAliases(item.aliases),
    block,
    blockKey: item.blockKey ?? blockKeyFromBlock(block),
    registroCode: item.registroCode?.trim() || undefined,
    status,
    sourceType: isSourceType(item.sourceType) ? item.sourceType : "devengo",
    allowInformative: item.allowInformative ?? false,
    dedupePriority: isDedupePriority(item.dedupePriority) ? item.dedupePriority : "devengo",
    includedInComparison: item.includedInComparison ?? (status === "Incluido" || status === "Justificado"),
    includedInAdjustedComparison: item.includedInAdjustedComparison ?? status !== "Justificado",
    active: item.active ?? true,
    reason: item.reason,
  });
}

function normalizeRules(input: unknown): ConceptMappingRule[] {
  if (!Array.isArray(input)) {
    throw new Error("El mapa debe ser un array JSON.");
  }
  return mergeConceptMap(input.map(coerceRule));
}

function composeVisibleRules(defaultRules: readonly ConceptMappingRule[] | undefined, storedRules: readonly ConceptMappingRule[]): ConceptMappingRule[] {
  const base = normalizeRules(defaultRules ?? []);
  const stored = normalizeRules(storedRules);
  if (!stored.length) return base;
  if (!base.length) return stored;

  const storedLooksPartial = stored.length < Math.ceil(base.length * 0.75);
  return storedLooksPartial ? mergeConceptMap([...base, ...stored]) : stored;
}

function ruleToForm(rule: ConceptMappingRule): RuleForm {
  const normalized = normalizeConceptMappingRule(rule);
  return {
    pdfConcept: normalized.pdfConcept,
    aliasesText: (normalized.aliases ?? []).join(", "),
    registroCode: normalized.registroCode ?? "",
    block: normalized.block,
    status: normalized.status,
    sourceType: normalized.sourceType ?? "devengo",
    allowInformative: normalized.allowInformative ?? false,
    dedupePriority: normalized.dedupePriority ?? "devengo",
    includedInComparison: normalized.includedInComparison ?? (normalized.status === "Incluido" || normalized.status === "Justificado"),
    includedInAdjustedComparison: normalized.includedInAdjustedComparison ?? normalized.status !== "Justificado",
    active: normalized.active ?? true,
    reason: normalized.reason ?? "",
  };
}

function formToRule(form: RuleForm): ConceptMappingRule {
  const status = form.status;
  return normalizeConceptMappingRule({
    pdfConcept: form.pdfConcept.trim(),
    normalizedPdfConcept: normalizePdfConcept(form.pdfConcept),
    aliases: normalizeAliases(form.aliasesText),
    block: form.block,
    blockKey: blockKeyFromBlock(form.block),
    registroCode: form.registroCode.trim() || undefined,
    status,
    sourceType: form.sourceType,
    allowInformative: form.allowInformative,
    dedupePriority: form.dedupePriority,
    includedInComparison: form.includedInComparison,
    includedInAdjustedComparison: status === "Justificado" ? false : form.includedInAdjustedComparison,
    active: form.active,
    reason: form.reason.trim() || undefined,
  });
}

function availableCodesFromResult(result: ReturnType<typeof useAppState>["result"]): readonly string[] {
  const codes = new Set<string>();
  result?.registroEmployees.forEach((employee) => employee.concepts.forEach((concept) => codes.add(concept.code)));
  return [...codes].sort((left, right) => left.localeCompare(right, "es"));
}

function detectedConceptsFromResult(result: ReturnType<typeof useAppState>["result"]): ReadonlySet<string> {
  const concepts = new Set<string>();
  result?.payrollRecords.forEach((record) => record.concepts.forEach((concept) => concepts.add(normalizePdfConcept(concept.name))));
  result?.unmappedConcepts.forEach((row) => concepts.add(normalizePdfConcept(row.pdfConcept)));
  return concepts;
}

function codeExists(code: string, availableCodes: readonly string[]): boolean {
  if (!code.trim() || !availableCodes.length) return true;
  const normalized = normalizeComparableText(code);
  return availableCodes.some((item) => normalizeComparableText(item) === normalized);
}

function ruleMeta(rule: ConceptMappingRule, detectedConcepts: ReadonlySet<string>, availableCodes: readonly string[]): RuleMeta {
  const names = [rule.pdfConcept, ...(rule.aliases ?? [])].map(normalizePdfConcept);
  return {
    detected: names.some((name) => detectedConcepts.has(name)),
    codeValid: codeExists(rule.registroCode ?? "", availableCodes),
  };
}

function ruleMatchesConcept(rule: ConceptMappingRule, normalizedConcept: string): boolean {
  return [rule.pdfConcept, ...(rule.aliases ?? [])].map(normalizePdfConcept).includes(normalizedConcept);
}

function reasonForRule(rule: ConceptMappingRule): string | undefined {
  if (rule.status !== "Justificado") return rule.reason;
  return rule.reason?.includes("excluirse") ? rule.reason : JUSTIFIED_HELP;
}

function sortRankForRule(rule: ConceptMappingRule, meta: RuleMeta): number {
  if (rule.active === false) return 5;
  if (meta.detected && rule.status !== "Justificado") return 1;
  if (meta.detected && rule.status === "Justificado") return 2;
  if (rule.status === "Pendiente revisión") return 3;
  return 4;
}

function buildRows(
  rules: readonly ConceptMappingRule[],
  unmapped: readonly UnmappedConceptRow[],
  detectedConcepts: ReadonlySet<string>,
  availableCodes: readonly string[],
): ConceptMapRow[] {
  const ruleRows: ConceptMapRow[] = rules.map((rule, index) => {
    const meta = ruleMeta(rule, detectedConcepts, availableCodes);
    return {
      kind: "rule",
      id: `rule-${normalizePdfConcept(rule.pdfConcept)}-${index}`,
      statusLabel: rule.status,
      concept: rule.pdfConcept,
      code: rule.registroCode,
      block: rule.block,
      detected: meta.detected,
      active: rule.active !== false,
      reason: reasonForRule(rule),
      aliases: rule.aliases ?? [],
      sortRank: sortRankForRule(rule, meta),
      rule,
      index,
    };
  });

  const unmappedRows: ConceptMapRow[] = unmapped
    .filter((row) => {
      const normalized = normalizePdfConcept(row.pdfConcept);
      return !rules.some((rule) => rule.active !== false && ruleMatchesConcept(rule, normalized));
    })
    .map((row, index) => ({
      kind: "unmapped",
      id: `unmapped-${normalizePdfConcept(row.pdfConcept)}-${index}`,
      statusLabel: "Sin regla",
      concept: row.pdfConcept,
      code: row.suggestedRegistroCode,
      block: row.suggestedBlock ?? "C. Salarial",
      detected: true,
      reason: row.reason ?? row.recommendedAction,
      aliases: [],
      sortRank: 6,
      row,
    }));

  return [...ruleRows, ...unmappedRows].sort((left, right) => left.sortRank - right.sortRank || left.concept.localeCompare(right.concept, "es"));
}

function rowMatches(row: ConceptMapRow, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = normalizeComparableText(query);
  const values = [row.concept, ...row.aliases, row.code, row.block, row.reason, row.statusLabel];
  return values.some((value) => normalizeComparableText(value).includes(normalizedQuery));
}

function statusBadgeClass(status: StatusFilter): string {
  if (status === "Incluido") return "bg-emerald-50 text-emerald-700";
  if (status === "Justificado") return "bg-violet-50 text-violet-700";
  if (status === "Ignorado") return "bg-slate-100 text-slate-600";
  if (status === "Sin regla") return "bg-red-50 text-red-700";
  if (status === "Pendiente revisión") return "bg-orange-50 text-orange-700";
  return "bg-slate-100 text-slate-600";
}

function shortText(value: string | undefined, fallback: string): string {
  const text = value?.trim() || fallback;
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function IconButton({
  label,
  title,
  tone = "neutral",
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly title?: string;
  readonly tone?: "neutral" | "danger" | "active" | "inactive";
  readonly disabled?: boolean;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
}) {
  const toneClass = {
    neutral: "border-line bg-white text-ink hover:bg-slate-100",
    danger: "border-red-100 bg-red-50 text-red-700 hover:bg-red-100",
    active: "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    inactive: "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200",
  }[tone];

  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

export function ConceptMapEditor() {
  const { settings, updateSettings, saveConceptMapAndRefresh, result, activeAnalysis } = useAppState();
  const activeResult = result ?? activeAnalysis?.result;
  const availableCodes = useMemo(() => availableCodesFromResult(activeResult), [activeResult]);
  const detectedConcepts = useMemo(() => detectedConceptsFromResult(activeResult), [activeResult]);
  const sourceRules = useMemo(
    () => composeVisibleRules(activeResult?.conceptMap, settings.conceptMap),
    [activeResult?.conceptMap, settings.conceptMap],
  );
  const unmapped = activeResult?.unmappedConcepts ?? [];
  const [rules, setRules] = useState<readonly ConceptMappingRule[]>(() => sourceRules);
  const [query, setQuery] = useState("");
  const [blockFilter, setBlockFilter] = useState<"Todos" | RetributionBlock>("Todos");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [activationFilter, setActivationFilter] = useState<ActivationFilter>("Todas");
  const [detectedFilter, setDetectedFilter] = useState<DetectedFilter>("Todos");
  const [editingIndex, setEditingIndex] = useState<number | "new" | undefined>();
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [message, setMessage] = useState<string | undefined>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | undefined>();

  useEffect(() => {
    setRules(sourceRules);
    setJsonDraft(JSON.stringify(sourceRules, null, 2));
  }, [sourceRules]);

  const rows = useMemo(() => buildRows(rules, unmapped, detectedConcepts, availableCodes), [availableCodes, detectedConcepts, rules, unmapped]);
  const counters = useMemo(() => {
    const ruleRows = rows.filter((row): row is RuleRow => row.kind === "rule");
    return {
      totalRules: ruleRows.length,
      activeRules: ruleRows.filter((row) => row.active).length,
      inactiveRules: ruleRows.filter((row) => !row.active).length,
      detectedRules: ruleRows.filter((row) => row.detected).length,
      unmappedPending: rows.filter((row) => row.kind === "unmapped").length,
    };
  }, [rows]);
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (blockFilter !== "Todos" && row.block !== blockFilter) return false;
      if (statusFilter !== "Todos" && row.statusLabel !== statusFilter) return false;
      if (activationFilter === "Activadas" && (row.kind !== "rule" || !row.active)) return false;
      if (activationFilter === "Desactivadas" && (row.kind !== "rule" || row.active)) return false;
      if (detectedFilter === "Detectado en análisis" && !row.detected) return false;
      if (detectedFilter === "No detectado" && row.detected) return false;
      return rowMatches(row, query);
    });
  }, [activationFilter, blockFilter, detectedFilter, query, rows, statusFilter]);
  const codeWarning = form.registroCode.trim() && !codeExists(form.registroCode, availableCodes);

  function resetFilters(): void {
    setQuery("");
    setBlockFilter("Todos");
    setStatusFilter("Todos");
    setActivationFilter("Todas");
    setDetectedFilter("Todos");
  }

  function persistRules(next: readonly ConceptMappingRule[], toast?: string): void {
    const normalized = mergeConceptMap(next.map(coerceRule));
    setRules(normalized);
    setJsonDraft(JSON.stringify(normalized, null, 2));
    updateSettings({ conceptMap: normalized });
    if (toast) setMessage(toast);
  }

  function openRule(rule?: ConceptMappingRule, index?: number): void {
    setEditingIndex(typeof index === "number" ? index : "new");
    setForm(rule ? ruleToForm(rule) : EMPTY_RULE_FORM);
    setMessage(undefined);
  }

  function ruleFromUnmapped(row: UnmappedConceptRow, status: MappingStatus = row.action): ConceptMappingRule {
    return normalizeConceptMappingRule({
      pdfConcept: row.pdfConcept,
      normalizedPdfConcept: normalizePdfConcept(row.pdfConcept),
      aliases: [],
      block: row.suggestedBlock ?? "C. Salarial",
      blockKey: blockKeyFromBlock(row.suggestedBlock ?? "C. Salarial"),
      registroCode: row.suggestedRegistroCode,
      status,
      sourceType: "devengo",
      allowInformative: false,
      dedupePriority: "devengo",
      includedInComparison: status === "Incluido" || status === "Justificado",
      includedInAdjustedComparison: status !== "Justificado",
      active: true,
      reason: status === "Justificado" ? row.reason ?? JUSTIFIED_HELP : row.reason ?? row.recommendedAction,
    });
  }

  function openFromUnmapped(row: UnmappedConceptRow, status: MappingStatus = row.action): void {
    openRule(ruleFromUnmapped(row, status));
  }

  function quickCreateFromUnmapped(row: UnmappedConceptRow, status: MappingStatus, toast: string): void {
    persistRules([...rules, ruleFromUnmapped(row, status)], toast);
  }

  function saveForm(): void {
    if (!form.pdfConcept.trim()) {
      setMessage("Concepto PDF obligatorio.");
      return;
    }
    if (codeWarning && !window.confirm("El código Registro no existe en el Excel cargado. ¿Guardar igualmente?")) {
      return;
    }
    const nextRule = formToRule(form);
    const next = editingIndex === "new" || editingIndex === undefined ? [...rules, nextRule] : rules.map((rule, index) => (index === editingIndex ? nextRule : rule));
    persistRules(next, "Regla guardada.");
    setEditingIndex(undefined);
  }

  function deleteRule(index: number): void {
    persistRules(rules.filter((_, itemIndex) => itemIndex !== index), "Regla eliminada.");
  }

  function setRuleActive(index: number, active: boolean): void {
    persistRules(rules.map((rule, itemIndex) => (itemIndex === index ? normalizeConceptMappingRule({ ...rule, active }) : rule)), active ? "Regla activada." : "Regla desactivada.");
  }

  function exportMap(): void {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mapa_conceptos_retributivo.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importMap(): void {
    const pasted = window.prompt("Pega el JSON del mapa de conceptos");
    if (!pasted) return;
    setJsonDraft(pasted);
    try {
      persistRules(normalizeRules(JSON.parse(pasted)), "Mapa importado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo importar el mapa.");
    }
  }

  function validateJson(): void {
    try {
      normalizeRules(JSON.parse(jsonDraft));
      setMessage("JSON válido.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON inválido.");
    }
  }

  function applyJson(): void {
    try {
      persistRules(normalizeRules(JSON.parse(jsonDraft)), "JSON aplicado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON inválido.");
    }
  }

  function resetDefault(): void {
    const defaults = normalizeRules(activeResult?.conceptMap ?? []);
    setRules(defaults);
    setJsonDraft(JSON.stringify(defaults, null, 2));
    updateSettings({ conceptMap: [] });
    resetFilters();
    setMoreOpen(false);
    setJsonOpen(false);
    setMessage("Mapa restaurado por defecto.");
  }

  const summaryCards = [
    { label: "Reglas totales", value: counters.totalRules, action: resetFilters, active: false },
    {
      label: "Activadas",
      value: counters.activeRules,
      action: () => {
        resetFilters();
        setActivationFilter("Activadas");
      },
      active: activationFilter === "Activadas",
    },
    {
      label: "Desactivadas",
      value: counters.inactiveRules,
      action: () => {
        resetFilters();
        setActivationFilter("Desactivadas");
      },
      active: activationFilter === "Desactivadas",
    },
    {
      label: "Detectadas",
      value: counters.detectedRules,
      action: () => {
        resetFilters();
        setDetectedFilter("Detectado en análisis");
      },
      active: detectedFilter === "Detectado en análisis",
    },
    {
      label: "Pendientes sin regla",
      value: counters.unmappedPending,
      action: () => {
        resetFilters();
        setStatusFilter("Sin regla");
      },
      active: statusFilter === "Sin regla",
    },
  ];

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-ink">Mapa de conceptos</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Gestiona reglas guardadas que pueden aplicarse ahora o en futuros análisis.</p>
          <p className="mt-1 text-xs font-medium leading-5 text-muted">{MAP_NOTE}</p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2 xl:justify-end">
          <button type="button" className={cn("btn-primary", TOP_ACTION_CLASS)} onClick={() => openRule()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Crear regla
          </button>
          <button type="button" className={cn("btn-primary", TOP_ACTION_CLASS)} onClick={() => persistRules(rules, "Mapa de conceptos guardado.")}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Guardar mapa
          </button>
          <button type="button" className={cn("btn-secondary", TOP_ACTION_CLASS)} onClick={() => void saveConceptMapAndRefresh(rules)}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Actualizar datos
          </button>
          <button type="button" className={cn("btn-secondary", TOP_ACTION_CLASS)} onClick={resetDefault}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Restaurar defecto
          </button>
          <button type="button" className={cn("btn-secondary", TOP_ACTION_CLASS)} aria-expanded={moreOpen} onClick={() => setMoreOpen((current) => !current)}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            Más opciones
          </button>
          {moreOpen ? (
            <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-line bg-white p-3 shadow-lift">
              <div className="grid gap-2">
                <button type="button" className="btn-secondary justify-start" onClick={exportMap}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Exportar mapa
                </button>
                <button type="button" className="btn-secondary justify-start" onClick={importMap}>
                  <FileJson className="h-4 w-4" aria-hidden="true" />
                  Importar mapa
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-5">
        {summaryCards.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={`${item.label} ${item.value}`}
            onClick={item.action}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left shadow-subtle transition hover:-translate-y-0.5",
              item.active ? "border-primary bg-blue-50" : "border-line bg-white hover:bg-slate-50",
            )}
          >
            <span className="block text-xs font-semibold uppercase text-muted">{item.label}</span>
            <span className="mt-1 block text-2xl font-semibold text-ink">{item.value}</span>
          </button>
        ))}
      </div>

      <section className="mt-6 rounded-3xl border border-line bg-slate-50/80 p-4" aria-label="Reglas y conceptos">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-ink">Reglas y conceptos</h3>
          <p className="text-sm leading-6 text-muted">Regla del mapa = configuración guardada. Concepto sin regla = concepto detectado en este análisis que requiere decisión.</p>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[1.4fr_180px_180px_220px_180px]">
          <label className="relative block text-sm font-semibold text-ink">
            Buscar
            <Search className="pointer-events-none absolute bottom-3 left-4 h-4 w-4 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por concepto, alias, código, bloque o motivo"
              className="mt-2 h-12 w-full rounded-full border border-line bg-white pl-10 pr-4 text-sm font-medium text-ink shadow-subtle"
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
              {STATUS_FILTERS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">
            Activación
            <select value={activationFilter} onChange={(event) => setActivationFilter(event.target.value as ActivationFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
              {ACTIVATION_FILTERS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">
            Detectado
            <select value={detectedFilter} onChange={(event) => setDetectedFilter(event.target.value as DetectedFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
              {DETECTED_FILTERS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">
            Bloque
            <select value={blockFilter} onChange={(event) => setBlockFilter(event.target.value as typeof blockFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
              <option>Todos</option>
              {BLOCKS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div data-testid="concept-map-unified-scroll" className="mt-4 max-h-[560px] overflow-y-auto rounded-2xl border border-line bg-white shadow-subtle">
          <table className="min-w-[980px] w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-semibold uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Concepto PDF</th>
                <th className="px-4 py-3">Código Registro</th>
                <th className="px-4 py-3">Bloque</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Detectado en análisis</th>
                <th className="px-4 py-3">Activada</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const expanded = expandedRow === row.id;
                const codeValid = row.code ? codeExists(row.code, availableCodes) : true;
                return (
                  <motion.tr
                    key={row.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="cursor-pointer border-t border-line/70 align-top transition hover:bg-blue-50/50"
                    onClick={() => setExpandedRow((current) => (current === row.id ? undefined : row.id))}
                  >
                    <td className="max-w-[300px] px-4 py-3">
                      <p className="font-semibold text-ink">{row.concept}</p>
                      {expanded ? (
                        <div className="mt-2 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-muted">
                          <p>Alias: {row.aliases.length ? row.aliases.join(", ") : "Sin alias"}</p>
                          <p>Motivo: {row.reason ?? (row.statusLabel === "Justificado" ? JUSTIFIED_HELP : "Sin motivo")}</p>
                          {row.kind === "rule" ? (
                            <>
                              <p>Origen: {row.rule.sourceType ?? "devengo"}</p>
                              <p>Permite informativos: {row.rule.allowInformative ? "Sí" : "No"}</p>
                              <p>Prioridad: {row.rule.dedupePriority ?? "devengo"}</p>
                              <p>includedInComparison: {row.rule.includedInComparison ? "true" : "false"}</p>
                              <p>includedInAdjustedComparison: {row.rule.includedInAdjustedComparison ? "true" : "false"}</p>
                            </>
                          ) : null}
                        </div>
                      ) : row.reason ? (
                        <p className="mt-1 text-xs text-muted" title={row.reason}>{shortText(row.reason, "Sin motivo")}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink">
                      {row.code ?? "Sin código"}
                      {!codeValid ? <p className="mt-1 text-[11px] font-semibold text-red-700">Código no existe en Registro cargado</p> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{row.block}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", statusBadgeClass(row.statusLabel))}>{row.statusLabel}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-muted">{row.detected ? "Sí" : "No"}</td>
                    <td className="px-4 py-3 font-semibold text-muted">{row.active === undefined ? "No aplica" : row.active ? "Sí" : "No"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {row.kind === "rule" ? (
                          <>
                            <IconButton label={`Editar regla ${row.concept}`} title="Editar regla" onClick={(event) => { event.stopPropagation(); openRule(row.rule, row.index); }}>
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={`${row.active ? "Desactivar regla" : "Activar regla"} ${row.concept}`}
                              title={row.active ? "Desactivar regla" : "Activar regla"}
                              tone={row.active ? "active" : "inactive"}
                              onClick={(event) => { event.stopPropagation(); setRuleActive(row.index, !row.active); }}
                            >
                              {row.active ? <Power className="h-4 w-4" aria-hidden="true" /> : <PowerOff className="h-4 w-4" aria-hidden="true" />}
                            </IconButton>
                            <IconButton label={`Eliminar regla ${row.concept}`} title="Eliminar regla" tone="danger" onClick={(event) => { event.stopPropagation(); deleteRule(row.index); }}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                          </>
                        ) : (
                          <>
                            <IconButton label={`Crear regla ${row.concept}`} title="Crear regla" onClick={(event) => { event.stopPropagation(); openFromUnmapped(row.row); }}>
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={`Crea una regla para poder activarla o desactivarla ${row.concept}`}
                              title="Crea una regla para poder activarla o desactivarla"
                              tone="inactive"
                              disabled
                              onClick={(event) => { event.stopPropagation(); }}
                            >
                              <PowerOff className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton label={`Descartar concepto ${row.concept}`} title="Descartar concepto" tone="danger" onClick={(event) => { event.stopPropagation(); quickCreateFromUnmapped(row.row, "Ignorado", "Concepto ignorado."); }}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {!filteredRows.length ? <p className="p-6 text-sm font-semibold text-muted">No hay reglas o conceptos con estos filtros.</p> : null}
        </div>
      </section>

      {message ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{message}</p> : null}

      <section className="mt-6 rounded-3xl border border-line bg-white p-4 shadow-subtle" aria-label="Modo avanzado JSON">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 text-left"
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((current) => !current)}
        >
          <span>
            <span className="block text-lg font-semibold text-ink">Modo avanzado JSON</span>
            <span className="mt-1 block text-sm leading-6 text-muted">Usa JSON solo para importar, copiar o depurar reglas manualmente.</span>
          </span>
          <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted">{jsonOpen ? "Cerrar" : "Abrir"}</span>
        </button>
        {jsonOpen ? (
          <div className="mt-4 border-t border-line pt-4">
            <textarea
              aria-label="Editor JSON del mapa"
              value={jsonDraft}
              onChange={(event) => setJsonDraft(event.target.value)}
              className="min-h-[320px] w-full rounded-2xl border border-line bg-slate-50 p-4 font-mono text-xs leading-5 text-ink shadow-inner"
              spellCheck={false}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary min-h-11 rounded-full px-4" onClick={validateJson}>Validar JSON</button>
              <button type="button" className="btn-primary min-h-11 rounded-full px-4" onClick={applyJson}>Aplicar JSON</button>
              <button type="button" className="btn-secondary min-h-11 rounded-full px-4" onClick={() => void navigator.clipboard?.writeText(jsonDraft)}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copiar JSON
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <AnimatePresence>
        {editingIndex !== undefined ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setEditingIndex(undefined)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={editingIndex === "new" ? "Crear regla" : "Editar regla"}
              className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-lift"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-ink">{editingIndex === "new" ? "Crear regla" : "Editar regla"}</h3>
                  <p className="mt-1 text-sm text-muted">Define cómo se clasifica un concepto detectado en PDF.</p>
                </div>
                <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => setEditingIndex(undefined)}>Cerrar</button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-semibold text-ink">
                  Concepto PDF
                  <input value={form.pdfConcept} onChange={(event) => setForm({ ...form, pdfConcept: event.target.value })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm" />
                </label>
                <label className="block text-sm font-semibold text-ink">
                  Alias separados por coma
                  <input value={form.aliasesText} onChange={(event) => setForm({ ...form, aliasesText: event.target.value })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm" />
                </label>
                <label className="block text-sm font-semibold text-ink">
                  Código Registro
                  <input list="concept-map-codes" value={form.registroCode} onChange={(event) => setForm({ ...form, registroCode: event.target.value })} className="mt-2 h-12 w-full rounded-full border border-line px-4 font-mono text-sm" />
                  <datalist id="concept-map-codes">
                    {availableCodes.map((code) => <option key={code} value={code} />)}
                  </datalist>
                  {codeWarning ? <span className="mt-2 block text-sm font-semibold text-orange-700">Este código no existe en el Registro cargado.</span> : null}
                </label>
                <label className="block text-sm font-semibold text-ink">
                  Bloque
                  <select value={form.block} onChange={(event) => setForm({ ...form, block: event.target.value as RetributionBlock })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm">
                    {BLOCKS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold text-ink">
                  Estado
                  <select
                    value={form.status}
                    onChange={(event) => {
                      const status = event.target.value as MappingStatus;
                      setForm({
                        ...form,
                        status,
                        includedInComparison: status === "Incluido" || status === "Justificado",
                        includedInAdjustedComparison: status !== "Justificado",
                        reason: status === "Justificado" && !form.reason ? JUSTIFIED_HELP : form.reason,
                      });
                    }}
                    className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm"
                  >
                    {STATUSES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  {form.status === "Justificado" ? <span className="mt-2 block text-sm font-semibold text-violet-700">{JUSTIFIED_HELP}</span> : null}
                </label>
                <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Activa" description="Las reglas inactivas no afectan al análisis." />
              </div>

              <label className="mt-5 block text-sm font-semibold text-ink">
                Motivo
                <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-2 min-h-28 w-full rounded-2xl border border-line p-4 text-sm" />
              </label>

              <details className="mt-5 rounded-2xl bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink">Opciones avanzadas</summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-ink">
                    Origen
                    <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as ConceptMappingSourceType })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm">
                      {SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-ink">
                    Prioridad deduplicación
                    <select value={form.dedupePriority} onChange={(event) => setForm({ ...form, dedupePriority: event.target.value as ConceptDedupePriority })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm">
                      {DEDUPE_PRIORITIES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <Toggle checked={form.allowInformative} onChange={(allowInformative) => setForm({ ...form, allowInformative })} label="Permitir informativos" description="Permite usar conceptos informativos si la regla lo requiere." />
                  <Toggle checked={form.includedInComparison} onChange={(includedInComparison) => setForm({ ...form, includedInComparison })} label="Incluido en diferencia bruta" description="No activa diferencia ajustada; solo mantiene el cálculo bruto actual." />
                  <Toggle
                    checked={form.status === "Justificado" ? false : form.includedInAdjustedComparison}
                    onChange={(includedInAdjustedComparison) => setForm({ ...form, includedInAdjustedComparison: form.status === "Justificado" ? false : includedInAdjustedComparison })}
                    label="Preparado para diferencia ajustada"
                    description="Campo de mapa; la diferencia ajustada se aplicará en una subfase posterior."
                  />
                </div>
              </details>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditingIndex(undefined)}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={saveForm}>Guardar regla</button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
