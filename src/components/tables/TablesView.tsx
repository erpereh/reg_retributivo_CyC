"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppState, type DashboardFilters, matchesQuery } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { StatCard } from "@/components/common/StatCard";
import type { AnalysisError, FieldIssue, SalaryDifference } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: Readonly<{ label: string; value: string; values: readonly string[]; onChange: (value: string) => void }>) {
  return (
    <label className="text-sm font-semibold text-ink">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="filter-control mt-2">
        <option value="">Todos</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function FiltersPanel({
  filters,
  centers,
  groups,
  gts,
  onChange,
}: Readonly<{
  filters: DashboardFilters;
  centers: readonly string[];
  groups: readonly string[];
  gts: readonly string[];
  onChange: (filters: DashboardFilters) => void;
}>) {
  return (
    <Card className="p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="text-sm font-semibold text-ink xl:col-span-2">
          Buscar
          <span className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => onChange({ ...filters, query: event.target.value })}
              placeholder="Nombre, NIF o matrícula"
              className="filter-control pl-11"
            />
          </span>
        </label>
        <SelectField label="Centro" value={filters.center} values={centers} onChange={(center) => onChange({ ...filters, center })} />
        <SelectField label="Grupo profesional" value={filters.group} values={groups} onChange={(group) => onChange({ ...filters, group })} />
        <SelectField label="GT" value={filters.gt} values={gts} onChange={(gt) => onChange({ ...filters, gt })} />
        <label className="text-sm font-semibold text-ink">
          Severidad / Estado
          <select
            value={`${filters.severity}|${filters.status}`}
            onChange={(event) => {
              const [severity, status] = event.target.value.split("|");
              onChange({ ...filters, severity, status });
            }}
            className="filter-control mt-2"
          >
            <option value="|">Todos</option>
            <option value="Alta|">Alta</option>
            <option value="Media|">Media</option>
            <option value="Baja|">Baja</option>
            <option value="|OK">OK</option>
            <option value="|Revisar">Revisar</option>
            <option value="|Incidencia">Incidencia</option>
            <option value="|Falta en Registro">Falta en Registro</option>
          </select>
        </label>
      </div>
    </Card>
  );
}

function Difference({ value }: Readonly<{ value?: number }>) {
  const number = value ?? 0;
  return (
    <span className={cn("font-mono font-semibold tabular-nums", number > 0 && "text-danger", number < 0 && "text-success")}>
      {formatEuro(number)}
    </span>
  );
}

function DetailButton({ open, onClick }: Readonly<{ open: boolean; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs font-semibold text-ink transition hover:bg-blue-50">
      Ver detalle
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}

function IssuesTable({ issues }: Readonly<{ issues: readonly FieldIssue[] }>) {
  const [expanded, setExpanded] = useState<string | undefined>();
  const headers = [
    "NIF",
    "Persona",
    "Matrícula",
    "Campo",
    "Debería estar",
    "Como está",
    "Salario debería",
    "Salario está",
    "Diferencia",
    "Periodos",
    "Severidad",
    "Observaciones",
    "Acción recomendada",
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold text-ink">Campos mal</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {headers.map((header) => (
                <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => {
              const key = `${issue.workerNif}-${issue.field}-${index}`;
              const open = expanded === key;
              return (
                <motion.tr
                  key={key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(index * 0.015, 0.18) }}
                  className="group align-top transition-colors hover:bg-blue-50/70"
                >
                  <td className="border-b border-line/70 px-4 py-4 font-mono tabular-nums">{issue.workerNif}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-semibold">{issue.workerName}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono tabular-nums">{issue.employeeNumber}</td>
                  <td className="border-b border-line/70 px-4 py-4">{issue.field}</td>
                  <td className="max-w-[190px] border-b border-line/70 px-4 py-4">{issue.shouldBe}</td>
                  <td className="max-w-[190px] border-b border-line/70 px-4 py-4">{issue.actual}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono tabular-nums">{formatEuro(issue.salaryShouldBe)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono tabular-nums">{formatEuro(issue.salaryActual)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right"><Difference value={issue.salaryDifference} /></td>
                  <td className="max-w-[170px] border-b border-line/70 px-4 py-4">{issue.affectedPeriods.join("; ")}</td>
                  <td className="border-b border-line/70 px-4 py-4"><Badge value={issue.severity} /></td>
                  <td className="max-w-[220px] border-b border-line/70 px-4 py-4">
                    <p className="line-clamp-2 text-muted">{issue.observations}</p>
                    <DetailButton open={open} onClick={() => setExpanded(open ? undefined : key)} />
                    <AnimatePresence>
                      {open ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <p className="mt-3 rounded-2xl bg-white p-3 text-sm leading-6 text-ink shadow-subtle">{issue.observations}</p>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </td>
                  <td className="max-w-[220px] border-b border-line/70 px-4 py-4 text-muted">
                    <p className="line-clamp-3">{issue.recommendedAction}</p>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
        {!issues.length ? <p className="p-6 text-sm text-muted">Sin incidencias con los filtros actuales.</p> : null}
      </div>
    </Card>
  );
}

function SalaryTable({ rows }: Readonly<{ rows: readonly SalaryDifference[] }>) {
  const [expanded, setExpanded] = useState<string | undefined>();
  const headers = [
    "Estado",
    "NIF",
    "Persona",
    "Matrícula",
    "Centro",
    "Grupo profesional",
    "GT",
    "Total debería",
    "Total está",
    "Diferencia",
    "Nº nóminas",
    "Periodos",
    "Observaciones",
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold text-ink">Diferencia salarial</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1420px] border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {headers.map((header) => (
                <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = `${row.workerNif}-${row.employeeNumber}-${index}`;
              const open = expanded === key;
              return (
                <motion.tr
                  key={key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(index * 0.015, 0.18) }}
                  className="align-top transition-colors hover:bg-blue-50/70"
                >
                  <td className="border-b border-line/70 px-4 py-4"><Badge value={row.status} /></td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono tabular-nums">{row.workerNif}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-semibold">{row.workerName}</td>
                  <td className="border-b border-line/70 px-4 py-4 font-mono tabular-nums">{row.employeeNumber}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.workplace}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.professionalGroup}</td>
                  <td className="border-b border-line/70 px-4 py-4">{row.gt}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono tabular-nums">{formatEuro(row.totalShouldBe)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono tabular-nums">{formatEuro(row.totalActual)}</td>
                  <td className="border-b border-line/70 px-4 py-4 text-right"><Difference value={row.difference} /></td>
                  <td className="border-b border-line/70 px-4 py-4 text-right font-mono tabular-nums">{row.payrollCount}</td>
                  <td className="max-w-[180px] border-b border-line/70 px-4 py-4">{row.periodsIncluded.join("; ")}</td>
                  <td className="max-w-[240px] border-b border-line/70 px-4 py-4">
                    <p className="line-clamp-2 text-muted">{row.observations}</p>
                    <DetailButton open={open} onClick={() => setExpanded(open ? undefined : key)} />
                    <AnimatePresence>
                      {open ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <p className="mt-3 rounded-2xl bg-white p-3 text-sm leading-6 text-ink shadow-subtle">{row.observations}</p>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? <p className="p-6 text-sm text-muted">No hay diferencias salariales con los filtros actuales.</p> : null}
      </div>
    </Card>
  );
}

function ProcessingErrors({ errors }: Readonly<{ errors: readonly AnalysisError[] }>) {
  if (!errors.length) {
    return null;
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold text-ink">Errores de procesamiento</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {["Archivo", "Tipo", "Mensaje", "Acción recomendada"].map((header) => (
                <th key={header} className="border-b border-line px-4 py-3 text-xs font-semibold uppercase">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {errors.map((error, index) => (
              <tr key={`${error.file}-${index}`} className="transition-colors hover:bg-blue-50/70">
                <td className="border-b border-line/70 px-4 py-4 font-semibold">{error.file}</td>
                <td className="border-b border-line/70 px-4 py-4"><Badge value={error.type} /></td>
                <td className="border-b border-line/70 px-4 py-4">{error.message}</td>
                <td className="border-b border-line/70 px-4 py-4 text-muted">{error.recommendedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function TablesView() {
  const { result, filters, setFilters } = useAppState();

  const options = useMemo(
    () => ({
      centers: unique(result?.salaryDifferences.map((item) => item.workplace) ?? []),
      groups: unique(result?.salaryDifferences.map((item) => item.professionalGroup) ?? []),
      gts: unique(result?.salaryDifferences.map((item) => item.gt) ?? []),
    }),
    [result],
  );

  const salaryMeta = useMemo(() => {
    const map = new Map<string, SalaryDifference>();
    result?.salaryDifferences.forEach((item) => {
      map.set(item.workerNif, item);
    });
    return map;
  }, [result]);

  const filteredIssues = useMemo(() => {
    return (result?.fieldIssues ?? []).filter((issue) => {
      const meta = salaryMeta.get(issue.workerNif);
      if (!matchesQuery([issue.workerNif, issue.workerName, issue.employeeNumber], filters.query)) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.center && meta?.workplace !== filters.center) return false;
      if (filters.group && meta?.professionalGroup !== filters.group) return false;
      if (filters.gt && meta?.gt !== filters.gt) return false;
      return true;
    });
  }, [filters, result?.fieldIssues, salaryMeta]);

  const filteredSalary = useMemo(() => {
    return (result?.salaryDifferences ?? []).filter((item) => {
      if (!matchesQuery([item.workerNif, item.workerName, item.employeeNumber], filters.query)) return false;
      if (filters.center && item.workplace !== filters.center) return false;
      if (filters.group && item.professionalGroup !== filters.group) return false;
      if (filters.gt && item.gt !== filters.gt) return false;
      if (filters.status && item.status !== filters.status) return false;
      return true;
    });
  }, [filters, result?.salaryDifferences]);

  const peopleAffected = new Set([
    ...filteredIssues.map((issue) => issue.workerNif),
    ...filteredSalary.filter((item) => item.status !== "OK").map((item) => item.workerNif),
  ]).size;

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Tablas de revisión"
          subtitle="Consulta las incidencias detectadas y las diferencias salariales."
        />
        <EmptyState
          icon={Table2}
          title="No hay análisis activo"
          description="Completa un análisis o abre uno desde el historial para revisar las tablas."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Tablas de revisión"
        subtitle="Consulta las incidencias detectadas y las diferencias salariales."
      />
      <FiltersPanel filters={filters} centers={options.centers} groups={options.groups} gts={options.gts} onChange={setFilters} />
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total incidencias visibles" value={filteredIssues.length} detail="Campos mal con filtros" icon={Table2} index={0} />
        <StatCard
          label="Diferencia visible"
          value={formatEuro(filteredSalary.reduce((sum, item) => sum + item.difference, 0))}
          detail="Suma de filas visibles"
          icon={Table2}
          index={1}
        />
        <StatCard label="Personas afectadas visibles" value={peopleAffected} detail="Con incidencia o diferencia" icon={Table2} index={2} />
      </section>
      <IssuesTable issues={filteredIssues} />
      <SalaryTable rows={filteredSalary} />
      <ProcessingErrors errors={result.errors} />
    </div>
  );
}
