"use client";

import { Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useAppState } from "@/components/app/AppState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { ChartsPanel } from "@/components/dashboard/ChartsPanel";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { UploadPanel } from "@/components/upload/UploadPanel";

function formatDate(value?: string): string {
  if (!value) return "Sin análisis activo";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DashboardView() {
  const { activeAnalysis, result, aiStatus } = useAppState();
  const aiBadge = aiStatus?.configured && aiStatus.enabled ? "IA disponible" : "IA no configurada";
  const excludedCount = result?.excludedEmployeeIdsApplied?.length ?? 0;

  return (
    <div className="flex flex-col gap-6" data-surface="dashboard-view">
      <section className="dashboard-hero">
        <div className="dashboard-hero__glow" aria-hidden="true" />
        <div className="dashboard-hero__content">
          <span className="dashboard-hero__tag"><Sparkles className="size-3.5" /> Comparativa automatizada</span>
          <SectionHeader
            title="Comparativa Recibos vs Registro Retributivo"
            subtitle="Importa los documentos, valida el cuadre y revisa las diferencias sin alterar la lógica salarial ni exponer datos sensibles."
            actions={activeAnalysis ? (
              <Card className="analysis-active-card px-3.5 py-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-indigo-50 text-primary">
                  <Clock3 className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Análisis activo</p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">{formatDate(activeAnalysis.createdAt)}</p>
                </div>
                <StatusBadge value={aiBadge} />
              </Card>
            ) : undefined}
          />
          <div className="dashboard-hero__trust">
            <span><ShieldCheck className="size-4" /> Procesamiento local</span>
            <span><ShieldCheck className="size-4" /> Sin datos bancarios</span>
            <span><ShieldCheck className="size-4" /> Cálculo determinista</span>
          </div>
        </div>
      </section>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.3 }}>
        <UploadPanel />
      </motion.div>

      {excludedCount ? (
        <p className="inline-flex self-start rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-muted shadow-subtle">
          Exclusiones aplicadas: {excludedCount} matrículas
        </p>
      ) : null}

      <SummaryCards summary={result?.summary} internalExcelChecks={result?.internalExcelChecks} />
      <ChartsPanel result={result} />
    </div>
  );
}
