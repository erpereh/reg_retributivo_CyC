"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import type { AnalysisResult } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

const STATUS_COLORS: Record<string, string> = {
  OK: "#15803d",
  Diferencia: "#dc2626",
  Revisar: "#f97316",
  "Sin Registro": "#7c3aed",
  "Sin PDF": "#64748b",
  "Sin mapear": "#c2410c",
};

function ProfessionalChartCard({
  title,
  subtitle,
  badge,
  children,
  className,
}: Readonly<{ title: string; subtitle: string; badge: string; children: React.ReactNode; className?: string }>) {
  return (
    <Card data-testid="professional-chart-card" className={cn("overflow-hidden p-0", className)}>
      <div className="border-b border-line/80 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink text-balance">{title}</h3>
            <p className="mt-1 max-w-xl text-sm leading-5 text-muted text-pretty">{subtitle}</p>
          </div>
          <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary">{badge}</span>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function EmptyChart() {
  return <EmptyState icon={BarChart3} title="Sin datos para graficar" description="Sube nóminas PDF y el Excel Registro para ver diferencias retributivas." />;
}

function countByStatus(result: AnalysisResult): Array<{ name: string; value: number; color: string }> {
  const counts = new Map<string, number>();
  (result.people ?? []).forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1));
  return [...counts.entries()].map(([name, value]) => ({ name, value, color: STATUS_COLORS[name] ?? "#2563eb" }));
}

function EuroTooltip({ active, payload, label }: Readonly<{ active?: boolean; payload?: readonly { value?: number; name?: string }[]; label?: string }>) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm shadow-lift">
      <p className="font-semibold text-ink">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="mt-1 text-muted">
          {entry.name}: <span className="font-semibold text-ink tabular-nums">{typeof entry.value === "number" ? formatEuro(entry.value) : entry.value}</span>
        </p>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: Readonly<{ active?: boolean; payload?: readonly { value?: number; name?: string }[]; label?: string }>) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm shadow-lift">
      <p className="font-semibold text-ink">{label}</p>
      <p className="mt-1 text-muted">
        Personas: <span className="font-semibold text-ink tabular-nums">{payload[0]?.value ?? 0}</span>
      </p>
    </div>
  );
}

function StatusDonut({ rows, animate }: Readonly<{ rows: Array<{ name: string; value: number; color: string }>; animate: boolean }>) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="grid items-center gap-4 md:grid-cols-[220px_1fr]">
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={3} isAnimationActive={animate} animationDuration={650}>
              {rows.map((row) => (
                <Cell key={row.name} fill={row.color} />
              ))}
            </Pie>
            <Tooltip content={<CountTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold text-ink tabular-nums">{total}</span>
          <span className="text-xs font-semibold uppercase text-muted">personas</span>
        </div>
      </div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />
              {row.name}
            </span>
            <span className="font-mono text-sm font-semibold text-ink">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeparatedAmounts({ rows }: Readonly<{ rows: Array<{ name: string; value: number; tone: string }> }>) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-muted">
        No se suman: cada importe representa un ámbito diferente de revisión.
      </p>
      {rows.map((row) => (
        <div key={row.name} className="rounded-2xl border border-line bg-white p-4 shadow-subtle">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-ink">{row.name}</span>
            <span className="font-mono text-sm font-semibold text-ink tabular-nums">{formatEuro(row.value)}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.max(Math.abs(row.value) / max, 0.03) }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn("h-full origin-left rounded-full", row.tone)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartsPanel({ result }: Readonly<{ result?: AnalysisResult }>) {
  const reduceMotion = useReducedMotion();
  if (!result) {
    return <EmptyChart />;
  }

  const animate = !reduceMotion;
  const statusRows = countByStatus(result);
  const byBlock = [
    { name: "Salario", value: result.summary.matchedSalaryDifference ?? result.summary.totalSalaryDifference },
    { name: "C. Salarial", value: result.summary.matchedSalaryComplementDifference ?? result.summary.totalSalaryComplementDifference },
    { name: "Extrasalarial", value: result.summary.matchedExtraSalaryDifference ?? result.summary.totalExtraSalaryDifference },
  ];
  const separatedAmounts = [
    { name: "Dif. matched", value: result.summary.matchedTotalDifference ?? result.summary.totalGlobalDifference, tone: "bg-primary" },
    { name: "Pendiente decisión", value: result.summary.pendingDecisionPdfTotal ?? result.summary.pendingReviewAmount ?? 0, tone: "bg-orange-500" },
    { name: "PDF sin Registro", value: result.summary.totalPdfWithoutRegistro ?? 0, tone: "bg-violet-600" },
  ];
  const topPeople = [...(result.people ?? [])]
    .sort((a, b) => Math.abs(b.totalDifference) - Math.abs(a.totalDifference))
    .slice(0, 10)
    .map((item) => ({
      name: `${item.employeeNumber}${item.person ? ` · ${item.person}` : ""}`,
      value: Math.abs(item.totalDifference),
    }));

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ProfessionalChartCard title="Estado de personas" subtitle="Vista compacta del estado operativo de las filas de personas." badge="Estado">
        {statusRows.length ? <StatusDonut rows={statusRows} animate={animate} /> : <EmptyChart />}
      </ProfessionalChartCard>

      <ProfessionalChartCard title="Diferencias matched por bloque" subtitle="Solo personas encontradas en Registro y PDF; positivos y negativos se mantienen visibles." badge="EUR">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byBlock} margin={{ top: 10, right: 10, bottom: 4, left: -4 }}>
              <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis width={64} tickLine={false} axisLine={false} />
              <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.06)" }} />
              <Bar dataKey="value" name="Diferencia" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={650}>
                {byBlock.map((row) => (
                  <Cell key={row.name} fill={row.value < 0 ? "#be123c" : "#2563eb"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ProfessionalChartCard>

      <ProfessionalChartCard title="Top diferencias" subtitle="Ranking de diferencias absolutas para priorizar revisión manual." badge="Top 10">
        {topPeople.length ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPeople} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 22 }}>
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 6" horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" width={126} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.06)" }} />
                <Bar dataKey="value" name="Diferencia absoluta" fill="#60a5fa" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={650} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState icon={BarChart3} title="Sin diferencias" description="No hay diferencias para ordenar con el análisis activo." />
        )}
      </ProfessionalChartCard>

      <ProfessionalChartCard title="Importes separados" subtitle="Comparación visual entre matched, pendiente y PDF sin Registro sin mezclar ámbitos." badge="No se suman">
        <SeparatedAmounts rows={separatedAmounts} />
      </ProfessionalChartCard>
    </section>
  );
}
