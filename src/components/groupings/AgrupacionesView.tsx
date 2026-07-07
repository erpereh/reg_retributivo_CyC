"use client";

import { CheckCircle2, FileCheck2, Table2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import type { GroupingComparisonRow } from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

type GroupingViewMode = "excel" | "pdf";

interface GroupingFilters {
  readonly sheet: string;
  readonly base: string;
  readonly group: string;
  readonly block: string;
  readonly metric: string;
  readonly excelStatus: string;
  readonly pdfStatus: string;
}

const PERIOD_COMPLETE_BASE = "RETRIBUCIONES (PERIODO COMPLETO)";

const EMPTY_GROUPING_FILTERS: GroupingFilters = {
  sheet: "",
  base: "",
  group: "",
  block: "",
  metric: "",
  excelStatus: "",
  pdfStatus: "",
};

const EXCEL_HEADERS = [
  "Hoja",
  "Base Registro",
  "Agrupación",
  "Bloque",
  "Métrica",
  "Segmento",
  "Hoja agrupada",
  "Recalculado Empleados",
  "Dif. Excel",
  "Nº personas",
  "Mujeres",
  "Varones",
  "Estado Excel",
] as const;

const PDF_HEADERS = [
  "Hoja",
  "Base Registro",
  "Agrupación",
  "Bloque",
  "Métrica",
  "Segmento",
  "Registro periodo completo matched",
  "PDF recalculado",
  "Dif. PDF",
  "Nº matched",
  "Mujeres matched",
  "Varones matched",
  "Estado PDF",
] as const;

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

function statusTone(status?: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50 hover:bg-emerald-100";
    case "Revisar":
      return "bg-orange-50 hover:bg-orange-100";
    case "Diferencia":
      return "bg-red-50 hover:bg-red-100";
    case "Sin datos":
    case "No aplica":
      return "bg-slate-50 hover:bg-slate-100";
    default:
      return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
  }
}

function zeroNormalized(value: number, threshold: number): number {
  return Math.abs(value) < threshold ? 0 : value;
}

function displayNumber(row: GroupingComparisonRow, value: number): number {
  return zeroNormalized(value, row.segment.includes("%") ? 0.00005 : 0.005);
}

function diffClass(row: GroupingComparisonRow, value?: number): string {
  if (value === undefined) return "text-slate-700";
  const normalized = displayNumber(row, value);
  if (normalized === 0) return "text-slate-700";
  return normalized > 0 ? "text-red-700" : "text-blue-700";
}

function isPercentage(row: GroupingComparisonRow): boolean {
  return row.segment.includes("%");
}

function formatGroupingValue(row: GroupingComparisonRow, value?: number, kind: "value" | "difference" = "value"): string {
  if (value === undefined || Number.isNaN(value)) {
    return "Sin dato";
  }
  const normalized = displayNumber(row, value);
  if (isPercentage(row)) {
    const suffix = kind === "difference" ? " pp" : "%";
    return `${(normalized * 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
  }
  return formatEuro(normalized);
}

function formatPdfValue(row: GroupingComparisonRow, value?: number, kind: "value" | "difference" = "value"): string {
  if (row.pdfStatus === "No aplica") {
    return "No aplica";
  }
  return formatGroupingValue(row, value, kind);
}

function distinctGroupCount(rows: readonly GroupingComparisonRow[]): number {
  return new Set(rows.map((row) => `${row.sourceSheet}|${row.groupId}`)).size;
}

function isPdfDifference(row: GroupingComparisonRow): boolean {
  return row.pdfStatus === "Revisar" || row.pdfStatus === "Diferencia";
}

function isMonetaryPdfMetric(row: GroupingComparisonRow): boolean {
  const metric = row.metric.toLowerCase();
  const segment = row.segment.toLowerCase();
  if (!(metric.includes("media") || metric.includes("mediana"))) {
    return false;
  }
  if (segment.includes("%") || segment.includes("porcentaje") || segment.includes("diferencia")) {
    return false;
  }
  return ["mujeres", "varones", "media total", "mediana total", "total"].includes(segment);
}

function metricType(row: GroupingComparisonRow): string {
  if (row.segment.includes("%")) {
    return "Porcentaje";
  }
  if (row.metric.toLowerCase().includes("mediana")) {
    return "Mediana monetaria";
  }
  if (row.metric.toLowerCase().includes("media")) {
    return "Media monetaria";
  }
  return "Métrica agrupada";
}

function ModalField({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{displayText(value) || "Sin dato"}</p>
    </div>
  );
}

function deterministicExplanation(row: GroupingComparisonRow): string {
  if (row.status !== "OK") {
    return "Revisar la hoja agrupada del Excel frente al cálculo desde Empleados.";
  }
  if (isPdfDifference(row)) {
    return "La hoja agrupada cuadra internamente con Empleados, pero el PDF agrupado muestra diferencias frente al Registro periodo completo. Esta diferencia corresponde a la métrica agrupada seleccionada.";
  }
  if (row.pdfStatus === "OK") {
    return "La agrupación cuadra tanto internamente como contra PDF agrupado. Esta diferencia corresponde a la métrica agrupada seleccionada.";
  }
  return "La validación Excel cuadra; la comparación PDF no aplica para esta base Registro.";
}

function DetailModal({ row, onClose }: Readonly<{ row: GroupingComparisonRow; onClose: () => void }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle agrupación"
        className="max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-lift sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted">Detalle determinista</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink text-balance">Detalle agrupación</h2>
          </div>
          <button type="button" aria-label="Cerrar detalle" onClick={onClose} className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <ModalField label="Hoja validada" value={row.sourceSheet} />
          <ModalField label="Base Registro" value={row.registroBase} />
          <ModalField label="Agrupación comparada" value={row.groupName} />
          <ModalField label="ID agrupación" value={row.groupId} />
          <ModalField label="Bloque" value={row.block} />
          <ModalField label="Métrica" value={`${row.metric} · ${row.segment}`} />
          <ModalField label="Tipo de fila" value={metricType(row)} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-emerald-950">Validación Excel</h3>
              <Badge value={row.status} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ModalField label="Población Excel" value={`${row.peopleCount} personas (${row.womenCount} mujeres, ${row.menCount} varones)`} />
              <ModalField label="Base usada" value={row.registroBase} />
              <ModalField label="Valor hoja agrupada" value={formatGroupingValue(row, row.registroSheetValue)} />
              <ModalField label="Recalculado Empleados" value={formatGroupingValue(row, row.registroRecalculatedValue)} />
              <ModalField label="Diferencia Excel" value={formatGroupingValue(row, row.excelDifference, "difference")} />
              <ModalField label="Estado Excel" value={row.status} />
            </div>
          </section>

          <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-blue-950">Comparación PDF</h3>
              <Badge value={row.pdfStatus ?? "Sin datos"} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ModalField label="Base PDF" value={row.pdfStatus === "No aplica" ? "No aplica" : PERIOD_COMPLETE_BASE} />
              <ModalField label="Población matched PDF" value={`${row.matchedPeopleCount ?? 0} personas (${row.matchedWomenCount ?? 0} mujeres, ${row.matchedMenCount ?? 0} varones)`} />
              <ModalField label="PDF sin Registro excluidos" value={row.excludedPdfWithoutRegistroCount ?? 0} />
              <ModalField label="Registro periodo completo matched" value={formatPdfValue(row, row.pdfRegistroRecalculatedValue)} />
              <ModalField label="PDF recalculado" value={formatPdfValue(row, row.pdfRecalculatedValue)} />
              <ModalField label="Diferencia PDF" value={formatPdfValue(row, row.pdfDifference, "difference")} />
              <ModalField label="Interpretación" value="Esta diferencia corresponde a la métrica agrupada seleccionada." />
            </div>
          </section>
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-ink">Qué revisar</p>
          <p className="mt-2 text-sm leading-6 text-muted">{deterministicExplanation(row)}</p>
        </div>
      </div>
    </div>
  );
}

function filterRows(rows: readonly GroupingComparisonRow[], filters: GroupingFilters, mode: GroupingViewMode): GroupingComparisonRow[] {
  return rows.filter((row) => {
    if (mode === "pdf" && row.registroBase !== PERIOD_COMPLETE_BASE) return false;
    if (filters.sheet && row.sourceSheet !== filters.sheet) return false;
    if (mode === "excel" && filters.base && row.registroBase !== filters.base) return false;
    if (filters.group && row.groupName !== filters.group) return false;
    if (filters.block && row.block !== filters.block) return false;
    if (filters.metric && row.metric !== filters.metric) return false;
    if (mode === "excel" && filters.excelStatus && row.status !== filters.excelStatus) return false;
    if (mode === "pdf" && filters.pdfStatus && row.pdfStatus !== filters.pdfStatus) return false;
    return true;
  });
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{ label: string; value: string; options: readonly string[]; onChange: (value: string) => void }>) {
  return (
    <label className="text-sm font-semibold text-ink">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="filter-control mt-2">
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AgrupacionesView() {
  const { result } = useAppState();
  const rows = result?.groupings ?? [];
  const [mode, setMode] = useState<GroupingViewMode>("excel");
  const [filters, setFilters] = useState<GroupingFilters>(EMPTY_GROUPING_FILTERS);
  const [selectedRow, setSelectedRow] = useState<GroupingComparisonRow | undefined>();

  const filteredRows = useMemo(() => filterRows(rows, filters, mode), [filters, mode, rows]);
  const summary = useMemo(() => {
    const excelDifferenceRows = rows.filter((row) => row.status !== "OK").length;
    const pdfDifferenceRows = rows.filter(isPdfDifference).length;
    const monetaryPdfDifferences = rows
      .filter((row) => isMonetaryPdfMetric(row) && row.pdfDifference !== undefined)
      .map((row) => Math.abs(row.pdfDifference ?? 0));
    const pdfAffectedGroups = new Set(rows.filter(isPdfDifference).map((row) => `${row.sourceSheet}|${row.groupId}`));
    return {
      sheets: unique(rows.map((row) => row.sourceSheet)).length,
      groups: distinctGroupCount(rows),
      excelOk: rows.length - excelDifferenceRows,
      excelDifferenceRows,
      pdfDifferenceRows,
      pdfExcluded: Math.max(0, ...rows.map((row) => row.excludedPdfWithoutRegistroCount ?? 0)),
      maxPdfDifference: monetaryPdfDifferences.length ? Math.max(...monetaryPdfDifferences) : 0,
      pdfAffectedGroups: pdfAffectedGroups.size,
    };
  }, [rows]);

  const options = useMemo(
    () => ({
      sheets: unique(rows.map((row) => row.sourceSheet)),
      bases: unique(rows.map((row) => row.registroBase)),
      groups: unique(rows.map((row) => row.groupName)),
      blocks: unique(rows.map((row) => row.block)),
      metrics: unique(rows.map((row) => row.metric)),
      excelStatuses: unique(rows.map((row) => row.status)),
      pdfStatuses: unique(rows.map((row) => row.pdfStatus)),
    }),
    [rows],
  );

  if (!rows.length) {
    return (
      <EmptyState
        icon={Table2}
        title="Pendiente de implementación / Sin datos calculados"
        description="Esta fase valida que las hojas agrupadas del Registro cuadran con la hoja Empleados y añade la comparación PDF agrupado cuando hay datos matched."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <FileCheck2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink">Validación Excel</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Compara cada hoja agrupada del Registro contra los datos recalculados desde Empleados para todas las bases Registro.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary">
              <Table2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink">Comparación PDF</h2>
              <p className="mt-1 text-sm leading-6 text-muted">La comparación PDF agrupado usa solo personas matched y excluye matrículas PDF sin Registro.</p>
            </div>
          </div>
        </Card>
      </section>

      {summary.excelDifferenceRows === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-subtle">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          Las hojas agrupadas cuadran con Empleados.
        </div>
      ) : null}

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 shadow-subtle">
        La comparación PDF agrupado usa solo personas matched y excluye matrículas PDF sin Registro. Se excluyen {summary.pdfExcluded} matrículas presentes en PDF pero no en Registro porque no tienen datos maestros de agrupación.
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {[
          ["Hojas analizadas", summary.sheets],
          ["Agrupaciones calculadas", summary.groups],
          ["Filas Excel OK", summary.excelOk],
          ["Filas Excel con diferencia", summary.excelDifferenceRows],
          ["Filas PDF con diferencia", summary.pdfDifferenceRows],
          ["PDF sin Registro excluidos", summary.pdfExcluded],
          ["Mayor diferencia PDF", formatEuro(zeroNormalized(summary.maxPdfDifference, 0.005))],
          ["Agrupaciones PDF afectadas", summary.pdfAffectedGroups],
        ].map(([label, value]) => (
          <Card key={label} className="min-h-[104px] p-4">
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-3 text-xl font-semibold text-ink tabular-nums">{value}</p>
          </Card>
        ))}
      </section>

      <Card className="p-5">
        <div className="mb-5 flex flex-wrap gap-2">
          {[
            ["excel", "Validación Excel"],
            ["pdf", "Comparación PDF"],
          ].map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => setMode(nextMode as GroupingViewMode)}
              className={cn("rounded-full px-4 py-2 text-sm font-semibold transition", mode === nextMode ? "bg-primary text-white shadow-subtle" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "pdf" ? (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
            Las diferencias PDF se muestran por métrica agrupada. Las medias y medianas no son importes aditivos, por lo que no deben interpretarse como diferencia salarial total.
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <FilterSelect label="Hoja" value={filters.sheet} options={options.sheets} onChange={(sheet) => setFilters((current) => ({ ...current, sheet }))} />
          {mode === "excel" ? (
            <FilterSelect label="Base Registro" value={filters.base} options={options.bases} onChange={(base) => setFilters((current) => ({ ...current, base }))} />
          ) : (
            <label className="text-sm font-semibold text-ink">
              Base Registro
              <input value={PERIOD_COMPLETE_BASE} readOnly className="filter-control mt-2 bg-slate-100" />
            </label>
          )}
          <FilterSelect label="Agrupación" value={filters.group} options={options.groups} onChange={(group) => setFilters((current) => ({ ...current, group }))} />
          <FilterSelect label="Bloque" value={filters.block} options={options.blocks} onChange={(block) => setFilters((current) => ({ ...current, block }))} />
          <FilterSelect label="Métrica" value={filters.metric} options={options.metrics} onChange={(metric) => setFilters((current) => ({ ...current, metric }))} />
          {mode === "excel" ? (
            <FilterSelect label="Estado Excel" value={filters.excelStatus} options={options.excelStatuses} onChange={(excelStatus) => setFilters((current) => ({ ...current, excelStatus }))} />
          ) : (
            <FilterSelect label="Estado PDF" value={filters.pdfStatus} options={options.pdfStatuses.filter((status) => status !== "No aplica")} onChange={(pdfStatus) => setFilters((current) => ({ ...current, pdfStatus }))} />
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => setFilters(EMPTY_GROUPING_FILTERS)}>
            Limpiar filtros
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">{mode === "excel" ? "Detalle Validación Excel" : "Detalle Comparación PDF"}</h2>
          <p className="mt-1 text-sm text-muted">
            {filteredRows.length} filas visibles de {mode === "pdf" ? rows.filter((row) => row.registroBase === PERIOD_COMPLETE_BASE).length : rows.length}
          </p>
        </div>
        <div className="max-h-[70dvh] overflow-auto">
          <table className="w-full min-w-[1720px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {(mode === "excel" ? EXCEL_HEADERS : PDF_HEADERS).map((header, index) => (
                  <th
                    key={header}
                    className={cn(
                      "border-b border-line px-4 py-3 text-xs font-semibold uppercase",
                      index === 0 && "sticky left-0 z-30 min-w-[220px] bg-slate-100 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]",
                    )}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr
                  key={`${mode}-${row.sourceSheet}-${row.registroBase}-${row.groupId}-${row.block}-${row.metric}-${row.segment}-${index}`}
                  tabIndex={0}
                  onClick={() => setSelectedRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelectedRow(row);
                  }}
                  className={cn("cursor-pointer transition", statusTone(mode === "excel" ? row.status : row.pdfStatus))}
                >
                  <td className="sticky left-0 z-10 min-w-[220px] border-b border-line/70 bg-inherit px-4 py-3 font-semibold shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]">
                    {displayText(row.sourceSheet)}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.registroBase)}</td>
                  <td className="border-b border-line/70 px-4 py-3 font-semibold">{displayText(row.groupName)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.block)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.metric)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.segment)}</td>
                  {mode === "excel" ? (
                    <>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatGroupingValue(row, row.registroSheetValue)}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatGroupingValue(row, row.registroRecalculatedValue)}</td>
                      <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row, row.excelDifference))}>
                        {formatGroupingValue(row, row.excelDifference, "difference")}
                      </td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.peopleCount}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.womenCount}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.menCount}</td>
                      <td className="border-b border-line/70 px-4 py-3">
                        <Badge value={row.status} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatPdfValue(row, row.pdfRegistroRecalculatedValue)}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatPdfValue(row, row.pdfRecalculatedValue)}</td>
                      <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row, row.pdfDifference))}>
                        {formatPdfValue(row, row.pdfDifference, "difference")}
                      </td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.matchedPeopleCount ?? 0}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.matchedWomenCount ?? 0}</td>
                      <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.matchedMenCount ?? 0}</td>
                      <td className="border-b border-line/70 px-4 py-3">
                        <Badge value={row.pdfStatus ?? "Sin datos"} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredRows.length ? <p className="p-6 text-sm text-muted">Sin agrupaciones con los filtros actuales.</p> : null}
        </div>
      </Card>

      {selectedRow ? <DetailModal row={selectedRow} onClose={() => setSelectedRow(undefined)} /> : null}
    </div>
  );
}
