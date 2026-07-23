"use client";

import { CheckCircle2, FileCheck2, Search, Sigma, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { CompactMetric } from "@/components/common/CompactMetric";
import { DataTableShell } from "@/components/common/DataTableShell";
import { DetailDrawer } from "@/components/common/DetailDrawer";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { SectionTabs } from "@/components/common/SectionTabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import type {
  AnalysisStatus,
  InternalExcelCheckRow,
  InternalExcelNormalizedVariablesCheckRow,
  NormalizedVsRealRow,
} from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

type CuadreMode = "breakdown" | "normalized" | "variables";
type StatusFilter = "Todos" | AnalysisStatus;
type SelectedRow =
  | { readonly mode: "breakdown"; readonly row: InternalExcelCheckRow }
  | { readonly mode: "normalized"; readonly row: NormalizedVsRealRow }
  | { readonly mode: "variables"; readonly row: InternalExcelNormalizedVariablesCheckRow };

const MODES = [
  { value: "breakdown", label: "Cuadre", tabId: "cuadre-breakdown-tab", panelId: "cuadre-breakdown-panel", description: "Valida el total del periodo frente al desglose de conceptos del Registro Retributivo." },
  { value: "normalized", label: "Normalizados", tabId: "cuadre-normalized-tab", panelId: "cuadre-normalized-panel", description: "Compara normalizado, periodo completo y valor real de los recibos." },
  { value: "variables", label: "Variables", tabId: "cuadre-variables-tab", panelId: "cuadre-variables-panel", description: "Revisa cómo las variables explican el salto entre el valor normalizado y el periodo completo." },
] as const;

const STATUS_OPTIONS: readonly StatusFilter[] = ["Todos", "OK", "Revisar", "Diferencia", "Sin datos"];

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function matches(value: unknown, query: string): boolean {
  return displayText(value).toLocaleLowerCase("es").includes(query);
}

function diffClass(value: number): string {
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-blue-700";
  return "text-slate-700";
}

function rowTone(status: AnalysisStatus): string {
  if (status === "OK") return "bg-emerald-50 hover:bg-emerald-100";
  if (status === "Revisar" || status === "Sin datos") return "bg-orange-50 hover:bg-orange-100";
  if (status === "Diferencia") return "bg-red-50 hover:bg-red-100";
  return "odd:bg-white even:bg-slate-50 hover:bg-blue-50";
}

function Controls({ query, status, onQuery, onStatus }: Readonly<{ query: string; status: StatusFilter; onQuery: (value: string) => void; onStatus: (value: StatusFilter) => void }>) {
  return (
    <div className="cuadre-controls">
      <label className="cuadre-controls__search">
        <span className="sr-only">Buscar</span>
        <Search className="size-4" aria-hidden="true" />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar matrícula, persona, centro o categoría" />
      </label>
      <label className="cuadre-controls__status">Estado
        <select value={status} onChange={(event) => onStatus(event.target.value as StatusFilter)}>
          {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  );
}

function MetricStrip({ rows, totalDifference }: Readonly<{ rows: readonly { readonly status: AnalysisStatus }[]; totalDifference: number }>) {
  const ok = rows.filter((row) => row.status === "OK").length;
  const review = rows.filter((row) => row.status === "Revisar").length;
  const differences = rows.filter((row) => row.status === "Diferencia").length;
  const metrics = [
    { label: "Filas visibles", value: rows.length, tone: "blue" as const, icon: FileCheck2 },
    { label: "Cuadradas", value: ok, tone: "green" as const, icon: CheckCircle2 },
    { label: "Revisar", value: review, tone: review ? "orange" as const : "green" as const, icon: SlidersHorizontal },
    { label: "Con diferencia", value: differences, tone: differences ? "red" as const : "green" as const, icon: Sigma },
    { label: "Diferencia visible", value: formatEuro(totalDifference), tone: totalDifference ? "orange" as const : "green" as const, icon: Sigma },
  ];
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Resumen del cuadre">{metrics.map((metric) => <CompactMetric key={metric.label} variant="card" {...metric} />)}</section>;
}

function BreakdownTable({ rows, onSelect }: Readonly<{ rows: readonly InternalExcelCheckRow[]; onSelect: (row: InternalExcelCheckRow) => void }>) {
  return (
    <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
      <thead><tr>{["Matrícula", "Centro", "Puesto", "Categoría", "Salario periodo", "Salario desglose", "Dif. salario", "C. salarial periodo", "C. salarial desglose", "Dif. C. salarial", "Extrasalarial periodo", "Extrasalarial desglose", "Dif. extrasalarial", "Estado"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.employeeNumber} tabIndex={0} className={cn("cursor-pointer transition", rowTone(row.status))} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
          <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(row.employeeNumber)}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.workplace) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.position) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.category) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryBreakdown)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.salaryDifference))}>{formatEuro(row.salaryDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryComplementPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryComplementBreakdown)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.salaryComplementDifference))}>{formatEuro(row.salaryComplementDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.extraSalaryPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.extraSalaryBreakdown)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.extraSalaryDifference))}>{formatEuro(row.extraSalaryDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={row.status} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function NormalizedTable({ rows, onSelect }: Readonly<{ rows: readonly NormalizedVsRealRow[]; onSelect: (row: NormalizedVsRealRow) => void }>) {
  return (
    <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
      <thead><tr>{["Matrícula", "Persona", "Centro", "Puesto", "Normalizado + variables", "Normalizado", "Periodo completo", "Real PDF", "Dif. PDF / periodo", "Dif. PDF / norm. + variables", "Dif. PDF / normalizado", "Estado"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.employeeNumber} tabIndex={0} className={cn("cursor-pointer transition", rowTone(row.status))} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
          <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(row.employeeNumber)}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.person) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.workplace) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.position) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.normalizedPlusVariables)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.normalized)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.periodComplete)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.realPdf)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.diffPdfVsPeriodComplete))}>{formatEuro(row.diffPdfVsPeriodComplete)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.diffPdfVsNormalizedPlusVariables))}>{formatEuro(row.diffPdfVsNormalizedPlusVariables)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.diffPdfVsNormalized))}>{formatEuro(row.diffPdfVsNormalized)}</td>
          <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={row.status} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function VariablesTable({ rows, onSelect }: Readonly<{ rows: readonly InternalExcelNormalizedVariablesCheckRow[]; onSelect: (row: InternalExcelNormalizedVariablesCheckRow) => void }>) {
  return (
    <table className="w-full min-w-[1500px] border-separate border-spacing-0 text-left text-sm">
      <thead><tr>{["Matrícula", "Persona", "Centro", "Puesto", "Categoría", "Salario periodo", "Salario norm. + variables", "Dif. salario", "C. salarial periodo", "C. salarial norm. + variables", "Dif. C. salarial", "Extrasalarial periodo", "Extrasalarial norm. + variables", "Dif. extrasalarial", "Total periodo", "Total norm. + variables", "Dif. total", "Estado"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.employeeNumber} tabIndex={0} className={cn("cursor-pointer transition", rowTone(row.status))} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
          <td className="border-b border-line/70 px-4 py-3 font-mono">{displayText(row.employeeNumber)}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.person) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.workplace) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.position) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3">{displayText(row.category) || "Sin dato"}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryNormalizedPlusVariables)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.salaryDifference))}>{formatEuro(row.salaryDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryComplementPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.salaryComplementNormalizedPlusVariables)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.salaryComplementDifference))}>{formatEuro(row.salaryComplementDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.extraSalaryPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.extraSalaryNormalizedPlusVariables)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.extraSalaryDifference))}>{formatEuro(row.extraSalaryDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.totalPeriod)}</td>
          <td className="border-b border-line/70 px-4 py-3 text-right font-mono">{formatEuro(row.totalNormalizedPlusVariables)}</td>
          <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono", diffClass(row.totalDifference))}>{formatEuro(row.totalDifference)}</td>
          <td className="border-b border-line/70 px-4 py-3"><StatusBadge value={row.status} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="detail-field"><small>{label}</small><strong>{value}</strong></div>;
}

function DetailContent({ selected }: Readonly<{ selected: SelectedRow }>) {
  if (selected.mode === "breakdown") {
    const row = selected.row;
    return <><div className="detail-grid"><Field label="Matrícula" value={row.employeeNumber} /><Field label="Estado" value={row.status} /><Field label="Centro" value={displayText(row.workplace) || "Sin dato"} /><Field label="Puesto" value={displayText(row.position) || "Sin dato"} /><Field label="Diferencia salario" value={formatEuro(row.salaryDifference)} /><Field label="Diferencia complementos" value={formatEuro(row.salaryComplementDifference)} /><Field label="Diferencia extrasalarial" value={formatEuro(row.extraSalaryDifference)} /></div><div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div></>;
  }
  if (selected.mode === "normalized") {
    const row = selected.row;
    return <><div className="detail-grid"><Field label="Matrícula" value={row.employeeNumber} /><Field label="Estado" value={row.status} /><Field label="Normalizado + variables" value={formatEuro(row.normalizedPlusVariables)} /><Field label="Normalizado" value={formatEuro(row.normalized)} /><Field label="Periodo completo" value={formatEuro(row.periodComplete)} /><Field label="Real PDF" value={formatEuro(row.realPdf)} /><Field label="Dif. PDF / periodo" value={formatEuro(row.diffPdfVsPeriodComplete)} /><Field label="Dif. PDF / normalizado" value={formatEuro(row.diffPdfVsNormalized)} /></div><div className="detail-block"><h3>Posible justificación</h3><p>{displayText(row.possibleJustification) || "No existe una justificación automática."}</p></div><div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div></>;
  }
  const row = selected.row;
  return <><div className="detail-grid"><Field label="Matrícula" value={row.employeeNumber} /><Field label="Estado" value={row.status} /><Field label="Total periodo" value={formatEuro(row.totalPeriod)} /><Field label="Total norm. + variables" value={formatEuro(row.totalNormalizedPlusVariables)} /><Field label="Diferencia total" value={formatEuro(row.totalDifference)} /><Field label="Centro" value={displayText(row.workplace) || "Sin dato"} /></div><div className="detail-block"><h3>Detalle</h3><p>{displayText(row.detail) || "Sin detalle adicional."}</p></div></>;
}

export function CuadreExcelView() {
  const { result, assistantNavigationIntent, consumeAssistantNavigationIntent } = useAppState();
  const [activeMode, setActiveMode] = useState<CuadreMode>("breakdown");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Todos");
  const [selected, setSelected] = useState<SelectedRow>();

  useEffect(() => {
    if (assistantNavigationIntent?.type !== "open_cuadre") return;
    setActiveMode(assistantNavigationIntent.view === "normalized_variables" ? "variables" : "breakdown");
    setQuery(assistantNavigationIntent.personId ?? "");
    consumeAssistantNavigationIntent();
  }, [assistantNavigationIntent, consumeAssistantNavigationIntent]);

  const normalizedQuery = normalizeText(query);
  const breakdownRows = useMemo(() => (result?.internalExcelChecks ?? []).filter((row) => (status === "Todos" || row.status === status) && (!normalizedQuery || [row.employeeNumber, row.workplace, row.position, row.category].some((value) => matches(value, normalizedQuery)))), [normalizedQuery, result?.internalExcelChecks, status]);
  const normalizedRows = useMemo(() => (result?.normalizedVsReal ?? []).filter((row) => (status === "Todos" || row.status === status) && (!normalizedQuery || [row.employeeNumber, row.person, row.workplace, row.position, row.category].some((value) => matches(value, normalizedQuery)))), [normalizedQuery, result?.normalizedVsReal, status]);
  const variablesRows = useMemo(() => (result?.internalExcelNormalizedVariablesChecks ?? []).filter((row) => (status === "Todos" || row.status === status) && (!normalizedQuery || [row.employeeNumber, row.person, row.workplace, row.position, row.category].some((value) => matches(value, normalizedQuery)))), [normalizedQuery, result?.internalExcelNormalizedVariablesChecks, status]);

  if (!result) return <div className="space-y-6"><SectionHeader title="Cuadre del registro" subtitle="Valida el contenido interno del Registro Retributivo." /><EmptyState icon={FileCheck2} title="No hay análisis activo" description="Carga el Registro Retributivo y los recibos para generar el cuadre." /></div>;

  const current = MODES.find((mode) => mode.value === activeMode) ?? MODES[0];
  const visibleRows = activeMode === "breakdown" ? breakdownRows : activeMode === "normalized" ? normalizedRows : variablesRows;
  const totalDifference = activeMode === "breakdown"
    ? breakdownRows.reduce((sum, row) => sum + row.salaryDifference + row.salaryComplementDifference + row.extraSalaryDifference, 0)
    : activeMode === "normalized"
      ? normalizedRows.reduce((sum, row) => sum + row.diffPdfVsPeriodComplete, 0)
      : variablesRows.reduce((sum, row) => sum + row.totalDifference, 0);

  return (
    <div className="space-y-6">
      <SectionHeader title="Cuadre del registro" subtitle="Comprueba la consistencia del Excel desde tres perspectivas complementarias." />
      <SectionTabs label="Vistas de Cuadre del registro" value={activeMode} items={MODES} onValueChange={setActiveMode} />
      <div id={current.panelId} role="tabpanel" aria-labelledby={current.tabId} className="space-y-5">
        <p className="text-sm leading-6 text-muted">{current.description}</p>
        <MetricStrip rows={visibleRows} totalDifference={totalDifference} />
        <DataTableShell toolbar={<Controls query={query} status={status} onQuery={setQuery} onStatus={setStatus} />}>
          {activeMode === "breakdown" ? <BreakdownTable rows={breakdownRows} onSelect={(row) => setSelected({ mode: "breakdown", row })} /> : null}
          {activeMode === "normalized" ? <NormalizedTable rows={normalizedRows} onSelect={(row) => setSelected({ mode: "normalized", row })} /> : null}
          {activeMode === "variables" ? <VariablesTable rows={variablesRows} onSelect={(row) => setSelected({ mode: "variables", row })} /> : null}
          {!visibleRows.length ? <p className="p-6 text-sm text-muted">No hay filas que coincidan con los filtros actuales.</p> : null}
        </DataTableShell>
      </div>
      <DetailDrawer open={Boolean(selected)} title="Detalle del cuadre" description={selected ? `Vista: ${MODES.find((mode) => mode.value === selected.mode)?.label ?? "Cuadre"}` : undefined} onClose={() => setSelected(undefined)}>
        {selected ? <DetailContent selected={selected} /> : null}
      </DetailDrawer>
    </div>
  );
}
