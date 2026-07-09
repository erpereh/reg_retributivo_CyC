"use client";

import { Copy, Search, Table2, X } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AiExplanationPanel } from "@/components/ai/AiExplanationPanel";
import { useAppState, type DashboardFilters, EMPTY_FILTERS, matchesQuery } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { AgrupacionesView } from "@/components/groupings/AgrupacionesView";
import { buildConceptExplainPayload, buildNotIncludedConceptExplainPayload, buildPersonExplainPayload } from "@/lib/ai/explainPayload";
import type { AppView, ConceptComparisonRow, PersonComparisonRow, UnmappedConceptRow } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";
import { describeConceptCause, describePersonCause, type ProbableCause } from "@/lib/ui/probableCause";
import { cn } from "@/lib/utils/classNames";
import { displayText } from "@/lib/ui/displayText";

interface TableHeader {
  readonly key: string;
  readonly label: string;
}

type TableDensity = "comfortable" | "compact";
type DetailModalState =
  | { readonly kind: "person"; readonly row: PersonComparisonRow }
  | { readonly kind: "concept"; readonly row: ConceptComparisonRow }
  | { readonly kind: "unmapped"; readonly row: UnmappedConceptRow };
type PersonConceptFilter = "all" | "differences" | "ok" | "review";

const PERSONAS_HEADERS: readonly TableHeader[] = [
  { key: "employeeNumber", label: "Matrícula" },
  { key: "person", label: "Persona" },
  { key: "cause", label: "Causa" },
  { key: "workplace", label: "Centro" },
  { key: "position", label: "Puesto" },
  { key: "category", label: "Categoría" },
  { key: "registroTotal", label: "Total Reg. Retrib." },
  { key: "pdfTotal", label: "Total Recibo" },
  { key: "difference", label: "Diferencia" },
  { key: "status", label: "Estado" },
];

const CONCEPTOS_HEADERS: readonly TableHeader[] = [
  { key: "employeeNumber", label: "Matrícula" },
  { key: "person", label: "Persona" },
  { key: "block", label: "Bloque" },
  { key: "registroCode", label: "Código Reg. Retrib." },
  { key: "pdfConcept", label: "Concepto Recibo" },
  { key: "registroAmount", label: "Reg. Retrib." },
  { key: "pdfAmount", label: "Recibo" },
  { key: "difference", label: "Diferencia" },
  { key: "status", label: "Estado" },
  { key: "reason", label: "Motivo" },
];

const CONCEPTOS_NO_INCLUIDOS_HEADERS: readonly TableHeader[] = [
  { key: "decisionType", label: "Tipo decisión" },
  { key: "includedInComparison", label: "Incluido en cálculo" },
  { key: "pdfConcept", label: "Concepto Recibo" },
  { key: "totalDetected", label: "Total detectado" },
  { key: "peopleCount", label: "Personas" },
  { key: "payrollCount", label: "Recibos" },
  { key: "exampleEmployeeNumbers", label: "Ejemplos matrículas" },
  { key: "suggestedBlock", label: "Sugerencia bloque" },
  { key: "suggestedRegistroCode", label: "Sugerencia código Reg. Retrib." },
  { key: "recommendedAction", label: "Acción recomendada" },
  { key: "reason", label: "Motivo" },
];

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

function rowTone(status?: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50 hover:bg-emerald-100";
    case "Revisar":
    case "Sin mapear":
      return "bg-orange-50 hover:bg-orange-100";
    case "Diferencia":
      return "bg-red-50 hover:bg-red-100";
    case "Sin Registro":
      return "bg-violet-50 hover:bg-violet-100";
    case "Sin PDF":
      return "bg-slate-50 hover:bg-slate-100";
    default:
      return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
  }
}

function statusLabel(status: string): string {
  if (status === "Sin Registro") return "Recibo sin Reg. Retrib.";
  if (status === "Sin PDF") return "Reg. Retrib. sin Recibo";
  return status;
}

function diffClass(value: number): string {
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-blue-700";
  return "text-slate-700";
}

function cellPadding(density: TableDensity): string {
  return density === "compact" ? "px-3 py-2" : "px-4 py-4";
}

function stickyFirstColumn(density: TableDensity): string {
  return cn("sticky left-0 z-10 min-w-[128px] bg-inherit shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]", cellPadding(density));
}

function FiltersPanel({
  filters,
  centers,
  groups,
  onChange,
}: Readonly<{
  filters: DashboardFilters;
  centers: readonly string[];
  groups: readonly string[];
  onChange: (filters: DashboardFilters) => void;
}>) {
  const quick = (status: string) => onChange({ ...filters, status });

  return (
    <Card className="p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-semibold text-ink xl:col-span-1">
          Buscar
          <span className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => onChange({ ...filters, query: event.target.value })}
              placeholder="Matrícula, persona o concepto"
              className="filter-control pl-11"
            />
          </span>
        </label>
        <label className="text-sm font-semibold text-ink">
          Centro
          <select value={filters.center} onChange={(event) => onChange({ ...filters, center: event.target.value })} className="filter-control mt-2">
            <option value="">Todos</option>
            {centers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Puesto / categoria
          <select value={filters.group} onChange={(event) => onChange({ ...filters, group: event.target.value })} className="filter-control mt-2">
            <option value="">Todos</option>
            {groups.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Estado
          <select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value })} className="filter-control mt-2">
            <option value="">Todos</option>
            {["OK", "Revisar", "Diferencia", "Sin mapear", "Sin PDF", "Sin Registro"].map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost min-h-10 px-4" onClick={() => quick("Diferencia")}>
          Ver solo diferencias
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4" onClick={() => quick("Revisar")}>
          Ver pendientes
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4" onClick={() => quick("Sin Registro")}>
          Ver Recibo sin Reg. Retrib.
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4" onClick={() => quick("OK")}>
          Ver OK
        </button>
        <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => onChange(EMPTY_FILTERS)}>
          Limpiar filtros
        </button>
      </div>
    </Card>
  );
}

function TableSummary({
  visible,
  total,
  difference,
  extra,
}: Readonly<{ visible: number; total: number; difference: number; extra?: string }>) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm shadow-subtle">
      <span className="font-semibold text-ink">
        {visible} filas visibles de {total}
      </span>
      <span className="text-muted">Suma diferencia visible: {formatEuro(difference)}</span>
      {extra ? <span className="text-muted">{extra}</span> : null}
    </div>
  );
}

function CauseBadge({ cause }: Readonly<{ cause: ProbableCause }>) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{displayText(cause.label)}</span>;
}

function ModalField({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{displayText(value) || "Sin dato"}</p>
    </div>
  );
}

function PeriodChips({ periods }: Readonly<{ periods: readonly string[] }>) {
  return (
    <div className="md:col-span-4">
      <p className="text-xs font-semibold uppercase text-muted">Periodos</p>
      {periods.length ? (
        <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
          {periods.map((period) => (
            <span
              key={period}
              data-testid="period-chip"
              className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold leading-5 text-blue-900"
            >
              {displayText(period)}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold text-ink">Sin dato</p>
      )}
    </div>
  );
}

function MoneyTriplet({ label, registro, pdf, diff }: Readonly<{ label: string; registro: number; pdf: number; diff: number }>) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <ModalField label="Reg. Retrib." value={formatEuro(registro)} />
        <ModalField label="Recibo" value={formatEuro(pdf)} />
        <ModalField label="Dif." value={formatEuro(diff)} />
      </div>
    </div>
  );
}

function PersonSummarySection({ row }: Readonly<{ row: PersonComparisonRow }>) {
  return (
    <section className="mt-6 rounded-3xl border border-line bg-slate-50 p-4" aria-label="Resumen">
      <h3 className="text-lg font-semibold text-ink">Resumen</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <ModalField label="Total Reg. Retrib." value={formatEuro(row.registroTotal)} />
        <ModalField label="Total Recibo" value={formatEuro(row.pdfTotal)} />
        <ModalField label="Diferencia" value={formatEuro(row.totalDifference)} />
        <ModalField label="Estado" value={row.status} />
      </div>
    </section>
  );
}

function conceptRowKey(row: ConceptComparisonRow, index: number): string {
  return `${row.employeeNumber}-${row.registroCode}-${row.pdfConcept ?? "sin-pdf"}-${index}`;
}

function conceptPriority(row: ConceptComparisonRow): number {
  if (row.status === "Diferencia") return 0;
  if (row.status === "Revisar") return 1;
  if (["Sin mapear", "Sin PDF", "Sin Registro"].includes(row.status)) return 3;
  if (row.status === "OK") return 4;
  return 4;
}

function isReviewConcept(row: ConceptComparisonRow): boolean {
  return row.status === "Revisar" || row.status === "Sin mapear";
}

function filterPersonConcept(row: ConceptComparisonRow, filter: PersonConceptFilter, tolerance: number): boolean {
  if (filter === "differences") return Math.abs(row.difference) > tolerance || row.status === "Diferencia";
  if (filter === "ok") return row.status === "OK";
  if (filter === "review") return isReviewConcept(row);
  return true;
}

function sortPersonConcepts(rows: readonly ConceptComparisonRow[]): ConceptComparisonRow[] {
  return [...rows].sort((left, right) => {
    const priority = conceptPriority(left) - conceptPriority(right);
    if (priority !== 0) return priority;
    return Math.abs(right.difference) - Math.abs(left.difference);
  });
}

function PersonConceptsSection({
  person,
  concepts,
  unmappedConcepts,
  tolerance,
}: Readonly<{
  person: PersonComparisonRow;
  concepts: readonly ConceptComparisonRow[];
  unmappedConcepts: readonly UnmappedConceptRow[];
  tolerance: number;
}>) {
  const [filter, setFilter] = useState<PersonConceptFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | undefined>();
  const personConcepts = useMemo(() => sortPersonConcepts(concepts.filter((row) => row.employeeNumber === person.employeeNumber)), [concepts, person.employeeNumber]);
  const visibleConcepts = useMemo(() => personConcepts.filter((row) => filterPersonConcept(row, filter, tolerance)), [filter, personConcepts, tolerance]);
  const relatedUnmapped = useMemo(
    () => unmappedConcepts.filter((row) => row.exampleEmployeeNumbers.includes(person.employeeNumber)),
    [person.employeeNumber, unmappedConcepts],
  );
  const okCount = personConcepts.filter((row) => row.status === "OK").length;
  const realDifferenceCount = personConcepts.filter((row) => Math.abs(row.difference) > tolerance || row.status === "Diferencia").length;
  const reviewCount = personConcepts.filter(isReviewConcept).length;
  const visibleDifference = visibleConcepts.reduce((sum, row) => sum + row.difference, 0);
  const filterOptions: Array<{ label: string; value: PersonConceptFilter }> = [
    { label: "Todos", value: "all" },
    { label: "Solo diferencias", value: "differences" },
    { label: "OK", value: "ok" },
    { label: "Revisar", value: "review" },
  ];

  return (
    <section className="mt-6 rounded-3xl border border-line bg-white p-4 shadow-subtle sm:p-5" aria-label="Conceptos de la persona">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Conceptos de la persona</h3>
          <p className="mt-1 text-sm leading-6 text-muted">Comparativa de conceptos del Reg. Retrib. contra los importes detectados en recibos para esta matrícula.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn("min-h-9 rounded-full px-3 text-xs font-semibold transition", filter === item.value ? "bg-primary text-white shadow-blue" : "bg-slate-100 text-muted hover:bg-slate-200")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {[
          ["Conceptos totales", personConcepts.length],
          ["Conceptos OK", okCount],
          ["Conceptos con diferencia", realDifferenceCount],
          ["Conceptos en revisión", reviewCount],
          ["Diferencia visible", formatEuro(visibleDifference)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase text-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold text-ink tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {personConcepts.length ? (
        <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-line">
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {["Bloque", "Código Reg. Retrib.", "Concepto Recibo", "Reg. Retrib.", "Recibo", "Diferencia", "Estado", "Motivo"].map((header) => (
                  <th key={`person-concept-${header}`} className="border-b border-line px-3 py-3 text-xs font-semibold uppercase">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleConcepts.map((row, index) => {
                const key = conceptRowKey(row, index);
                const conceptCause = describeConceptCause(row, tolerance);
                const expanded = expandedKey === key;

                return (
                  <Fragment key={key}>
                    <tr
                      tabIndex={0}
                      onClick={() => setExpandedKey(expanded ? undefined : key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setExpandedKey(expanded ? undefined : key);
                      }}
                      className={cn("cursor-pointer transition", rowTone(row.status))}
                    >
                      <td className="border-b border-line/70 px-3 py-3 font-semibold">{displayText(row.block)}</td>
                      <td className="border-b border-line/70 px-3 py-3 font-mono">{displayText(row.registroCode)}</td>
                      <td className="max-w-[260px] truncate border-b border-line/70 px-3 py-3 font-semibold">{displayText(row.pdfConcept)}</td>
                      <td className="border-b border-line/70 px-3 py-3 text-right font-mono">{formatEuro(row.registroAmount)}</td>
                      <td className="border-b border-line/70 px-3 py-3 text-right font-mono">{formatEuro(row.pdfAmount)}</td>
                      <td className={cn("border-b border-line/70 px-3 py-3 text-right font-mono", diffClass(row.difference))}>{formatEuro(row.difference)}</td>
                      <td className="border-b border-line/70 px-3 py-3"><Badge value={row.status} /></td>
                      <td className="border-b border-line/70 px-3 py-3"><CauseBadge cause={conceptCause} /></td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-white">
                        <td colSpan={8} className="border-b border-line/70 p-4">
                          <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-4">
                            <ModalField label="Código Reg. Retrib." value={row.registroCode} />
                            <ModalField label="Concepto Recibo" value={row.pdfConcept} />
                            <ModalField label="Bloque" value={row.block} />
                            <ModalField label="Diferencia" value={formatEuro(row.difference)} />
                            <ModalField label="Estado" value={row.status} />
                            <div className="md:col-span-2">
                              <p className="text-sm font-semibold text-ink">Causa probable: {conceptCause.label}</p>
                              <p className="mt-1 text-sm leading-6 text-muted">{displayText(conceptCause.description)}</p>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-sm font-semibold text-ink">Qué revisar</p>
                              <p className="mt-1 text-sm leading-6 text-muted">{displayText(conceptCause.review)}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!visibleConcepts.length ? <p className="p-5 text-sm text-muted">No hay conceptos con el filtro actual.</p> : null}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm font-semibold text-muted">No hay conceptos comparados para esta matrícula.</p>
      )}

      {relatedUnmapped.length ? (
        <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
          <h4 className="text-sm font-semibold text-ink">Conceptos no incluidos de esta persona</h4>
          <div className="mt-3 overflow-auto rounded-xl border border-orange-100 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-orange-50 text-muted">
                <tr>
                  {["Concepto Recibo", "Total detectado", "Tipo decisión", "Motivo", "Acción recomendada"].map((header) => (
                    <th key={`person-unmapped-${header}`} className="px-3 py-2 text-xs font-semibold uppercase">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {relatedUnmapped.map((row) => (
                  <tr key={row.pdfConcept} className="border-t border-orange-100">
                    <td className="px-3 py-2 font-semibold">{displayText(row.pdfConcept)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatEuro(row.totalDetected)}</td>
                    <td className="px-3 py-2"><Badge value={row.decisionType ?? row.action} /></td>
                    <td className="px-3 py-2 text-muted">{displayText(row.reason)}</td>
                    <td className="px-3 py-2 text-muted">{displayText(row.recommendedAction ?? row.action)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailModal({
  state,
  tolerance,
  concepts,
  unmappedConcepts,
  onClose,
}: Readonly<{ state: DetailModalState; tolerance: number; concepts: readonly ConceptComparisonRow[]; unmappedConcepts: readonly UnmappedConceptRow[]; onClose: () => void }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const title = state.kind === "person" ? "Detalle persona" : state.kind === "concept" ? "Detalle concepto" : "Detalle concepto no incluido";
  const cause =
    state.kind === "person"
      ? describePersonCause(state.row, tolerance)
      : state.kind === "concept"
        ? describeConceptCause(state.row, tolerance)
        : {
            label: state.row.decisionType ?? (state.row.action === "Ignorado" ? "Ignorado" : "Sin mapear real"),
            description: displayText(state.row.reason) || "Concepto no incluido en el cálculo principal.",
            review: displayText(state.row.recommendedAction) || "Revisar criterio de decisión.",
          };
  const copySummary = `${title}: ${cause.label} - ${cause.description}`;
  const aiType = state.kind === "person" ? "person" : state.kind === "concept" ? "concept" : "notIncludedConcept";
  const aiPayload =
    state.kind === "person"
      ? buildPersonExplainPayload(state.row, cause, concepts, unmappedConcepts)
      : state.kind === "concept"
        ? buildConceptExplainPayload(state.row, cause)
        : buildNotIncludedConceptExplainPayload(state.row, cause);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-lift sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted">Detalle determinista</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {state.kind === "person" ? (
            <>
              <ModalField label="Matrícula" value={state.row.employeeNumber} />
              <ModalField label="Persona" value={state.row.person} />
              <ModalField label="Centro" value={state.row.workplace} />
              <ModalField label="Puesto" value={state.row.position} />
              <ModalField label="Categoría" value={state.row.category} />
              <ModalField label="Estado" value={state.row.status} />
              <ModalField label="Recibos" value={state.row.payrollCount} />
              <PeriodChips periods={state.row.periods} />
            </>
          ) : state.kind === "concept" ? (
            <>
              <ModalField label="Matrícula" value={state.row.employeeNumber} />
              <ModalField label="Persona" value={state.row.person} />
              <ModalField label="Bloque" value={state.row.block} />
              <ModalField label="Código Reg. Retrib." value={state.row.registroCode} />
              <ModalField label="Concepto Recibo" value={state.row.pdfConcept} />
              <ModalField label="Estado" value={state.row.status} />
              <ModalField label="Motivo" value={state.row.detail} />
              <ModalField label="Regla usada" value={state.row.detail} />
            </>
          ) : (
            <>
              <ModalField label="Concepto Recibo" value={state.row.pdfConcept} />
              <ModalField label="Total detectado" value={formatEuro(state.row.totalDetected)} />
              <ModalField label="Personas" value={state.row.peopleCount} />
              <ModalField label="Recibos" value={state.row.payrollCount} />
              <ModalField label="Ejemplos matrículas" value={state.row.exampleEmployeeNumbers.join("; ")} />
              <ModalField label="Tipo decisión" value={state.row.decisionType} />
              <ModalField label="Sugerencia bloque" value={state.row.suggestedBlock} />
              <ModalField label="Sugerencia código Reg. Retrib." value={state.row.suggestedRegistroCode} />
            </>
          )}
        </div>

        {state.kind === "person" ? <PersonSummarySection row={state.row} /> : null}

        {state.kind === "person" ? (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <MoneyTriplet label="Salario" registro={state.row.salaryRegistro} pdf={state.row.salaryPdf} diff={state.row.salaryDifference} />
            <MoneyTriplet label="C. Salarial" registro={state.row.salaryComplementRegistro} pdf={state.row.salaryComplementPdf} diff={state.row.salaryComplementDifference} />
            <MoneyTriplet label="Extrasalarial" registro={state.row.extraSalaryRegistro} pdf={state.row.extraSalaryPdf} diff={state.row.extraSalaryDifference} />
            <MoneyTriplet label="Total" registro={state.row.registroTotal} pdf={state.row.pdfTotal} diff={state.row.totalDifference} />
          </div>
        ) : state.kind === "concept" ? (
          <div className="mt-6">
            <MoneyTriplet label="Concepto" registro={state.row.registroAmount} pdf={state.row.pdfAmount} diff={state.row.difference} />
          </div>
        ) : null}

        {state.kind === "person" ? (
          <>
            <PersonConceptsSection person={state.row} concepts={concepts} unmappedConcepts={unmappedConcepts} tolerance={tolerance} />
          </>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-950">Causa probable: {cause.label}</p>
            <p className="mt-2 text-sm leading-6 text-blue-900">{displayText(cause.description)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">Qué revisar</p>
            <p className="mt-2 text-sm leading-6 text-muted">{displayText(cause.review)}</p>
          </div>
        </div>

        <AiExplanationPanel type={aiType} payload={aiPayload} />

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(copySummary)}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copiar resumen
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function PersonasTable({ density, onOpen }: Readonly<{ density: TableDensity; onOpen: (state: DetailModalState) => void }>) {
  const { result, filters } = useAppState();
  const allRows = result?.people ?? [];
  const rows = useMemo(
    () =>
      allRows.filter((item) => {
        if (!matchesQuery([item.employeeNumber, item.person, item.workplace, item.position, item.category], filters.query)) return false;
        if (filters.center && item.workplace !== filters.center) return false;
        if (filters.group && item.position !== filters.group && item.category !== filters.group) return false;
        if (filters.status && item.status !== filters.status) return false;
        return true;
      }),
    [allRows, filters],
  );
  const totalDifference = rows.reduce((sum, row) => sum + row.totalDifference, 0);
  const pdfWithoutRegistro = rows.filter((row) => row.status === "Sin Registro").reduce((sum, row) => sum + row.pdfTotal, 0);

  return (
    <div className="space-y-3">
      <TableSummary visible={rows.length} total={allRows.length} difference={totalDifference} extra={`Recibo sin Reg. Retrib. visible: ${formatEuro(pdfWithoutRegistro)}`} />
      <Card className="overflow-hidden p-0">
        <div className="max-h-[70dvh] overflow-auto">
          <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {PERSONAS_HEADERS.map((header, index) => (
                  <th
                    key={header.key}
                    className={cn(
                      "border-b border-line px-4 py-3 text-xs font-semibold uppercase",
                      index === 0 && "sticky left-0 z-30 min-w-[128px] bg-slate-100 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]",
                    )}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const cause = describePersonCause(row, result?.summary?.tolerance ?? 1);
                return (
                  <motion.tr
                    key={row.employeeNumber}
                    tabIndex={0}
                    onClick={() => onOpen({ kind: "person", row })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpen({ kind: "person", row });
                    }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16, delay: Math.min(index * 0.01, 0.16) }}
                    className={cn("cursor-pointer transition", rowTone(row.status))}
                  >
                    <td className={cn(stickyFirstColumn(density), "border-b border-line/70 font-mono")}>{displayText(row.employeeNumber)}</td>
                    <td className={cn("min-w-[220px] border-b border-line/70 font-semibold", cellPadding(density))}>{displayText(row.person)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><CauseBadge cause={cause} /></td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.workplace)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.position)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.category)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.registroTotal)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.pdfTotal)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.totalDifference))}>{formatEuro(row.totalDifference)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><Badge value={row.status} /></td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="p-6 text-sm text-muted">Sin personas con los filtros actuales.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function ConceptosTable({ density, onOpen }: Readonly<{ density: TableDensity; onOpen: (state: DetailModalState) => void }>) {
  const { result, filters } = useAppState();
  const allRows = result?.concepts ?? [];
  const rows = useMemo(
    () =>
      allRows.filter((item) => {
        if (!matchesQuery([item.employeeNumber, item.person, item.block, item.registroCode, item.pdfConcept], filters.query)) return false;
        if (filters.status && item.status !== filters.status) return false;
        return true;
      }),
    [allRows, filters],
  );
  const unmapped = result?.unmappedConcepts ?? [];
  const totalDifference = rows.reduce((sum, row) => sum + row.difference, 0);
  const pending = unmapped.filter((row) => row.decisionType === "Pendiente revision").length;

  return (
    <div className="space-y-6">
      <TableSummary visible={rows.length} total={allRows.length} difference={totalDifference} extra={`Pendientes visibles: ${pending}`} />
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Conceptos comparados</h2>
        </div>
        <div className="max-h-[62dvh] overflow-auto">
          <table className="w-full min-w-[1160px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {CONCEPTOS_HEADERS.map((header, index) => (
                  <th
                    key={header.key}
                    className={cn(
                      "border-b border-line px-4 py-3 text-xs font-semibold uppercase",
                      index === 0 && "sticky left-0 z-30 min-w-[128px] bg-slate-100 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]",
                    )}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const cause = describeConceptCause(row, result?.summary?.tolerance ?? 1);
                return (
                  <tr
                    key={`${row.employeeNumber}-${row.registroCode}-${index}`}
                    tabIndex={0}
                    onClick={() => onOpen({ kind: "concept", row })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpen({ kind: "concept", row });
                    }}
                    className={cn("cursor-pointer transition", rowTone(row.status))}
                  >
                    <td className={cn(stickyFirstColumn(density), "border-b border-line/70 font-mono")}>{displayText(row.employeeNumber)}</td>
                    <td className={cn("min-w-[220px] border-b border-line/70 font-semibold", cellPadding(density))}>{displayText(row.person)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.block)}</td>
                    <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{displayText(row.registroCode)}</td>
                    <td className={cn("max-w-[260px] truncate border-b border-line/70", cellPadding(density))}>{displayText(row.pdfConcept)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.registroAmount)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.pdfAmount)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.difference))}>{formatEuro(row.difference)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><Badge value={row.status} /></td>
                    <td className={cn("max-w-[320px] border-b border-line/70", cellPadding(density))}>
                      {displayText(row.detail || cause.label)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <p className="p-6 text-sm text-muted">Sin conceptos comparados con los filtros actuales.</p> : null}
        </div>
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Conceptos no incluidos</h2>
        </div>
        <div className="max-h-[52dvh] overflow-auto">
          <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {CONCEPTOS_NO_INCLUIDOS_HEADERS.map((header, index) => (
                  <th key={header.key} className={cn("border-b border-line px-4 py-3 text-xs font-semibold uppercase", index === 0 && "sticky left-0 z-30 bg-slate-100")}>
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unmapped.map((row) => (
                <tr key={row.pdfConcept} tabIndex={0} onClick={() => onOpen({ kind: "unmapped", row })} className="cursor-pointer odd:bg-white even:bg-slate-50 hover:bg-blue-50">
                  <td className={cn(stickyFirstColumn(density), "border-b border-line/70")}><Badge value={row.decisionType ?? (row.action === "Ignorado" ? "Ignorado" : "Sin mapear real")} /></td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{row.includedInComparison ? "Sí" : "No"}</td>
                  <td className={cn("border-b border-line/70 font-semibold", cellPadding(density))}>{displayText(row.pdfConcept)}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.totalDetected)}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{row.peopleCount}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{row.payrollCount}</td>
                  <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{row.exampleEmployeeNumbers.join("; ")}</td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.suggestedBlock)}</td>
                  <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{displayText(row.suggestedRegistroCode)}</td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{displayText(row.recommendedAction ?? row.action)}</td>
                  <td className={cn("max-w-[320px] border-b border-line/70", cellPadding(density))}>{displayText(row.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!unmapped.length ? <p className="p-6 text-sm text-muted">No hay conceptos no incluidos.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function AgrupacionesTable() {
  return <AgrupacionesView />;
}

function viewTitle(mode: Extract<AppView, "personas" | "conceptos" | "agrupaciones">): string {
  if (mode === "personas") return "Personas";
  if (mode === "conceptos") return "Conceptos";
  return "Agrupaciones";
}

function viewSubtitle(mode: Extract<AppView, "personas" | "conceptos" | "agrupaciones">): string {
  if (mode === "personas") {
    return "Compara por matrícula los importes del Reg. Retrib. frente a los importes detectados en recibos, separados por Salario, Complemento Salarial y Extrasalarial.";
  }
  if (mode === "conceptos") {
    return "Revisa el detalle concepto a concepto para localizar qué partidas cuadran, cuáles generan diferencias y cuáles requieren revisión.";
  }
  return "Consulta las hojas agrupadas incluidas en el Excel Reg. Retrib.";
}

export function TablesView({ mode }: Readonly<{ mode: Extract<AppView, "personas" | "conceptos" | "agrupaciones"> }>) {
  const { result, filters, setFilters } = useAppState();
  const density: TableDensity = "compact";
  const [modal, setModal] = useState<DetailModalState | undefined>();
  const people = result?.people ?? [];
  const centers = unique(people.map((item) => item.workplace));
  const groups = unique(people.flatMap((item) => [item.position, item.category]));

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader title={viewTitle(mode)} subtitle={viewSubtitle(mode)} />
        <EmptyState icon={Table2} title="No hay análisis activo" description="Carga el Registro Retributivo y los recibos para generar una comparativa antes de revisar esta sección." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title={viewTitle(mode)} subtitle={viewSubtitle(mode)} />
      {mode !== "agrupaciones" ? (
        <FiltersPanel filters={filters} centers={centers} groups={groups} onChange={setFilters} />
      ) : null}
      {mode === "personas" ? (
        <PersonasTable density={density} onOpen={setModal} />
      ) : mode === "conceptos" ? (
        <ConceptosTable density={density} onOpen={setModal} />
      ) : (
        <AgrupacionesTable />
      )}
      {modal ? (
        <DetailModal
          state={modal}
          tolerance={result.summary?.tolerance ?? 1}
          concepts={result.concepts}
          unmappedConcepts={result.unmappedConcepts}
          onClose={() => setModal(undefined)}
        />
      ) : null}
    </div>
  );
}
