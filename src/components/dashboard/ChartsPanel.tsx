"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import type { AnalysisResult } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";

function ChartCard({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <Card className="min-h-[320px] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-muted">{subtitle}</p>
        </div>
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
      description="Sube nÃ³minas PDF y el Excel Registro para ver diferencias retributivas."
    />
  );
}

function countByStatus(result: AnalysisResult): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  (result.people ?? []).forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1));
  return [...counts.entries()].map(([name, value]) => ({ name, value }));
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
          {entry.name}: <span className="font-semibold text-ink">{typeof entry.value === "number" ? formatEuro(entry.value) : entry.value}</span>
        </p>
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
  const byBlock = [
    { name: "Salario", value: result.summary.matchedSalaryDifference ?? result.summary.totalSalaryDifference },
    { name: "C. Salarial", value: result.summary.matchedSalaryComplementDifference ?? result.summary.totalSalaryComplementDifference },
    { name: "Extrasalarial", value: result.summary.matchedExtraSalaryDifference ?? result.summary.totalExtraSalaryDifference },
  ];
  const separatedAmounts = [
    { name: "Dif. matched", value: result.summary.matchedTotalDifference ?? result.summary.totalGlobalDifference },
    { name: "Pendiente decision", value: result.summary.pendingDecisionPdfTotal ?? result.summary.pendingReviewAmount ?? 0 },
    { name: "PDF sin Registro", value: result.summary.totalPdfWithoutRegistro ?? 0 },
  ];
  const topPeople = [...(result.people ?? [])]
    .sort((a, b) => Math.abs(b.totalDifference) - Math.abs(a.totalDifference))
    .slice(0, 10)
    .map((item) => ({ name: item.employeeNumber, value: Math.abs(item.totalDifference) }));
  const pdfWithoutRegistro = [...(result.pdfWithoutRegistro ?? [])]
    .sort((a, b) => Math.abs(b.pdfTotal) - Math.abs(a.pdfTotal))
    .slice(0, 10)
    .map((item) => ({ name: item.employeeNumber, value: item.pdfTotal }));
  const nonIncludedByDecision = (result.unmappedConcepts ?? []).reduce<Array<{ name: string; value: number }>>((rows, item) => {
    const name = item.decisionType ?? (item.action === "Ignorado" ? "Ignorado" : "Sin mapear real");
    const existing = rows.find((row) => row.name === name);
    if (existing) {
      existing.value += 1;
    } else {
      rows.push({ name, value: 1 });
    }
    return rows;
  }, []);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Personas por estado" subtitle="Distribucion de filas de personas sin mezclar importes.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={countByStatus(result)} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" name="Personas" fill="#2563EB" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Diferencias matched por bloque" subtitle="Solo personas encontradas en Registro y PDF.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byBlock} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis width={58} tickLine={false} axisLine={false} />
            <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.08)" }} />
            <Bar dataKey="value" name="Diferencia" fill="#0F172A" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Importes separados" subtitle="Matched, pendiente y PDF sin Registro se muestran separados; no se suman.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={separatedAmounts} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis width={58} tickLine={false} axisLine={false} />
            <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Legend />
            <Bar dataKey="value" name="Importe separado" fill="#2563EB" radius={[8, 8, 8, 8]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Top 10 diferencias absolutas" subtitle="Ranking visual; no altera el calculo matched.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topPeople} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} />
            <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(37, 99, 235, 0.08)" }} />
            <Bar dataKey="value" name="Diferencia absoluta" fill="#60A5FA" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Conceptos no incluidos por tipo" subtitle="Pendientes, ignorados y sin mapear reales se distinguen por tipo.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={nonIncludedByDecision} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" width={135} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "rgba(239, 68, 68, 0.08)" }} />
            <Bar dataKey="value" name="Conceptos" fill="#F97316" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={550} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="PDF sin Registro por importe" subtitle="Importes fuera del matched porque la matricula no existe en Registro.">
        {pdfWithoutRegistro.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pdfWithoutRegistro} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#E5E7EB" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" width={92} tickLine={false} axisLine={false} />
              <Tooltip content={<EuroTooltip />} cursor={{ fill: "rgba(124, 58, 237, 0.08)" }} />
              <Bar dataKey="value" name="PDF sin Registro" fill="#7C3AED" radius={[0, 8, 8, 0]} isAnimationActive={animate} animationDuration={550} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState icon={BarChart3} title="Sin PDF fuera de Registro" description="No hay matriculas PDF pendientes fuera de Registro." />
        )}
      </ChartCard>
    </section>
  );
}
