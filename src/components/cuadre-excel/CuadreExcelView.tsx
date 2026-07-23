"use client";

import { CheckCircle2, FileCheck2, Search, Sigma, Table2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AiExplanationPanel } from "@/components/ai/AiExplanationPanel";
import { useAppState } from "@/components/app/AppState";
import { CompactMetric } from "@/components/common/CompactMetric";
import { DataTableShell } from "@/components/common/DataTableShell";
import { DetailDrawer } from "@/components/common/DetailDrawer";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { SectionTabs } from "@/components/common/SectionTabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { buildInternalExcelExplainPayload } from "@/lib/ai/explainPayload";
import { selectBreakdownProjection, selectNormalizedProjection } from "@/lib/assistant/tools/sharedSelectors";
import type { AnalysisStatus, InternalExcelCheckRow, InternalExcelNormalizedVariablesCheckRow, NormalizedVsRealRow } from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

type CuadreMode = "breakdown" | "normalized" | "variables";
type StatusFilter = "Todos" | Extract<AnalysisStatus, "OK" | "Revisar" | "Diferencia">;
type SelectedRow =
  | { readonly mode: "breakdown"; readonly row: InternalExcelCheckRow }
  | { readonly mode: "normalized"; readonly row: NormalizedVsRealRow }
  | { readonly mode: "variables"; readonly row: InternalExcelNormalizedVariablesCheckRow };

interface SummaryMetric {
  readonly label: string;
  readonly value: string | number;
  readonly tone: "blue" | "green" | "orange" | "red";
}

const MODES = [
  {
    value: "breakdown",
    label: "Cuadre",
    accessibleLabel: "No norm. / Desglose",
    tabId: "cuadre-breakdown-tab",
    panelId: "cuadre-breakdown-panel",
    description: "Compara las retribuciones del periodo completo frente a la suma de conceptos desglosados.",
  },
  {
    value: "normalized",
    label: "Normalizados",
    tabId: "cuadre-normalized-tab",
    panelId: "cuadre-normalized-panel",
    description: "Compara el valor normalizado, el periodo completo y el importe real detectado en los recibos.",
  },
  {
    value: "variables",
    label: "Variables",
    accessibleLabel: "No norm. / Norm. + variables",
    tabId: "cuadre-variables-tab",
    panelId: "cuadre-variables-panel",
    description: "Compara las retribuciones del periodo completo frente al total normalizado más variables del Excel Reg. Retrib.",
  },
] as const;

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
  { label: "Salario", period: "salaryPeriod", normalized: "salaryNormalizedPlusVariables", difference: "salaryDifference" },
  { label: "C. Salarial", period: "salaryComplementPeriod", normalized: "salaryComplementNormalizedPlusVariables", difference: "salaryComplementDifference" },
  { label: "Extrasalarial", period: "extraSalaryPeriod", normalized: "extraSalaryNormalizedPlusVariables", difference: "extraSalaryDifference" },
  { label: "Total", period: "totalPeriod", normalized: "totalNormalizedPlusVariables", difference: "totalDifference" },
] as const;

function diffClass(value: number): string {
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-blue-700";
  return "text-slate-700";
}

function rowTone(status: AnalysisStatus): string {
  if (status === "OK") return "bg-emerald-50 hover:bg-emerald-100";
  if (status === "Revisar") return "bg-orange-50 hover:bg-orange-100";
  if (status === "Diferencia") return "bg-red-50 hover:bg-red-100";
  return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
}

function matchesText(value: string | number | undefined, query: string): boolean {
  return displayText(value).toLocaleLowerCase("es").includes(query);
}

function Field({ label, value }: Readonly<{ label: string; value?: string | number }>) {
  return <div className="detail-field"><small>{label}</small><strong>{displayText(value) || "Sin dato"}</strong></div>;
}

function MoneyTriplet({ label, period, comparison, difference, comparisonLabel }: Readonly<{ label: string; period: number; comparison: number; difference: number; comparisonLabel: string }>) {
  return (
    <section className="detail-block">
      <h3>{label}</h3>
      <div className="detail-grid mt-3">
        <Field label="Periodo" value={formatEuro(period)} />
        <Field label={comparisonLabel} value={formatEuro(comparison)} />
        <Field label="Diferencia" value={formatEuro(difference)} />
      </div>
    </section>
  );
}

function BreakdownDetail({ row }: Readonly<{ row: InternalExcelCheckRow }>) {
  const projection = selectBreakdownProjection(row);
  return (
    <>
      <div className="detail-grid">
        <Field label="Matrícula" value={projection.personId} />
        <Field label="Estado" value={projection.status} />
        <Field label="Centro" value={row.workplace} />
        <Field label="Puesto" value={row.position} />
        <Field label="Categoría" value={row.category} />
      </div>
      <MoneyTriplet label="Salario" period={projection.salaryPeriod} comparison={projection.salaryBreakdown} difference={projection.salaryDifference} comparisonLabel="Desglose" />
      <MoneyTriplet label="C. Salarial" period={projection.salaryComplementPeriod} comparison={projection.salaryComplementBreakdown} difference={projection.salaryComplementDifference} comparisonLabel="Desglose" />
      <MoneyTriplet label="Extrasalarial" period={projection.extraSalaryPeriod} comparison={projection.extraSalaryBreakdown} difference={projection.extraSalaryDifference} comparisonLabel="Desglose" />
      <div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div>
      <AiExplanationPanel type="internalExcelCheck" payload={buildInternalExcelExplainPayload(row)} />
    </>
  );
}

function VariablesDetail({ row }: Readonly<{ row: InternalExcelNormalizedVariablesCheckRow }>) {
  const projection = selectNormalizedProjection(row);
  return (
    <>
      <div className="detail-grid">
        <Field label="Matrícula" value={projection.personId} />
        <Field label="Estado" value={projection.status} />
        <Field label="Persona" value={row.person} />
        <Field label="Centro" value={row.workplace} />
        <Field label="Puesto" value={row.position} />
        <Field label="Categoría" value={row.category} />
      </div>
      <MoneyTriplet label="Salario" period={projection.salaryPeriod} comparison={projection.salaryNormalizedPlusVariables} difference={projection.salaryDifference} comparisonLabel="Norm. + variables" />
      <MoneyTriplet label="C. Salarial" period={projection.salaryComplementPeriod} comparison={projection.salaryComplementNormalizedPlusVariables} difference={projection.salaryComplementDifference} comparisonLabel="Norm. + variables" />
      <MoneyTriplet label="Extrasalarial" period={projection.extraSalaryPeriod} comparison={projection.extraSalaryNormalizedPlusVariables} difference={projection.extraSalaryDifference} comparisonLabel="Norm. + variables" />
      <MoneyTriplet label="Total" period={projection.totalPeriod} comparison={projection.totalNormalizedPlusVariables} difference={projection.totalDifference} comparisonLabel="Norm. + variables" />
      <div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div>
    </>
  );
}

function NormalizedDetail({ row }: Readonly<{ row: NormalizedVsRealRow }>) {
  return (
    <>
      <div className="detail-grid">
        <Field label="Matrícula" value={row.employeeNumber} />
        <Field label="Estado" value={row.status} />
        <Field label="Persona" value={row.person} />
        <Field label="Centro" value={row.workplace} />
        <Field label="Normalizado + variables" value={formatEuro(row.normalizedPlusVariables)} />
        <Field label="Normalizado" value={formatEuro(row.normalized)} />
        <Field label="Periodo completo" value={formatEuro(row.periodComplete)} />
        <Field label="Real PDF" value={formatEuro(row.realPdf)} />
      </div>
      <div className="detail-block"><h3>Posible justificación</h3><p>{displayText(row.possibleJustification) || "No existe una justificación automática."}</p></div>
      <div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div>
    </>
  );
}

function Controls({ query, statusFilter, onQueryChange, onStatusFilterChange }: Readonly<{ query: string; statusFilter: StatusFilter; onQueryChange: (value: string) => void; onStatusFilterChange: (value: StatusFilter) => void }>) {
  return (
    <div className="cuadre-controls">
      <label className="cuadre-controls__search">
        <span className="sr-only">Buscar</span>
        <Search className="size-4" aria-hidden="true" />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar en Cuadre Reg." />
      </label>
      <label className="cuadre-controls__status">Estado
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}>
          <option value="Todos">Todos</option>
          <option value="OK">OK</option>
          <option value="Revisar">Revisar</option>
          <option value="Diferencia">Diferencia</option>
        </select>
      </label>
    </div>
  );
}

function buildMetrics(input: { readonly totalCount: number; readonly rows: readonly { readonly status: AnalysisStatus }[]; readonly maxDifference: number; readonly visibleTotalDifference: number }): SummaryMetric[] {
  const ok = input.rows.filter((item) => item.status === "OK").length;
  const withDifference = input.rows.filter((item) => item.status !== "OK").length;
  return [
    { label: "Empleados analizados", value: input.totalCount, tone: "blue" },
    { label: "OK", value: ok, tone: "green" },
    { label: "Con diferencia", value: withDifference, tone: withDifference ? "red" : "green" },
    { label: "Mayor diferencia", value: formatEuro(input.maxDifference), tone: input.maxDifference ? "red" : "green" },
    { label: "Diferencia total visible", value: formatEuro(input.visibleTotalDifference), tone: input.visibleTotalDifference ? "orange" : "green" },
  ];
}

function Metrics({ metrics }: Readonly<{ metrics: readonly SummaryMetric[] }>) {
  return (
    <section data-surface="metric-grid" aria-label="Resumen de Cuadre Reg." className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => {
        const Icon = metric.tone === "green" ? CheckCircle2 : metric.tone === "blue" ? Table2 : Sigma;
        return <CompactMetric key={metric.label} variant="card" label={metric.label} value={metric.value} icon={Icon} tone={metric.tone} />;
      })}
    </section>
  );
}

function BreakdownTable({ rows, onSelect }: Readonly<{ rows: readonly InternalExcelCheckRow[]; onSelect: (row: InternalExcelCheckRow) => void }>) {
  return (
    <table className="w-full min-w-[1440px] border-separate border-spacing-0 text-left text-sm">
      <thead><tr>{BREAKDOWN_HEADERS.map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr></thead>
      <tbody>{rows.map((item) => {
        const projection = selectBreakdownProjection(item);
        return (
          <tr key={projection.personId} tabIndex={0} className={cn("cursor-pointer transition", rowTone(projection.status))} onClick={() => onSelect(item)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(item); }}>
            <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(projection.personId)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.salaryPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.salaryBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(projection.salaryDifference))}>{formatEuro(projection.salaryDifference)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.salaryComplementPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.salaryComplementBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(projection.salaryComplementDifference))}>{formatEuro(projection.salaryComplementDifference)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.extraSalaryPeriod)}</td>
            <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(projection.extraSalaryBreakdown)}</td>
            <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(projection.extraSalaryDifference))}>{formatEuro(projection.extraSalaryDifference)}</td>
            <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={projection.status} /></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function VariablesTable({ rows, onSelect }: Readonly<{ rows: readonly InternalExcelNormalizedVariablesCheckRow[]; onSelect: (row: InternalExcelNormalizedVariablesCheckRow) => void }>) {
  return (
    <table className="w-full min-w-[1920px] border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr>
          {["Matrícula", "Persona", "Centro", "Puesto", "Categoría"].map((header) => <th key={header} rowSpan={2} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}
          {NORMALIZED_BLOCKS.map((block) => <th key={block.label} colSpan={3} className="border-b border-line px-4 py-2 text-center text-xs font-semibold uppercase">{block.label}</th>)}
          <th rowSpan={2} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">Estado</th>
        </tr>
        <tr>{NORMALIZED_BLOCKS.flatMap((block) => [
          <th key={`${block.label}-period`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">No norm.</th>,
          <th key={`${block.label}-normalized`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">Norm. + variables</th>,
          <th key={`${block.label}-difference`} className="border-b border-line px-4 py-2 text-right text-xs font-semibold uppercase">Dif.</th>,
        ])}</tr>
      </thead>
      <tbody>{rows.map((item) => {
        const projection = selectNormalizedProjection(item);
        return (
          <tr key={projection.personId} tabIndex={0} className={cn("cursor-pointer transition", rowTone(projection.status))} onClick={() => onSelect(item)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(item); }}>
            <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(projection.personId)}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(item.person) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(item.workplace) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(item.position) || "Sin dato"}</td>
            <td className="border-b border-line/70 px-4 py-3">{displayText(item.category) || "Sin dato"}</td>
            {NORMALIZED_BLOCKS.map((block) => {
              const period = projection[block.period];
              const normalized = projection[block.normalized];
              const difference = projection[block.difference];
              return <Fragment key={`${projection.personId}-${block.label}`}><td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(period)}</td><td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(normalized)}</td><td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(difference))}>{formatEuro(difference)}</td></Fragment>;
            })}
            <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={projection.status} /></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function NormalizedTable({ rows, onSelect }: Readonly<{ rows: readonly NormalizedVsRealRow[]; onSelect: (row: NormalizedVsRealRow) => void }>) {
  return (
    <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
      <thead><tr>{["Matrícula", "Persona", "Centro", "Puesto", "Normalizado + variables", "Normalizado", "Periodo completo", "Real PDF", "Dif. PDF / periodo", "Dif. PDF / normalizado", "Estado"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr></thead>
      <tbody>{rows.map((item) => (
        <tr key={item.employeeNumber} tabIndex={0} className={cn("cursor-pointer transition", rowTone(item.status))} onClick={() => onSelect(item)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(item); }}>
          <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(item.employeeNumber)}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(item.person) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(item.workplace) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(item.position) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(item.normalizedPlusVariables)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(item.normalized)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(item.periodComplete)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(item.realPdf)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(item.diffPdfVsPeriodComplete))}>{formatEuro(item.diffPdfVsPeriodComplete)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(item.diffPdfVsNormalized))}>{formatEuro(item.diffPdfVsNormalized)}</td>
          <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={item.status} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export function CuadreExcelView() {
  const { result, assistantNavigationIntent, consumeAssistantNavigationIntent } = useAppState();
  const [activeMode, setActiveMode] = useState<CuadreMode>("breakdown");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [selected, setSelected] = useState<SelectedRow>();

  useEffect(() => {
    if (assistantNavigationIntent?.type !== "open_cuadre") return;
    setActiveMode(assistantNavigationIntent.view === "normalized_variables" ? "variables" : "breakdown");
    setQuery(assistantNavigationIntent.personId ?? "");
    consumeAssistantNavigationIntent();
  }, [assistantNavigationIntent, consumeAssistantNavigationIntent]);

  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const breakdownRows = useMemo(() => (result?.internalExcelChecks ?? []).filter((item) => {
    const matchesStatus = statusFilter === "Todos" || item.status === statusFilter;
    const matchesQuery = !normalizedQuery || [item.employeeNumber, item.workplace, item.position, item.category].some((value) => matchesText(value, normalizedQuery));
    return matchesStatus && matchesQuery;
  }), [normalizedQuery, result?.internalExcelChecks, statusFilter]);
  const variablesSource = result?.internalExcelNormalizedVariablesChecks;
  const variablesRows = useMemo(() => (variablesSource ?? []).filter((item) => {
    const matchesStatus = statusFilter === "Todos" || item.status === statusFilter;
    const matchesQuery = !normalizedQuery || [item.employeeNumber, item.person, item.workplace, item.position, item.category].some((value) => matchesText(value, normalizedQuery));
    return matchesStatus && matchesQuery;
  }), [normalizedQuery, statusFilter, variablesSource]);
  const normalizedRows = useMemo(() => (result?.normalizedVsReal ?? []).filter((item) => {
    const matchesStatus = statusFilter === "Todos" || item.status === statusFilter;
    const matchesQuery = !normalizedQuery || [item.employeeNumber, item.person, item.workplace, item.position, item.category].some((value) => matchesText(value, normalizedQuery));
    return matchesStatus && matchesQuery;
  }), [normalizedQuery, result?.normalizedVsReal, statusFilter]);

  if (!result) return <div className="space-y-6"><SectionHeader title="Cuadre Reg." subtitle="Consulta los cuadres internos del Excel Reg. Retrib." /><EmptyState icon={FileCheck2} title="No hay análisis activo" description="Carga el Registro Retributivo y los recibos para generar el Cuadre Reg." /></div>;

  const currentMode = MODES.find((mode) => mode.value === activeMode) ?? MODES[0];
  const variablesLegacyMissing = activeMode === "variables" && variablesSource === undefined;
  const metrics = activeMode === "breakdown"
    ? buildMetrics({
      totalCount: result.internalExcelChecks.length,
      rows: breakdownRows,
      maxDifference: breakdownRows.reduce((max, item) => { const projection = selectBreakdownProjection(item); return Math.max(max, Math.abs(projection.salaryDifference), Math.abs(projection.salaryComplementDifference), Math.abs(projection.extraSalaryDifference)); }, 0),
      visibleTotalDifference: breakdownRows.reduce((sum, item) => { const projection = selectBreakdownProjection(item); return sum + projection.salaryDifference + projection.salaryComplementDifference + projection.extraSalaryDifference; }, 0),
    })
    : activeMode === "variables"
      ? buildMetrics({
        totalCount: variablesSource?.length ?? 0,
        rows: variablesRows,
        maxDifference: variablesRows.reduce((max, item) => { const projection = selectNormalizedProjection(item); return Math.max(max, Math.abs(projection.salaryDifference), Math.abs(projection.salaryComplementDifference), Math.abs(projection.extraSalaryDifference), Math.abs(projection.totalDifference)); }, 0),
        visibleTotalDifference: variablesRows.reduce((sum, item) => sum + selectNormalizedProjection(item).totalDifference, 0),
      })
      : buildMetrics({
        totalCount: result.normalizedVsReal?.length ?? 0,
        rows: normalizedRows,
        maxDifference: normalizedRows.reduce((max, item) => Math.max(max, Math.abs(item.diffPdfVsPeriodComplete), Math.abs(item.diffPdfVsNormalizedPlusVariables), Math.abs(item.diffPdfVsNormalized)), 0),
        visibleTotalDifference: normalizedRows.reduce((sum, item) => sum + item.diffPdfVsPeriodComplete, 0),
      });

  const visibleRows = activeMode === "breakdown" ? breakdownRows : activeMode === "variables" ? variablesRows : normalizedRows;

  return (
    <div className="space-y-6">
      <SectionHeader title="Cuadre Reg." subtitle="Consulta los cuadres internos del Excel Reg. Retrib." />
      <SectionTabs label="Vistas de Cuadre Reg." value={activeMode} items={MODES} onValueChange={setActiveMode} />
      <div id={currentMode.panelId} role="tabpanel" aria-labelledby={currentMode.tabId} className="space-y-6">
        <p className="text-sm leading-6 text-muted">{currentMode.description}</p>
        <Metrics metrics={metrics} />
        {activeMode === "breakdown" && result.internalExcelChecks.length > 0 && result.internalExcelChecks.every((item) => item.status === "OK") ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-subtle">El Cuadre Reg. no presenta diferencias en No norm. / Desglose.</div>
        ) : null}
        <DataTableShell toolbar={<Controls query={query} statusFilter={statusFilter} onQueryChange={setQuery} onStatusFilterChange={setStatusFilter} />}>
          {variablesLegacyMissing ? <p className="p-6 text-sm font-medium text-muted">Este análisis no contiene el cuadre No norm. / Norm. + variables. Vuelve a analizar el Excel para generarlo.</p> : (
            <>
              {activeMode === "breakdown" ? <BreakdownTable rows={breakdownRows} onSelect={(row) => setSelected({ mode: "breakdown", row })} /> : null}
              {activeMode === "variables" ? <VariablesTable rows={variablesRows} onSelect={(row) => setSelected({ mode: "variables", row })} /> : null}
              {activeMode === "normalized" ? <NormalizedTable rows={normalizedRows} onSelect={(row) => setSelected({ mode: "normalized", row })} /> : null}
              {!visibleRows.length ? <p className="p-6 text-sm text-muted">No hay filas visibles con los filtros actuales.</p> : null}
            </>
          )}
        </DataTableShell>
      </div>
      <DetailDrawer open={Boolean(selected)} title="Detalle Cuadre Reg." description={selected ? `Vista: ${MODES.find((mode) => mode.value === selected.mode)?.label ?? "Cuadre"}` : undefined} onClose={() => setSelected(undefined)}>
        {selected?.mode === "breakdown" ? <BreakdownDetail row={selected.row} /> : null}
        {selected?.mode === "variables" ? <VariablesDetail row={selected.row} /> : null}
        {selected?.mode === "normalized" ? <NormalizedDetail row={selected.row} /> : null}
      </DetailDrawer>
    </div>
  );
}
