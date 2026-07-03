"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import type { AnalysisResult } from "@/lib/types";

function countBy<T>(items: readonly T[], getKey: (item: T) => string | undefined): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item) || "Sin dato";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card className="min-h-[310px] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-muted">Resumen</span>
      </div>
      <div className="h-56">{children}</div>
    </Card>
  );
}

function EmptyChart() {
  return (
    <EmptyState
      icon={BarChart3}
      title="Sin datos para graficar"
      description="Sube nóminas PDF y el Excel Registro para ver incidencias, severidades y diferencias por centro."
    />
  );
}

export function ChartsPanel({ result }: Readonly<{ result?: AnalysisResult }>) {
  const reduceMotion = useReducedMotion();
  if (!result) {
    return <EmptyChart />;
  }

  const byField = countBy(result.fieldIssues, (item) => item.field);
  const bySeverity = countBy(result.fieldIssues, (item) => item.severity);
  const byStatus = countBy(result.salaryDifferences, (item) => item.status);
  const byCenter = countBy(result.salaryDifferences.filter((item) => item.status !== "OK"), (item) => item.workplace);
  const animate = !reduceMotion;

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Incidencias por campo">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byField} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" fill="#2563EB" radius={[10, 10, 10, 10]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Severidad">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bySeverity} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(239, 68, 68, 0.08)" }} />
            <Bar dataKey="value" fill="#EF4444" radius={[10, 10, 10, 10]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Estado salarial">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byStatus} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" fill="#0F172A" radius={[10, 10, 10, 10]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Incidencias por centro">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byCenter} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" fill="#60A5FA" radius={[0, 10, 10, 0]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}
