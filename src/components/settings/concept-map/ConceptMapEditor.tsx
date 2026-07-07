"use client";

import { Copy, Download, FileJson, Pencil, Plus, RefreshCcw, Save, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
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

type RuleTab = "Todos" | "Incluidos" | "Justificados" | "Pendientes" | "Ignorados" | "Sin mapear";

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

const STATUSES: readonly MappingStatus[] = ["Incluido", "Justificado", "Pendiente revisión", "Ignorado"];
const BLOCKS: readonly RetributionBlock[] = ["Salario", "C. Salarial", "Extrasalarial"];
const SOURCE_TYPES: readonly ConceptMappingSourceType[] = ["devengo", "informativo", "deduccion", "retencion", "coste_empresa", "unknown"];
const DEDUPE_PRIORITIES: readonly ConceptDedupePriority[] = ["devengo", "informativo"];
const TABS: readonly RuleTab[] = ["Todos", "Incluidos", "Justificados", "Pendientes", "Ignorados", "Sin mapear"];

const JUSTIFIED_HELP = "Visible y auditable, pero preparado para excluirse de la diferencia ajustada en una fase posterior.";
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
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
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

function tabForStatus(status: MappingStatus): RuleTab {
  if (status === "Incluido") return "Incluidos";
  if (status === "Justificado") return "Justificados";
  if (status === "Ignorado") return "Ignorados";
  return "Pendientes";
}

function ruleMatches(rule: ConceptMappingRule, query: string): boolean {
  if (!query) return true;
  const values = [
    rule.pdfConcept,
    ...(rule.aliases ?? []),
    rule.registroCode,
    rule.block,
    rule.reason,
  ];
  const normalizedQuery = normalizeComparableText(query);
  return values.some((value) => normalizeComparableText(value).includes(normalizedQuery));
}

function statusBadgeClass(status: string): string {
  if (status === "Incluido") return "bg-emerald-50 text-emerald-700";
  if (status === "Justificado") return "bg-violet-50 text-violet-700";
  if (status.includes("Pendiente")) return "bg-orange-50 text-orange-700";
  if (status === "Ignorado") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
}

function availableCodesFromResult(result: ReturnType<typeof useAppState>["result"]): readonly string[] {
  const codes = new Set<string>();
  result?.registroEmployees.forEach((employee) => employee.concepts.forEach((concept) => codes.add(concept.code)));
  return [...codes].sort((left, right) => left.localeCompare(right, "es"));
}

function codeExists(code: string, availableCodes: readonly string[]): boolean {
  if (!code.trim() || !availableCodes.length) return true;
  const normalized = normalizeComparableText(code);
  return availableCodes.some((item) => normalizeComparableText(item) === normalized);
}

function counterLabel(tab: RuleTab, rules: readonly ConceptMappingRule[], unmapped: readonly UnmappedConceptRow[]): number {
  if (tab === "Todos") return rules.length;
  if (tab === "Sin mapear") return unmapped.filter((row) => row.decisionType === "Sin mapear real" || !row.decisionType).length;
  return rules.filter((rule) => tabForStatus(rule.status) === tab).length;
}

function ruleKey(rule: ConceptMappingRule, index: number): string {
  return `${normalizePdfConcept(rule.pdfConcept)}-${index}`;
}

export function ConceptMapEditor() {
  const { settings, updateSettings, saveConceptMapAndRefresh, result, activeAnalysis } = useAppState();
  const activeResult = result ?? activeAnalysis?.result;
  const availableCodes = useMemo(() => availableCodesFromResult(activeResult), [activeResult]);
  const sourceRules = useMemo(
    () => (settings.conceptMap.length ? settings.conceptMap : activeResult?.conceptMap ?? []),
    [activeResult?.conceptMap, settings.conceptMap],
  );
  const unmapped = activeResult?.unmappedConcepts ?? [];
  const [rules, setRules] = useState<readonly ConceptMappingRule[]>(() => normalizeRules(sourceRules));
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<RuleTab>("Todos");
  const [blockFilter, setBlockFilter] = useState<"Todos" | RetributionBlock>("Todos");
  const [statusFilter, setStatusFilter] = useState<"Todos" | MappingStatus>("Todos");
  const [sourceFilter, setSourceFilter] = useState<"Todos" | ConceptMappingSourceType>("Todos");
  const [editingIndex, setEditingIndex] = useState<number | "new" | undefined>();
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [message, setMessage] = useState<string | undefined>();
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");

  useEffect(() => {
    const normalized = normalizeRules(sourceRules);
    setRules(normalized);
    setJsonDraft(JSON.stringify(normalized, null, 2));
  }, [sourceRules]);

  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      if (tab !== "Todos" && tab !== "Sin mapear" && tabForStatus(rule.status) !== tab) return false;
      if (blockFilter !== "Todos" && rule.block !== blockFilter) return false;
      if (statusFilter !== "Todos" && rule.status !== statusFilter) return false;
      if (sourceFilter !== "Todos" && rule.sourceType !== sourceFilter) return false;
      return ruleMatches(rule, query);
    });
  }, [blockFilter, query, rules, sourceFilter, statusFilter, tab]);

  const codeWarning = form.registroCode.trim() && !codeExists(form.registroCode, availableCodes);

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

  function openFromUnmapped(row: UnmappedConceptRow, status: MappingStatus = row.action): void {
    openRule({
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
      reason: row.reason ?? row.recommendedAction,
    });
  }

  function saveForm(): void {
    if (!form.pdfConcept.trim()) {
      setMessage("Concepto PDF obligatorio.");
      return;
    }
    const nextRule = formToRule(form);
    const next = editingIndex === "new" || editingIndex === undefined
      ? [...rules, nextRule]
      : rules.map((rule, index) => (index === editingIndex ? nextRule : rule));
    persistRules(next, "Regla guardada.");
    setEditingIndex(undefined);
  }

  function duplicateRule(rule: ConceptMappingRule): void {
    openRule({ ...rule, pdfConcept: `${rule.pdfConcept} copia`, normalizedPdfConcept: normalizePdfConcept(`${rule.pdfConcept} copia`) });
  }

  function deleteRule(index: number): void {
    persistRules(rules.filter((_, itemIndex) => itemIndex !== index), "Regla eliminada.");
  }

  function setRuleStatus(index: number, status: MappingStatus): void {
    persistRules(
      rules.map((rule, itemIndex) =>
        itemIndex === index
          ? normalizeConceptMappingRule({
              ...rule,
              status,
              includedInComparison: status === "Incluido" || status === "Justificado",
              includedInAdjustedComparison: status !== "Justificado",
            })
          : rule,
      ),
      "Estado actualizado.",
    );
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
    const defaults = activeResult?.conceptMap ? normalizeRules(activeResult.conceptMap) : [];
    setRules(defaults);
    setJsonDraft(JSON.stringify(defaults, null, 2));
    updateSettings({ conceptMap: [] });
    setMessage("Mapa manual restaurado. Se usará el mapa por defecto dinámico.");
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Mapa de conceptos</h2>
          <p className="mt-1 text-sm text-muted">Editor visual de reglas PDF {"->"} código Registro. El JSON queda reservado al modo avanzado.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => persistRules(rules, "Mapa de conceptos guardado.")}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Guardar mapa
          </button>
          <button type="button" className="btn-secondary" onClick={() => void saveConceptMapAndRefresh(rules)}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Actualizar datos
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <p className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-primary">
          Esta fase clasifica reglas. La diferencia ajustada de Personas se aplicará en una subfase posterior.
        </p>
        <p className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-semibold leading-6 text-violet-700">
          Justificado: {JUSTIFIED_HELP}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn("min-h-10 rounded-full px-4 text-sm font-semibold transition", tab === item ? "bg-ink text-white shadow-subtle" : "bg-slate-100 text-muted hover:bg-slate-200")}
          >
            {item} <span className="ml-1 opacity-80">{counterLabel(item, rules, unmapped)}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1.2fr_220px_220px_220px]">
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
          Bloque
          <select value={blockFilter} onChange={(event) => setBlockFilter(event.target.value as typeof blockFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
            <option>Todos</option>
            {BLOCKS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-ink">
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
            <option>Todos</option>
            {STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-ink">
          Origen
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)} className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium">
            <option>Todos</option>
            {SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => openRule()}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Añadir regla
        </button>
        <button type="button" className="btn-secondary" onClick={exportMap}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Exportar mapa
        </button>
        <button type="button" className="btn-secondary" onClick={importMap}>
          <FileJson className="h-4 w-4" aria-hidden="true" />
          Importar mapa
        </button>
        <button type="button" className="btn-danger" onClick={resetDefault}>
          Restaurar defecto
        </button>
      </div>

      <div className="mt-5 overflow-auto rounded-2xl border border-line">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase text-muted">
            <tr>
              {["Estado", "Concepto PDF", "Código Registro", "Bloque", "Origen", "Activa", "Motivo", "Acciones"].map((header) => (
                <th key={header} className="border-b border-line px-4 py-3">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRules.map((rule, filteredIndex) => {
              const index = rules.findIndex((item, itemIndex) => itemIndex >= filteredIndex && item === rule);
              const realIndex = index >= 0 ? index : filteredIndex;
              return (
                <motion.tr key={ruleKey(rule, realIndex)} layout className="odd:bg-white even:bg-slate-50 hover:bg-blue-50">
                  <td className="border-b border-line/70 px-4 py-3">
                    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", statusBadgeClass(rule.status))}>{rule.status}</span>
                    {rule.status === "Justificado" ? <p className="mt-1 text-xs leading-4 text-violet-700">{JUSTIFIED_HELP}</p> : null}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3">
                    <p className="font-semibold text-ink">{rule.pdfConcept}</p>
                    {(rule.aliases ?? []).length ? <p className="mt-1 text-xs text-muted">Alias: {(rule.aliases ?? []).join(", ")}</p> : null}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3 font-mono text-xs">{rule.registroCode ?? "Sin código"}</td>
                  <td className="border-b border-line/70 px-4 py-3">{rule.block}</td>
                  <td className="border-b border-line/70 px-4 py-3">{rule.sourceType ?? "unknown"}</td>
                  <td className="border-b border-line/70 px-4 py-3"><Badge value={rule.active === false ? "Inactiva" : "Activa"} /></td>
                  <td className="max-w-xs border-b border-line/70 px-4 py-3 text-muted">{rule.reason ?? "Sin motivo"}</td>
                  <td className="border-b border-line/70 px-4 py-3">
                    <div className="flex min-w-80 flex-wrap gap-2">
                      <button type="button" className="btn-secondary min-h-9 px-3" aria-label={`Editar ${rule.pdfConcept}`} onClick={() => openRule(rule, realIndex)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Editar
                      </button>
                      <button type="button" className="btn-secondary min-h-9 px-3" aria-label={`Duplicar ${rule.pdfConcept}`} onClick={() => duplicateRule(rule)}>
                        Duplicar
                      </button>
                      <button type="button" className="btn-secondary min-h-9 px-3" aria-label={`${rule.active === false ? "Activar" : "Desactivar"} ${rule.pdfConcept}`} onClick={() => setRuleActive(realIndex, rule.active === false)}>
                        {rule.active === false ? "Activar" : "Desactivar"}
                      </button>
                      <select aria-label={`Cambiar estado ${rule.pdfConcept}`} value={rule.status} onChange={(event) => setRuleStatus(realIndex, event.target.value as MappingStatus)} className="min-h-9 rounded-full border border-line bg-white px-3 text-xs font-semibold">
                        {STATUSES.map((item) => <option key={item}>{item}</option>)}
                      </select>
                      <button type="button" className="btn-danger min-h-9 px-3" aria-label={`Eliminar ${rule.pdfConcept}`} onClick={() => deleteRule(realIndex)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Eliminar
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
        {!filteredRules.length ? <p className="p-6 text-sm font-semibold text-muted">No hay reglas con los filtros actuales.</p> : null}
      </div>

      {unmapped.length ? (
        <section className="mt-6 rounded-2xl border border-orange-100 bg-orange-50/70 p-4" aria-label="Conceptos sin mapear">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-ink">Conceptos pendientes y sin mapear</h3>
              <p className="text-sm text-muted">Crea reglas directamente desde conceptos detectados en el análisis actual.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {unmapped.map((row) => (
              <div key={row.pdfConcept} className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-subtle lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge value={row.decisionType ?? row.action} />
                    <p className="font-semibold text-ink">{row.pdfConcept}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted">{row.reason ?? row.recommendedAction ?? "Pendiente de revisar."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary min-h-9 px-3" aria-label={`Crear regla para ${row.pdfConcept}`} onClick={() => openFromUnmapped(row)}>
                    Crear regla
                  </button>
                  <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => openFromUnmapped(row, "Ignorado")}>Ignorar</button>
                  <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => openFromUnmapped(row, "Justificado")}>Justificar</button>
                  <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => openFromUnmapped(row, "Incluido")}>Mapear a código</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6 rounded-2xl border border-line bg-slate-50 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-ink"
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((current) => !current)}
        >
          <span>Modo avanzado JSON</span>
          <span>{jsonOpen ? "Cerrar" : "Abrir"}</span>
        </button>
        {jsonOpen ? (
          <div className="mt-4">
            <p className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
              Editar JSON manualmente puede romper el mapa. Usa esta opción solo si sabes lo que haces.
            </p>
            <textarea
              aria-label="Editor JSON del mapa"
              value={jsonDraft}
              onChange={(event) => setJsonDraft(event.target.value)}
              className="mt-4 min-h-64 w-full rounded-2xl border border-line bg-white p-4 font-mono text-xs text-ink shadow-subtle"
              spellCheck={false}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={validateJson}>Validar JSON</button>
              <button type="button" className="btn-primary" onClick={applyJson}>Aplicar JSON</button>
              <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(jsonDraft)}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copiar JSON
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {message ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{message}</p> : null}

      <AnimatePresence>
        {editingIndex !== undefined ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setEditingIndex(undefined)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={editingIndex === "new" ? "Añadir regla" : "Editar regla"}
              className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-lift"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-ink">{editingIndex === "new" ? "Añadir regla" : "Editar regla"}</h3>
                  <p className="mt-1 text-sm text-muted">Define cómo se clasifica un concepto detectado en PDF.</p>
                </div>
                <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => setEditingIndex(undefined)}>Cerrar</button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-semibold text-ink">
                  Concepto PDF / patrón principal
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
                      });
                    }}
                    className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm"
                  >
                    {STATUSES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  {form.status === "Justificado" ? <span className="mt-2 block text-sm font-semibold text-violet-700">{JUSTIFIED_HELP}</span> : null}
                </label>
                <label className="block text-sm font-semibold text-ink">
                  Tipo origen
                  <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as ConceptMappingSourceType })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm">
                    {SOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>

              <details className="mt-5 rounded-2xl bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink">Opciones avanzadas</summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Toggle checked={form.allowInformative} onChange={(allowInformative) => setForm({ ...form, allowInformative })} label="Permitir informativos" description="Permite usar conceptos informativos si la regla lo requiere." />
                  <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Activa" description="Las reglas inactivas no afectan al análisis." />
                  <label className="block text-sm font-semibold text-ink">
                    Prioridad deduplicación
                    <select value={form.dedupePriority} onChange={(event) => setForm({ ...form, dedupePriority: event.target.value as ConceptDedupePriority })} className="mt-2 h-12 w-full rounded-full border border-line px-4 text-sm">
                      {DEDUPE_PRIORITIES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <Toggle checked={form.includedInComparison} onChange={(includedInComparison) => setForm({ ...form, includedInComparison })} label="Incluido en diferencia bruta" description="No activa diferencia ajustada; solo mantiene el cálculo bruto actual." />
                </div>
              </details>

              <label className="mt-5 block text-sm font-semibold text-ink">
                Motivo / observación
                <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-2 min-h-28 w-full rounded-2xl border border-line p-4 text-sm" />
              </label>

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
