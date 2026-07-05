"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import type { AnalysisResult } from "@/lib/types";

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card className="min-h-[310px] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-muted">Retributivo</span>
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
      description="Sube nóminas PDF y el Excel Registro para ver diferencias retributivas."
    />
  );
}

function countByStatus(result: AnalysisResult): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  (result.people ?? []).forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1));
  return [...counts.entries()].map(([name, value]) => ({ name, value }));
}

export function ChartsPanel({ result }: Readonly<{ result?: AnalysisResult }>) {
  const reduceMotion = useReducedMotion();
  if (!result) {
    return <EmptyChart />;
  }

  const animate = !reduceMotion;
  const byBlock = [
    { name: "Salario", value: result.summary.totalSalaryDifference },
    { name: "C. Salarial", value: result.summary.totalSalaryComplementDifference },
    { name: "Extrasalarial", value: result.summary.totalExtraSalaryDifference },
  ];
  const topPeople = [...(result.people ?? [])]
    .sort((a, b) => Math.abs(b.totalDifference) - Math.abs(a.totalDifference))
    .slice(0, 10)
    .map((item) => ({ name: item.employeeNumber, value: Math.abs(item.totalDifference) }));
  const unmapped = (result.unmappedConcepts ?? []).slice(0, 10).map((item) => ({ name: item.pdfConcept, value: Math.abs(item.totalDetected) }));

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Personas por estado">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={countByStatus(result)} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" fill="#2563EB" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Diferencias por bloque">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byBlock} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis width={48} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(15, 23, 42, 0.08)" }} />
            <Bar dataKey="value" fill="#0F172A" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Top 10 diferencias absolutas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topPeople} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" fill="#60A5FA" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Conceptos sin mapear por importe">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={unmapped} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={120} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(239, 68, 68, 0.08)" }} />
            <Bar dataKey="value" fill="#EF4444" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}
