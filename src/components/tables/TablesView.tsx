"use client";

import { Copy, Search, Table2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useAppState, type DashboardFilters, EMPTY_FILTERS, matchesQuery } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import type { AppView, ConceptComparisonRow, PersonComparisonRow, UnmappedConceptRow } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";
import { describeConceptCause, describePersonCause, type ProbableCause } from "@/lib/ui/probableCause";
import { cn } from "@/lib/utils/classNames";

interface TableHeader {
  readonly key: string;
  readonly label: string;
}

type TableDensity = "comfortable" | "compact";
type DetailModalState =
  | { readonly kind: "person"; readonly row: PersonComparisonRow }
  | { readonly kind: "concept"; readonly row: ConceptComparisonRow }
  | { readonly kind: "unmapped"; readonly row: UnmappedConceptRow };

const PERSONAS_HEADERS: readonly TableHeader[] = [
  { key: "employeeNumber", label: "MatrÃ­cula" },
  { key: "person", label: "Persona" },
  { key: "cause", label: "Causa" },
  { key: "workplace", label: "Centro" },
  { key: "position", label: "Puesto" },
  { key: "category", label: "CategorÃ­a" },
  { key: "salaryRegistro", label: "Salario Registro" },
  { key: "salaryPdf", label: "Salario PDF" },
  { key: "salaryDiff", label: "Dif." },
  { key: "salaryComplementRegistro", label: "C. Salarial Registro" },
  { key: "salaryComplementPdf", label: "C. Salarial PDF" },
  { key: "salaryComplementDiff", label: "Dif." },
  { key: "extraSalaryRegistro", label: "Extrasalarial Registro" },
  { key: "extraSalaryPdf", label: "Extrasalarial PDF" },
  { key: "extraSalaryDiff", label: "Dif." },
  { key: "registroTotal", label: "Total Registro" },
  { key: "pdfTotal", label: "Total PDF" },
  { key: "totalDiff", label: "Dif. Total" },
  { key: "status", label: "Estado" },
  { key: "detail", label: "Detalle" },
];

const CONCEPTOS_HEADERS: readonly TableHeader[] = [
  { key: "employeeNumber", label: "MatrÃ­cula" },
  { key: "person", label: "Persona" },
  { key: "cause", label: "Causa" },
  { key: "block", label: "Bloque" },
  { key: "registroCode", label: "CÃ³digo Registro" },
  { key: "pdfConcept", label: "Concepto PDF" },
  { key: "registroAmount", label: "Registro" },
  { key: "pdfAmount", label: "PDF" },
  { key: "difference", label: "Diferencia" },
  { key: "status", label: "Estado" },
  { key: "detail", label: "Detalle" },
];

const CONCEPTOS_NO_INCLUIDOS_HEADERS: readonly TableHeader[] = [
  { key: "decisionType", label: "Tipo decisiÃ³n" },
  { key: "includedInComparison", label: "Incluido en cÃ¡lculo" },
  { key: "pdfConcept", label: "Concepto PDF" },
  { key: "totalDetected", label: "Total detectado" },
  { key: "peopleCount", label: "Personas" },
  { key: "payrollCount", label: "NÃ³minas" },
  { key: "exampleEmployeeNumbers", label: "Ejemplos matrÃ­culas" },
  { key: "suggestedBlock", label: "Sugerencia bloque" },
  { key: "suggestedRegistroCode", label: "Sugerencia cÃ³digo Registro" },
  { key: "recommendedAction", label: "AcciÃ³n recomendada" },
  { key: "reason", label: "Motivo" },
];

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

function rowTone(status?: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50/45 hover:bg-emerald-50";
    case "Revisar":
    case "Sin mapear":
      return "bg-orange-50/45 hover:bg-orange-50";
    case "Diferencia":
      return "bg-red-50/35 hover:bg-red-50/75";
    case "Sin Registro":
      return "bg-violet-50/45 hover:bg-violet-50";
    case "Sin PDF":
      return "bg-slate-50 hover:bg-slate-100";
    default:
      return "odd:bg-white even:bg-slate-50/70 hover:bg-blue-50/70";
  }
}

function diffClass(value: number): string {
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-blue-700";
  return "text-slate-700";
}

function cellPadding(density: TableDensity): string {
  return density === "compact" ? "px-3 py-2" : "px-4 py-4";
}

function stickyLeft(index: 0 | 1, density: TableDensity): string {
  const width = index === 0 ? "left-0 min-w-[120px]" : "left-[120px] min-w-[220px]";
  return cn("sticky z-10 bg-inherit", width, cellPadding(density));
}

function FiltersPanel({
  filters,
  centers,
  groups,
  density,
  onDensityChange,
  onChange,
}: Readonly<{
  filters: DashboardFilters;
  centers: readonly string[];
  groups: readonly string[];
  density: TableDensity;
  onDensityChange: (density: TableDensity) => void;
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
              placeholder="Matricula, persona o concepto"
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
                {item}
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
          Ver PDF sin Registro
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4" onClick={() => quick("OK")}>
          Ver OK
        </button>
        <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => onChange(EMPTY_FILTERS)}>
          Limpiar filtros
        </button>
        <div className="ml-auto flex rounded-full bg-slate-100 p-1">
          {(["comfortable", "compact"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onDensityChange(item)}
              className={cn("min-h-9 rounded-full px-3 text-xs font-semibold transition", density === item ? "bg-white text-ink shadow-subtle" : "text-muted")}
            >
              {item === "comfortable" ? "Comoda" : "Compacta"}
            </button>
          ))}
        </div>
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

function DetailButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-ink transition hover:bg-blue-50"
    >
      Detalle
    </button>
  );
}

function CauseBadge({ cause }: Readonly<{ cause: ProbableCause }>) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{cause.label}</span>;
}

function ModalField({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{value ?? "Sin dato"}</p>
    </div>
  );
}

function MoneyTriplet({ label, registro, pdf, diff }: Readonly<{ label: string; registro: number; pdf: number; diff: number }>) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <ModalField label="Registro" value={formatEuro(registro)} />
        <ModalField label="PDF" value={formatEuro(pdf)} />
        <ModalField label="Dif." value={formatEuro(diff)} />
      </div>
    </div>
  );
}

function DetailModal({ state, tolerance, onClose }: Readonly<{ state: DetailModalState; tolerance: number; onClose: () => void }>) {
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
            description: state.row.reason ?? "Concepto no incluido en el calculo principal.",
            review: state.row.recommendedAction ?? "Revisar criterio de decision.",
          };
  const copySummary = `${title}: ${cause.label} - ${cause.description}`;

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
            <p className="text-xs font-semibold uppercase text-muted">Retributivo</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {state.kind === "person" ? (
            <>
              <ModalField label="Matricula" value={state.row.employeeNumber} />
              <ModalField label="Persona" value={state.row.person} />
              <ModalField label="Centro" value={state.row.workplace} />
              <ModalField label="Puesto" value={state.row.position} />
              <ModalField label="Categoria" value={state.row.category} />
              <ModalField label="Estado" value={state.row.status} />
              <ModalField label="Nominas" value={state.row.payrollCount} />
              <ModalField label="Periodos" value={state.row.periods.join("; ")} />
            </>
          ) : state.kind === "concept" ? (
            <>
              <ModalField label="Matricula" value={state.row.employeeNumber} />
              <ModalField label="Persona" value={state.row.person} />
              <ModalField label="Bloque" value={state.row.block} />
              <ModalField label="Codigo Registro" value={state.row.registroCode} />
              <ModalField label="Concepto PDF" value={state.row.pdfConcept} />
              <ModalField label="Estado" value={state.row.status} />
              <ModalField label="Regla usada" value={state.row.detail} />
            </>
          ) : (
            <>
              <ModalField label="Concepto PDF" value={state.row.pdfConcept} />
              <ModalField label="Total detectado" value={formatEuro(state.row.totalDetected)} />
              <ModalField label="Personas" value={state.row.peopleCount} />
              <ModalField label="Nominas" value={state.row.payrollCount} />
              <ModalField label="Ejemplos matriculas" value={state.row.exampleEmployeeNumbers.join("; ")} />
              <ModalField label="Tipo decision" value={state.row.decisionType} />
              <ModalField label="Sugerencia bloque" value={state.row.suggestedBlock} />
              <ModalField label="Sugerencia codigo Registro" value={state.row.suggestedRegistroCode} />
            </>
          )}
        </div>

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

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-950">Causa probable: {cause.label}</p>
            <p className="mt-2 text-sm leading-6 text-blue-900">{cause.description}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">Que revisar</p>
            <p className="mt-2 text-sm leading-6 text-muted">{cause.review}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(copySummary)}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copiar resumen
          </button>
          <button type="button" className="btn-ghost" disabled>
            Analizar con IA - Fase 2
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
      <TableSummary visible={rows.length} total={allRows.length} difference={totalDifference} extra={`PDF sin Registro visible: ${formatEuro(pdfWithoutRegistro)}`} />
      <Card className="overflow-hidden p-0">
        <div className="max-h-[70dvh] overflow-auto">
          <table className="w-full min-w-[1780px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {PERSONAS_HEADERS.map((header, index) => (
                  <th
                    key={header.key}
                    className={cn("border-b border-line px-4 py-3 text-xs font-semibold uppercase", index === 0 && "sticky left-0 z-30 bg-slate-100", index === 1 && "sticky left-[120px] z-30 bg-slate-100")}
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
                    <td className={cn(stickyLeft(0, density), "border-b border-line/70 font-mono")}>{row.employeeNumber}</td>
                    <td className={cn(stickyLeft(1, density), "border-b border-line/70 font-semibold")}>{row.person}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><CauseBadge cause={cause} /></td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{row.workplace}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{row.position}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{row.category}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.salaryRegistro)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.salaryPdf)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.salaryDifference))}>{formatEuro(row.salaryDifference)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.salaryComplementRegistro)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.salaryComplementPdf)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.salaryComplementDifference))}>{formatEuro(row.salaryComplementDifference)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.extraSalaryRegistro)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.extraSalaryPdf)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.extraSalaryDifference))}>{formatEuro(row.extraSalaryDifference)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.registroTotal)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.pdfTotal)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.totalDifference))}>{formatEuro(row.totalDifference)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><Badge value={row.status} /></td>
                    <td className={cn("sticky right-0 z-10 border-b border-line/70 bg-inherit", cellPadding(density))}><DetailButton onOpen={() => onOpen({ kind: "person", row })} /></td>
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
                  <th key={header.key} className={cn("border-b border-line px-4 py-3 text-xs font-semibold uppercase", index === 0 && "sticky left-0 z-30 bg-slate-100", index === 1 && "sticky left-[120px] z-30 bg-slate-100")}>
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
                    <td className={cn(stickyLeft(0, density), "border-b border-line/70 font-mono")}>{row.employeeNumber}</td>
                    <td className={cn(stickyLeft(1, density), "border-b border-line/70 font-semibold")}>{row.person}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><CauseBadge cause={cause} /></td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}>{row.block}</td>
                    <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{row.registroCode}</td>
                    <td className={cn("max-w-[260px] truncate border-b border-line/70", cellPadding(density))}>{row.pdfConcept}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.registroAmount)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.pdfAmount)}</td>
                    <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density), diffClass(row.difference))}>{formatEuro(row.difference)}</td>
                    <td className={cn("border-b border-line/70", cellPadding(density))}><Badge value={row.status} /></td>
                    <td className={cn("sticky right-0 z-10 border-b border-line/70 bg-inherit", cellPadding(density))}><DetailButton onOpen={() => onOpen({ kind: "concept", row })} /></td>
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
                <tr key={row.pdfConcept} tabIndex={0} onClick={() => onOpen({ kind: "unmapped", row })} className="cursor-pointer odd:bg-white even:bg-slate-50 hover:bg-blue-50/70">
                  <td className={cn("sticky left-0 z-10 border-b border-line/70 bg-inherit", cellPadding(density))}><Badge value={row.decisionType ?? (row.action === "Ignorado" ? "Ignorado" : "Sin mapear real")} /></td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{row.includedInComparison ? "Si" : "No"}</td>
                  <td className={cn("border-b border-line/70 font-semibold", cellPadding(density))}>{row.pdfConcept}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{formatEuro(row.totalDetected)}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{row.peopleCount}</td>
                  <td className={cn("border-b border-line/70 text-right font-mono", cellPadding(density))}>{row.payrollCount}</td>
                  <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{row.exampleEmployeeNumbers.join("; ")}</td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{row.suggestedBlock}</td>
                  <td className={cn("border-b border-line/70 font-mono", cellPadding(density))}>{row.suggestedRegistroCode}</td>
                  <td className={cn("border-b border-line/70", cellPadding(density))}>{row.recommendedAction ?? row.action}</td>
                  <td className={cn("sticky right-0 z-10 border-b border-line/70 bg-inherit", cellPadding(density))}><DetailButton onOpen={() => onOpen({ kind: "unmapped", row })} /></td>
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
  const { result } = useAppState();
  const rows = result?.groupings ?? [];
  return (
    <EmptyState
      icon={Table2}
      title={rows.length ? "Agrupaciones calculadas" : "Pendiente de implementaciÃ³n"}
      description="La primera fase prioriza Registro vs PDF, conceptos y normalizado vs real. Las agrupaciones se implementan despues sin bloquear la validacion de importes."
    />
  );
}

function loadDensity(): TableDensity {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem("retributivo-table-density") === "compact" ? "compact" : "comfortable";
}

export function TablesView({ mode }: Readonly<{ mode: Extract<AppView, "personas" | "conceptos" | "agrupaciones"> }>) {
  const { result, filters, setFilters } = useAppState();
  const [density, setDensity] = useState<TableDensity>(() => loadDensity());
  const [modal, setModal] = useState<DetailModalState | undefined>();
  const people = result?.people ?? [];
  const centers = unique(people.map((item) => item.workplace));
  const groups = unique(people.flatMap((item) => [item.position, item.category]));

  const updateDensity = (next: TableDensity) => {
    setDensity(next);
    window.localStorage.setItem("retributivo-table-density", next);
  };

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Revision retributiva" subtitle="Completa un analisis para revisar diferencias por matricula." />
        <EmptyState icon={Table2} title="No hay analisis activo" description="Sube el Registro y los PDF para generar la comparativa." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={mode === "personas" ? "Personas" : mode === "conceptos" ? "Conceptos" : "Agrupaciones"}
        subtitle="Tabla funcional con scroll horizontal, columnas sticky y detalle al clicar cualquier fila."
      />
      {mode !== "agrupaciones" ? (
        <FiltersPanel filters={filters} centers={centers} groups={groups} density={density} onDensityChange={updateDensity} onChange={setFilters} />
      ) : null}
      {mode === "personas" ? (
        <PersonasTable density={density} onOpen={setModal} />
      ) : mode === "conceptos" ? (
        <ConceptosTable density={density} onOpen={setModal} />
      ) : (
        <AgrupacionesTable />
      )}
      {modal ? <DetailModal state={modal} tolerance={result.summary?.tolerance ?? 1} onClose={() => setModal(undefined)} /> : null}
    </div>
  );
}
