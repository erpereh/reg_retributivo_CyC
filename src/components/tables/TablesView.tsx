"use client";

import { Search, Table2 } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { useAppState, type DashboardFilters, matchesQuery } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import type { AppView } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
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
          Puesto / categoría
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
    </Card>
  );
}

function DetailButton({ detail }: Readonly<{ detail: string }>) {
  return (
    <button type="button" title={detail} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-ink transition hover:bg-blue-50">
      Detalle
    </button>
  );
}

function PersonasTable() {
  const { result, filters } = useAppState();
  const rows = useMemo(
    () =>
      (result?.people ?? []).filter((item) => {
        if (!matchesQuery([item.employeeNumber, item.person, item.workplace, item.position, item.category], filters.query)) return false;
        if (filters.center && item.workplace !== filters.center) return false;
        if (filters.group && item.position !== filters.group && item.category !== filters.group) return false;
        if (filters.status && item.status !== filters.status) return false;
        return true;
      }),
    [filters, result?.people],
  );

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {[
                "Matrícula",
                "Persona",
                "Centro",
                "Puesto",
                "Categoría",
                "Salario Registro",
                "Salario PDF",
                "Dif.",
                "C. Salarial Registro",
                "C. Salarial PDF",
                "Dif.",
                "Extrasalarial Registro",
                "Extrasalarial PDF",
                "Dif.",
                "Total Registro",
                "Total PDF",
                "Dif. Total",
                "Estado",
                "Detalle",
              ].map((header) => (
                <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <motion.tr key={row.employeeNumber} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, delay: Math.min(index * 0.01, 0.16) }} className="hover:bg-blue-50/70">
                <td className="border-b border-line/70 px-4 py-4 font-mono">{row.employeeNumber}</td>
                <td className="border-b border-line/70 px-4 py-4 font-semibold">{row.person}</td>
                <td className="border-b border-line/70 px-4 py-4">{row.workplace}</td>
                <td className="border-b border-line/70 px-4 py-4">{row.position}</td>
                <td className="border-b border-line/70 px-4 py-4">{row.category}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryRegistro)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryPdf)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryDifference)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryComplementRegistro)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryComplementPdf)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.salaryComplementDifference)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.extraSalaryRegistro)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.extraSalaryPdf)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.extraSalaryDifference)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.registroTotal)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.pdfTotal)}</td>
                <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.totalDifference)}</td>
                <td className="border-b border-line/70 px-4 py-4"><Badge value={row.status} /></td>
                <td className="border-b border-line/70 px-4 py-4"><DetailButton detail={`${row.detail}\nPeriodos: ${row.periods.join("; ")}\nArchivos: ${row.files.join("; ")}`} /></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="p-6 text-sm text-muted">Sin personas con los filtros actuales.</p> : null}
      </div>
    </Card>
  );
}

function ConceptosTable() {
  const { result, filters } = useAppState();
  const rows = useMemo(
    () =>
      (result?.concepts ?? []).filter((item) => {
        if (!matchesQuery([item.employeeNumber, item.person, item.block, item.registroCode, item.pdfConcept], filters.query)) return false;
        if (filters.status && item.status !== filters.status) return false;
        return true;
      }),
    [filters, result?.concepts],
  );
  const unmapped = result?.unmappedConcepts ?? [];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Conceptos comparados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-muted">
              <tr>{["Matrícula", "Persona", "Bloque", "Código Registro", "Concepto PDF", "Registro", "PDF", "Diferencia", "Estado", "Detalle"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.employeeNumber}-${row.registroCode}-${index}`} className="hover:bg-blue-50/70">
                  <td className="border-b border-line/70 px-4 py-4 font-mono">{row.employeeNumber}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-semibold">{row.person}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.block}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono">{row.registroCode}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.pdfConcept}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.registroAmount)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.pdfAmount)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.difference)}</td>
                  <td className="border-b border-line/70 px-4 py-4"><Badge value={row.status} /></td>
                  <td className="border-b border-line/70 px-4 py-4"><DetailButton detail={row.detail} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="p-6 text-sm text-muted">Sin conceptos comparados con los filtros actuales.</p> : null}
        </div>
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Conceptos no incluidos</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left text-sm">
            <thead className="bg-slate-50 text-muted">
              <tr>{["Tipo decision", "Incluido", "Concepto PDF", "Total detectado", "Personas", "Nominas", "Ejemplos", "Sugerencia bloque", "Sugerencia codigo", "Accion recomendada", "Motivo"].map((header) => <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">{header}</th>)}</tr>
            </thead>
            <tbody>
              {unmapped.map((row) => (
                <tr key={row.pdfConcept} className="hover:bg-blue-50/70">
                  <td className="border-b border-line/70 px-4 py-4"><Badge value={row.decisionType ?? (row.action === "Ignorado" ? "Ignorado" : "Sin mapear real")} /></td>
                  <td className="border-b border-line/70 px-4 py-4">{row.includedInComparison ? "Si" : "No"}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-semibold">{row.pdfConcept}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{formatEuro(row.totalDetected)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{row.peopleCount}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono">{row.payrollCount}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono">{row.exampleEmployeeNumbers.join("; ")}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.suggestedBlock}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono">{row.suggestedRegistroCode}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.recommendedAction ?? row.action}</td>
                  <td className="border-b border-line/70 px-4 py-4"><DetailButton detail={row.reason ?? ""} /></td>
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
      title={rows.length ? "Agrupaciones calculadas" : "Pendiente de implementacion"}
      description="La primera fase prioriza Registro vs PDF, conceptos y normalizado vs real. Las agrupaciones se implementan despues sin bloquear la validacion de importes."
    />
  );
}

export function TablesView({ mode }: Readonly<{ mode: Extract<AppView, "personas" | "conceptos" | "agrupaciones"> }>) {
  const { result, filters, setFilters } = useAppState();
  const people = result?.people ?? [];
  const centers = unique(people.map((item) => item.workplace));
  const groups = unique(people.flatMap((item) => [item.position, item.category]));

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Revisión retributiva" subtitle="Completa un análisis para revisar diferencias por matrícula." />
        <EmptyState icon={Table2} title="No hay análisis activo" description="Sube el Registro y los PDF para generar la comparativa." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={mode === "personas" ? "Personas" : mode === "conceptos" ? "Conceptos" : "Agrupaciones"}
        subtitle="Tablas compactas; los periodos, archivos y detalles largos quedan en el botón Detalle."
      />
      {mode !== "agrupaciones" ? <FiltersPanel filters={filters} centers={centers} groups={groups} onChange={setFilters} /> : null}
      {mode === "personas" ? <PersonasTable /> : mode === "conceptos" ? <ConceptosTable /> : <AgrupacionesTable />}
    </div>
  );
}
