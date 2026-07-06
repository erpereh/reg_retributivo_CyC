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

interface GroupingFilters {
  readonly sheet: string;
  readonly base: string;
  readonly group: string;
  readonly block: string;
  readonly metric: string;
  readonly status: string;
}

const EMPTY_GROUPING_FILTERS: GroupingFilters = {
  sheet: "",
  base: "",
  group: "",
  block: "",
  metric: "",
  status: "",
};

const HEADERS = [
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
  "Estado",
] as const;

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

function rowTone(status?: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50 hover:bg-emerald-100";
    case "Revisar":
      return "bg-orange-50 hover:bg-orange-100";
    case "Diferencia":
      return "bg-red-50 hover:bg-red-100";
    case "Sin datos":
      return "bg-slate-50 hover:bg-slate-100";
    default:
      return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
  }
}

function diffClass(value?: number): string {
  if (!value) return "text-slate-700";
  if (value > 0) return "text-red-700";
  return "text-blue-700";
}

function isPercentage(row: GroupingComparisonRow): boolean {
  return row.segment.includes("%");
}

function formatGroupingValue(row: GroupingComparisonRow, value?: number, kind: "value" | "difference" = "value"): string {
  if (value === undefined || Number.isNaN(value)) {
    return "Sin dato";
  }
  if (isPercentage(row)) {
    const suffix = kind === "difference" ? " pp" : "%";
    return `${(value * 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
  }
  return formatEuro(value);
}

function distinctGroupCount(rows: readonly GroupingComparisonRow[]): number {
  return new Set(rows.map((row) => `${row.sourceSheet}|${row.groupId}`)).size;
}

function ModalField({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{displayText(value) || "Sin dato"}</p>
    </div>
  );
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
        className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-lift sm:p-6"
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
          <ModalField label="Valor en hoja agrupada" value={formatGroupingValue(row, row.registroSheetValue)} />
          <ModalField label="Valor recalculado desde Empleados" value={formatGroupingValue(row, row.registroRecalculatedValue)} />
          <ModalField label="Diferencia" value={formatGroupingValue(row, row.excelDifference, "difference")} />
          <ModalField label="Personas incluidas" value={row.peopleCount} />
          <ModalField label="Mujeres" value={row.womenCount} />
          <ModalField label="Varones" value={row.menCount} />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-950">Explicación</p>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              Se valida la hoja {row.sourceSheet}, base {row.registroBase}, agrupación {row.groupName}, métrica {row.metric} / {row.segment}.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">Qué revisar</p>
            <p className="mt-2 text-sm leading-6 text-muted">{row.status === "OK" ? "No requiere revisión: la hoja agrupada cuadra con Empleados." : row.detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function filterRows(rows: readonly GroupingComparisonRow[], filters: GroupingFilters): GroupingComparisonRow[] {
  return rows.filter((row) => {
    if (filters.sheet && row.sourceSheet !== filters.sheet) return false;
    if (filters.base && row.registroBase !== filters.base) return false;
    if (filters.group && row.groupName !== filters.group) return false;
    if (filters.block && row.block !== filters.block) return false;
    if (filters.metric && row.metric !== filters.metric) return false;
    if (filters.status && row.status !== filters.status) return false;
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
  const [filters, setFilters] = useState<GroupingFilters>(EMPTY_GROUPING_FILTERS);
  const [selectedRow, setSelectedRow] = useState<GroupingComparisonRow | undefined>();

  const filteredRows = useMemo(() => filterRows(rows, filters), [filters, rows]);
  const summary = useMemo(() => {
    const differenceRows = rows.filter((row) => row.status !== "OK").length;
    const salary = rows.filter((row) => row.block === "Salario").reduce((sum, row) => sum + (row.excelDifference ?? 0), 0);
    const salaryComplement = rows.filter((row) => row.block === "C. Salarial").reduce((sum, row) => sum + (row.excelDifference ?? 0), 0);
    const extraSalary = rows.filter((row) => row.block === "Extrasalarial").reduce((sum, row) => sum + (row.excelDifference ?? 0), 0);
    return {
      sheets: unique(rows.map((row) => row.sourceSheet)).length,
      groups: distinctGroupCount(rows),
      ok: rows.length - differenceRows,
      differenceRows,
      salary,
      salaryComplement,
      extraSalary,
    };
  }, [rows]);

  const options = useMemo(
    () => ({
      sheets: unique(rows.map((row) => row.sourceSheet)),
      bases: unique(rows.map((row) => row.registroBase)),
      groups: unique(rows.map((row) => row.groupName)),
      blocks: unique(rows.map((row) => row.block)),
      metrics: unique(rows.map((row) => row.metric)),
      statuses: unique(rows.map((row) => row.status)),
    }),
    [rows],
  );

  if (!rows.length) {
    return (
      <EmptyState
        icon={Table2}
        title="Pendiente de implementación / Sin datos calculados"
        description="Esta fase valida que las hojas agrupadas del Registro cuadran con la hoja Empleados. La comparación PDF agrupado se implementará después."
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
              <p className="mt-1 text-sm leading-6 text-muted">
                Esta fase valida que las hojas agrupadas del Registro cuadran con la hoja Empleados. La comparación PDF agrupado se implementará después.
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary">
              <Table2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink">PDF agrupado</h2>
                <Badge value="Pendiente" />
              </div>
              <p className="mt-1 text-sm leading-6 text-muted">No se muestran columnas PDF en esta fase porque el cálculo agrupado PDF queda para la siguiente implementación.</p>
            </div>
          </div>
        </Card>
      </section>

      {summary.differenceRows === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-subtle">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          Las hojas agrupadas cuadran con Empleados.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {[
          ["Hojas analizadas", summary.sheets],
          ["Agrupaciones calculadas", summary.groups],
          ["Filas OK", summary.ok],
          ["Filas con diferencia", summary.differenceRows],
          ["Dif. total Salario", formatEuro(summary.salary)],
          ["Dif. total C. Salarial", formatEuro(summary.salaryComplement)],
          ["Dif. total Extrasalarial", formatEuro(summary.extraSalary)],
        ].map(([label, value]) => (
          <Card key={label} className="min-h-[104px] p-4">
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-3 text-xl font-semibold text-ink tabular-nums">{value}</p>
          </Card>
        ))}
      </section>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <FilterSelect label="Hoja" value={filters.sheet} options={options.sheets} onChange={(sheet) => setFilters((current) => ({ ...current, sheet }))} />
          <FilterSelect label="Base Registro" value={filters.base} options={options.bases} onChange={(base) => setFilters((current) => ({ ...current, base }))} />
          <FilterSelect label="Agrupación" value={filters.group} options={options.groups} onChange={(group) => setFilters((current) => ({ ...current, group }))} />
          <FilterSelect label="Bloque" value={filters.block} options={options.blocks} onChange={(block) => setFilters((current) => ({ ...current, block }))} />
          <FilterSelect label="Métrica" value={filters.metric} options={options.metrics} onChange={(metric) => setFilters((current) => ({ ...current, metric }))} />
          <FilterSelect label="Estado" value={filters.status} options={options.statuses} onChange={(status) => setFilters((current) => ({ ...current, status }))} />
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary min-h-10 px-4" onClick={() => setFilters(EMPTY_GROUPING_FILTERS)}>
            Limpiar filtros
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Detalle Validación Excel</h2>
          <p className="mt-1 text-sm text-muted">
            {filteredRows.length} filas visibles de {rows.length}
          </p>
        </div>
        <div className="max-h-[70dvh] overflow-auto">
          <table className="w-full min-w-[1720px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {HEADERS.map((header, index) => (
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
                  key={`${row.sourceSheet}-${row.registroBase}-${row.groupId}-${row.block}-${row.metric}-${row.segment}-${index}`}
                  tabIndex={0}
                  onClick={() => setSelectedRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelectedRow(row);
                  }}
                  className={cn("cursor-pointer transition", rowTone(row.status))}
                >
                  <td className="sticky left-0 z-10 min-w-[220px] border-b border-line/70 bg-inherit px-4 py-3 font-semibold shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]">
                    {displayText(row.sourceSheet)}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.registroBase)}</td>
                  <td className="border-b border-line/70 px-4 py-3 font-semibold">{displayText(row.groupName)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.block)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.metric)}</td>
                  <td className="border-b border-line/70 px-4 py-3">{displayText(row.segment)}</td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatGroupingValue(row, row.registroSheetValue)}</td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatGroupingValue(row, row.registroRecalculatedValue)}</td>
                  <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row.excelDifference))}>
                    {formatGroupingValue(row, row.excelDifference, "difference")}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.peopleCount}</td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.womenCount}</td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{row.menCount}</td>
                  <td className="border-b border-line/70 px-4 py-3">
                    <Badge value={row.status} />
                  </td>
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
