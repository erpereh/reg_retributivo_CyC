"use client";

import { CheckCircle2, Copy, FileCheck2, Search, Sigma, Table2, X } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AiExplanationPanel } from "@/components/ai/AiExplanationPanel";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { buildInternalExcelExplainPayload } from "@/lib/ai/explainPayload";
import type { AnalysisStatus, InternalExcelCheckRow, InternalExcelNormalizedVariablesCheckRow } from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

type CuadreMode = "breakdown" | "normalizedVariables";
type StatusFilter = "Todos" | Extract<AnalysisStatus, "OK" | "Revisar" | "Diferencia">;

interface SummaryMetric {
  readonly label: string;
  readonly value: string | number;
  readonly tone: "blue" | "green" | "orange" | "red";
}

const MODES: ReadonlyArray<{ id: CuadreMode; label: string; description: string }> = [
  {
    id: "breakdown",
    label: "No norm. / Desglose",
    description: "Compara las retribuciones del periodo completo frente a la suma de conceptos desglosados.",
  },
  {
    id: "normalizedVariables",
    label: "No norm. / Norm. + variables",
    description: "Compara las retribuciones del periodo completo frente al total normalizado más variables del Excel Reg. Retrib.",
  },
];

const BREAKDOWN_HEADERS = [
  "Matrícula",
  "Salario periodo completo",
  "Salario desglose",
  "Dif. Salario",
  "C. Salarial periodo completo",
  "C. Salarial desglose",
  "Dif. C. Salarial",
  "Extrasalarial periodo completo",
  "Extrasalarial desglose",
  "Dif. Extrasalarial",
  "Estado",
] as const;

const NORMALIZED_BLOCKS = [
  {
    label: "Salario",
    period: "salaryPeriod",
    normalized: "salaryNormalizedPlusVariables",
    difference: "salaryDifference",
  },
  {
    label: "C. Salarial",
    period: "salaryComplementPeriod",
    normalized: "salaryComplementNormalizedPlusVariables",
    difference: "salaryComplementDifference",
  },
  {
    label: "Extrasalarial",
    period: "extraSalaryPeriod",
    normalized: "extraSalaryNormalizedPlusVariables",
    difference: "extraSalaryDifference",
  },
  {
    label: "Total",
    period: "totalPeriod",
    normalized: "totalNormalizedPlusVariables",
    difference: "totalDifference",
  },
] as const;

const TONE_CLASS: Record<SummaryMetric["tone"], string> = {
  blue: "bg-blue-50 text-primary",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
};

function diffClass(value: number): string {
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-blue-700";
  return "text-slate-700";
}

function rowTone(status: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50 hover:bg-emerald-100";
    case "Revisar":
      return "bg-orange-50 hover:bg-orange-100";
    case "Diferencia":
      return "bg-red-50 hover:bg-red-100";
    default:
      return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
  }
}

function breakdownMaxDifference(row: InternalExcelCheckRow): number {
  return Math.max(Math.abs(row.salaryDifference), Math.abs(row.salaryComplementDifference), Math.abs(row.extraSalaryDifference));
}

function breakdownTotalDifference(row: InternalExcelCheckRow): number {
  return row.salaryDifference + row.salaryComplementDifference + row.extraSalaryDifference;
}

function normalizedMaxDifference(row: InternalExcelNormalizedVariablesCheckRow): number {
  return Math.max(Math.abs(row.salaryDifference), Math.abs(row.salaryComplementDifference), Math.abs(row.extraSalaryDifference), Math.abs(row.totalDifference));
}

function matchesText(value: string | number | undefined, query: string): boolean {
  return displayText(value).toLocaleLowerCase("es").includes(query);
}

function MetricCard({ metric, index }: Readonly<{ metric: SummaryMetric; index: number }>) {
  const Icon = metric.tone === "green" ? CheckCircle2 : metric.tone === "blue" ? Table2 : Sigma;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.12), ease: "easeOut" }}>
      <Card className="min-h-[118px] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted text-pretty">{metric.label}</p>
            <p className="mt-3 text-2xl font-semibold text-ink tabular-nums">{metric.value}</p>
          </div>
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", TONE_CLASS[metric.tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </Card>
    </motion.div>
  );
}

function ModalField({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{displayText(value) || "Sin dato"}</p>
    </div>
  );
}

function MoneyTriplet({ label, period, breakdown, diff }: Readonly<{ label: string; period: number; breakdown: number; diff: number }>) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <ModalField label="Periodo" value={formatEuro(period)} />
        <ModalField label="Desglose" value={formatEuro(breakdown)} />
        <ModalField label="Dif." value={formatEuro(diff)} />
      </div>
    </div>
  );
}

function DetailModal({ row, onClose }: Readonly<{ row: InternalExcelCheckRow; onClose: () => void }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copySummary = `Cuadre Reg. ${row.employeeNumber}: ${row.status} - ${displayText(row.detail)}`;
  const aiPayload = buildInternalExcelExplainPayload(row);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle Cuadre Reg."
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-lift sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted">Detalle determinista</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink text-balance">Detalle Cuadre Reg.</h2>
          </div>
          <button type="button" aria-label="Cerrar detalle" onClick={onClose} className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <ModalField label="Matrícula" value={row.employeeNumber} />
          <ModalField label="Estado" value={row.status} />
          <ModalField label="Centro" value={row.workplace} />
          <ModalField label="Puesto" value={row.position} />
          <ModalField label="Categoría" value={row.category} />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <MoneyTriplet label="Salario" period={row.salaryPeriod} breakdown={row.salaryBreakdown} diff={row.salaryDifference} />
          <MoneyTriplet label="C. Salarial" period={row.salaryComplementPeriod} breakdown={row.salaryComplementBreakdown} diff={row.salaryComplementDifference} />
          <MoneyTriplet label="Extrasalarial" period={row.extraSalaryPeriod} breakdown={row.extraSalaryBreakdown} diff={row.extraSalaryDifference} />
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-ink">Detalle</p>
          <p className="mt-2 text-sm leading-6 text-muted text-pretty">{displayText(row.detail) || "Sin detalle adicional."}</p>
        </div>

        <AiExplanationPanel type="internalExcelCheck" payload={aiPayload} />

        <div className="mt-6 flex justify-end">
          <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(copySummary)}>
            <Copy className="size-4" aria-hidden="true" />
            Copiar resumen
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CuadreControls({
  query,
  statusFilter,
  onQueryChange,
  onStatusFilterChange,
}: Readonly<{
  query: string;
  statusFilter: StatusFilter;
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
}>) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
      <label className="min-w-0 flex-1 text-sm font-semibold text-ink">
        <span className="sr-only">Buscar</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar en Cuadre Reg."
            className="w-full rounded-2xl border border-line bg-white py-2.5 pl-10 pr-3 text-sm text-ink shadow-subtle outline-none transition focus:border-primary focus:ring-4 focus:ring-blue-100"
          />
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        Estado
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
          className="rounded-2xl border border-line bg-white px-3 py-2.5 text-sm text-ink shadow-subtle outline-none transition focus:border-primary focus:ring-4 focus:ring-blue-100"
        >
          <option value="Todos">Todos</option>
          <option value="OK">OK</option>
          <option value="Revisar">Revisar</option>
          <option value="Diferencia">Diferencia</option>
        </select>
      </label>
    </div>
  );
}

function buildMetrics(input: {
  readonly totalCount: number;
  readonly rows: readonly { readonly status: AnalysisStatus }[];
  readonly maxDifference: number;
  readonly visibleTotalDifference: number;
}): SummaryMetric[] {
  const ok = input.rows.filter((row) => row.status === "OK").length;
  const withDifference = input.rows.filter((row) => row.status !== "OK").length;
  return [
    { label: "Empleados analizados", value: input.totalCount, tone: "blue" },
    { label: "OK", value: ok, tone: "green" },
    { label: "Con diferencia", value: withDifference, tone: withDifference ? "red" : "green" },
    { label: "Mayor diferencia", value: formatEuro(input.maxDifference), tone: input.maxDifference ? "red" : "green" },
    { label: "Diferencia total visible", value: formatEuro(input.visibleTotalDifference), tone: input.visibleTotalDifference ? "orange" : "green" },
  ];
}

function BreakdownTable({ rows, onSelectRow }: Readonly<{ rows: readonly InternalExcelCheckRow[]; onSelectRow: (row: InternalExcelCheckRow) => void }>) {
  return (
    <table className="w-full min-w-[1440px] border-separate border-spacing-0 text-left text-sm">
      <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
        <tr>
          {BREAKDOWN_HEADERS.map((header, index) => (
            <th
              key={header}
              className={cn(
                "border-b border-line px-4 py-3 text-xs font-semibold uppercase",
                index === 0 && "sticky left-0 z-30 min-w-[128px] bg-slate-100 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]",
              )}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.employeeNumber}
            tabIndex={0}
            onClick={() => onSelectRow(row)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelectRow(row);
            }}
            className={cn("cursor-pointer transition", rowTone(row.status))}
          >
            <td className="sticky left-0 z-10 min-w-[128px] border-b border-line/70 bg-inherit px-4 py-3 font-mono shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]">
              {displayText(row.employeeNumber)}
            </td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.salaryPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.salaryBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row.salaryDifference))}>{formatEuro(row.salaryDifference)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.salaryComplementPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.salaryComplementBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row.salaryComplementDifference))}>
              {formatEuro(row.salaryComplementDifference)}
            </td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.extraSalaryPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(row.extraSalaryBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row.extraSalaryDifference))}>{formatEuro(row.extraSalaryDifference)}</td>
            <td className="border-b border-line/70 px-4 py-3">
              <Badge value={row.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NormalizedVariablesTable({ rows }: Readonly<{ rows: readonly InternalExcelNormalizedVariablesCheckRow[] }>) {
  return (
    <table className="w-full min-w-[1920px] border-separate border-spacing-0 text-left text-sm">
      <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
        <tr>
          {["Matrícula", "Persona", "Centro", "Puesto", "Categoría"].map((header, index) => (
            <th
              key={header}
              rowSpan={2}
              className={cn(
                "border-b border-line px-4 py-3 text-xs font-semibold uppercase",
                index === 0 && "sticky left-0 z-30 min-w-[128px] bg-slate-100 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]",
              )}
            >
              {header}
            </th>
          ))}
          {NORMALIZED_BLOCKS.map((block) => (
            <th key={block.label} colSpan={3} className="border-b border-line px-4 py-2 text-center text-xs font-semibold uppercase">
              {block.label}
            </th>
          ))}
          <th rowSpan={2} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">
            Estado
          </th>
        </tr>
        <tr>
          {NORMALIZED_BLOCKS.flatMap((block) => [
            <th key={`${block.label}-period`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">
              No norm.
            </th>,
            <th key={`${block.label}-normalized`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">
              Norm. + variables
            </th>,
            <th key={`${block.label}-difference`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">
              Dif.
            </th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.employeeNumber} className={cn("transition", rowTone(row.status))}>
            <td className="sticky left-0 z-10 min-w-[128px] border-b border-line/70 bg-inherit px-4 py-3 font-mono shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]">
              {displayText(row.employeeNumber)}
            </td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(row.person) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(row.workplace) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(row.position) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(row.category) || "Sin dato"}</td>
            {NORMALIZED_BLOCKS.map((block) => {
              const period = row[block.period];
              const normalized = row[block.normalized];
              const difference = row[block.difference];
              return (
                <Fragment key={`${row.employeeNumber}-${block.label}`}>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(period)}</td>
                  <td className="border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums">{formatEuro(normalized)}</td>
                  <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(difference))}>{formatEuro(difference)}</td>
                </Fragment>
              );
            })}
            <td className="border-b border-line/70 px-4 py-3">
              <Badge value={row.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CuadreExcelView() {
  const { result } = useAppState();
  const [activeMode, setActiveMode] = useState<CuadreMode>("breakdown");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [selectedRow, setSelectedRow] = useState<InternalExcelCheckRow | undefined>();
  const activeDescription = MODES.find((mode) => mode.id === activeMode)?.description ?? MODES[0].description;

  const normalizedRows = result?.internalExcelNormalizedVariablesChecks;
  const normalizedLegacyMissing = activeMode === "normalizedVariables" && result && normalizedRows === undefined;

  const filteredBreakdownRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return (result?.internalExcelChecks ?? []).filter((row) => {
      const matchesStatus = statusFilter === "Todos" || row.status === statusFilter;
      const matchesQuery =
        !normalizedQuery ||
        [row.employeeNumber, row.workplace, row.position, row.category].some((value) => matchesText(value, normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [query, result?.internalExcelChecks, statusFilter]);

  const filteredNormalizedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return (normalizedRows ?? []).filter((row) => {
      const matchesStatus = statusFilter === "Todos" || row.status === statusFilter;
      const matchesQuery =
        !normalizedQuery ||
        [row.employeeNumber, row.person, row.workplace, row.position, row.category].some((value) => matchesText(value, normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [normalizedRows, query, statusFilter]);

  const metrics = useMemo(() => {
    if (activeMode === "normalizedVariables") {
      return buildMetrics({
        totalCount: normalizedRows?.length ?? 0,
        rows: filteredNormalizedRows,
        maxDifference: filteredNormalizedRows.reduce((max, row) => Math.max(max, normalizedMaxDifference(row)), 0),
        visibleTotalDifference: filteredNormalizedRows.reduce((sum, row) => sum + row.totalDifference, 0),
      });
    }

    return buildMetrics({
      totalCount: result?.internalExcelChecks.length ?? 0,
      rows: filteredBreakdownRows,
      maxDifference: filteredBreakdownRows.reduce((max, row) => Math.max(max, breakdownMaxDifference(row)), 0),
      visibleTotalDifference: filteredBreakdownRows.reduce((sum, row) => sum + breakdownTotalDifference(row), 0),
    });
  }, [activeMode, filteredBreakdownRows, filteredNormalizedRows, normalizedRows?.length, result?.internalExcelChecks.length]);

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Cuadre Reg." subtitle="Consulta los cuadres internos del Excel Reg. Retrib." />
        <EmptyState icon={FileCheck2} title="No hay análisis activo" description="Carga el Registro Retributivo y los recibos para generar el Cuadre Reg." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Cuadre Reg." subtitle="Consulta los cuadres internos del Excel Reg. Retrib." />

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2" aria-label="Vistas de Cuadre Reg.">
          {MODES.map((mode) => {
            const active = activeMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveMode(mode.id)}
                className={cn(
                  "rounded-full px-3 py-2 text-sm font-semibold transition",
                  active ? "bg-primary text-white shadow-subtle" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-sm leading-6 text-muted">{activeDescription}</p>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric, index) => (
          <MetricCard key={metric.label} metric={metric} index={index} />
        ))}
      </section>

      {activeMode === "breakdown" && result.internalExcelChecks.length > 0 && result.internalExcelChecks.every((row) => row.status === "OK") ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-subtle">
          El Cuadre Reg. no presenta diferencias en No norm. / Desglose.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <CuadreControls query={query} statusFilter={statusFilter} onQueryChange={setQuery} onStatusFilterChange={setStatusFilter} />
        {normalizedLegacyMissing ? (
          <p className="p-6 text-sm font-medium text-muted">
            Este análisis no contiene el cuadre No norm. / Norm. + variables. Vuelve a analizar el Excel para generarlo.
          </p>
        ) : (
          <div className="max-h-[70dvh] overflow-auto">
            {activeMode === "breakdown" ? <BreakdownTable rows={filteredBreakdownRows} onSelectRow={setSelectedRow} /> : <NormalizedVariablesTable rows={filteredNormalizedRows} />}
            {activeMode === "breakdown" && !filteredBreakdownRows.length ? <p className="p-6 text-sm text-muted">No hay filas visibles en No norm. / Desglose.</p> : null}
            {activeMode === "normalizedVariables" && !filteredNormalizedRows.length ? <p className="p-6 text-sm text-muted">No hay filas visibles en No norm. / Norm. + variables.</p> : null}
          </div>
        )}
      </Card>

      {selectedRow ? <DetailModal row={selectedRow} onClose={() => setSelectedRow(undefined)} /> : null}
    </div>
  );
}
