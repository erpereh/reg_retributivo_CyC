"use client";

import { CheckCircle2, Copy, FileCheck2, Sigma, Table2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { AiExplanationPanel } from "@/components/ai/AiExplanationPanel";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import { buildInternalExcelExplainPayload } from "@/lib/ai/explainPayload";
import type { InternalExcelCheckRow } from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

interface SummaryMetric {
  readonly label: string;
  readonly value: string | number;
  readonly tone: "blue" | "green" | "orange" | "red";
}

const TONE_CLASS: Record<SummaryMetric["tone"], string> = {
  blue: "bg-blue-50 text-primary",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
};

const HEADERS = [
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

  const copySummary = `Cuadre Excel ${row.employeeNumber}: ${row.status} - ${displayText(row.detail)}`;
  const aiPayload = buildInternalExcelExplainPayload(row);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Detalle cuadre Excel"
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
            <h2 className="mt-1 text-2xl font-semibold text-ink text-balance">Detalle cuadre Excel</h2>
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

export function CuadreExcelView() {
  const { result } = useAppState();
  const rows = result?.internalExcelChecks ?? [];
  const [selectedRow, setSelectedRow] = useState<InternalExcelCheckRow | undefined>();

  const summary = useMemo(() => {
    const ok = rows.filter((row) => row.status === "OK").length;
    const differenceRows = rows.filter((row) => row.status === "Diferencia").length;
    const salary = rows.reduce((sum, row) => sum + row.salaryDifference, 0);
    const salaryComplement = rows.reduce((sum, row) => sum + row.salaryComplementDifference, 0);
    const extraSalary = rows.reduce((sum, row) => sum + row.extraSalaryDifference, 0);

    return { ok, differenceRows, salary, salaryComplement, extraSalary };
  }, [rows]);

  const metrics: SummaryMetric[] = [
    { label: "Empleados comprobados", value: rows.length, tone: "blue" },
    { label: "Empleados OK", value: summary.ok, tone: "green" },
    { label: "Empleados con diferencia", value: summary.differenceRows, tone: summary.differenceRows ? "red" : "green" },
    { label: "Diferencia total Salario", value: formatEuro(summary.salary), tone: summary.salary ? "red" : "green" },
    { label: "Diferencia total C. Salarial", value: formatEuro(summary.salaryComplement), tone: summary.salaryComplement ? "red" : "green" },
    { label: "Diferencia total Extrasalarial", value: formatEuro(summary.extraSalary), tone: summary.extraSalary ? "red" : "green" },
  ];

  if (!result) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Cuadre interno del Excel" subtitle="Valida que las retribuciones del periodo completo cuadran con el desglose de conceptos del Registro." />
        <EmptyState icon={FileCheck2} title="No hay análisis activo" description="Sube el Registro y los PDF para generar la comparativa." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Cuadre interno del Excel"
        subtitle="Valida que las retribuciones del periodo completo cuadran con el desglose de conceptos del Registro."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric, index) => (
          <MetricCard key={metric.label} metric={metric} index={index} />
        ))}
      </section>

      {rows.length && summary.ok === rows.length ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-subtle">
          El Excel cuadra internamente con su desglose de conceptos.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink text-balance">Detalle del cuadre interno</h2>
        </div>
        <div className="max-h-[70dvh] overflow-auto">
          <table className="w-full min-w-[1440px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
              <tr>
                {HEADERS.map((header, index) => (
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
                  onClick={() => setSelectedRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelectedRow(row);
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
                  <td className={cn("border-b border-line/70 px-4 py-3 text-right font-mono tabular-nums", diffClass(row.extraSalaryDifference))}>
                    {formatEuro(row.extraSalaryDifference)}
                  </td>
                  <td className="border-b border-line/70 px-4 py-3">
                    <Badge value={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="p-6 text-sm text-muted">No hay filas de cuadre interno en el análisis activo.</p> : null}
        </div>
      </Card>

      {selectedRow ? <DetailModal row={selectedRow} onClose={() => setSelectedRow(undefined)} /> : null}
    </div>
  );
}
