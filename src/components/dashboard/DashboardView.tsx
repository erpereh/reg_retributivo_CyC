"use client";

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  FileText,
  History,
  ShieldCheck,
  Sparkles,
  Tags,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ChartsPanel } from "@/components/dashboard/ChartsPanel";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { UploadPanel } from "@/components/upload/UploadPanel";
import type { AppView } from "@/lib/types";

function formatDate(value?: string): string {
  if (!value) return "Sin análisis activo";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const ONBOARDING_STEPS = [
  { icon: FileText, title: "Carga los recibos", description: "Selecciona uno o varios PDF de nómina." },
  { icon: FileSpreadsheet, title: "Añade el Registro Retributivo", description: "Sube el Excel que quieres validar." },
  { icon: CheckCircle2, title: "Ejecuta el análisis", description: "La aplicación compara, agrupa y explica los resultados." },
] as const;

const QUICK_ACTIONS: readonly { view: AppView; label: string; description: string; icon: typeof UsersRound }[] = [
  { view: "personas", label: "Revisar personas", description: "Consulta diferencias individuales y fuentes.", icon: UsersRound },
  { view: "conceptos", label: "Revisar conceptos", description: "Filtra mapeos, justificaciones y pendientes.", icon: Tags },
  { view: "cuadre-excel", label: "Abrir Cuadre", description: "Valida desglose, normalizados y variables.", icon: FileSpreadsheet },
] as const;

function EmptyDashboard() {
  const { history, setView } = useAppState();
  const reduceMotion = useReducedMotion();

  return (
    <div className="dashboard-empty">
      <section className="dashboard-welcome">
        <div className="dashboard-welcome__copy">
          <span className="dashboard-hero__tag"><Sparkles className="size-3.5" /> Comparativa retributiva profesional</span>
          <h1>Valida recibos y Registro Retributivo con una visión clara.</h1>
          <p>Carga los documentos, revisa diferencias por persona y concepto, y conserva cada análisis de forma local y privada.</p>
          <div className="dashboard-hero__trust">
            <span><ShieldCheck className="size-4" /> Procesamiento local</span>
            <span><ShieldCheck className="size-4" /> Sin datos bancarios</span>
            <span><ShieldCheck className="size-4" /> Resultados deterministas</span>
          </div>
        </div>
        <div className="dashboard-welcome__visual" aria-hidden="true">
          <div className="dashboard-welcome__orb" />
          <FileSpreadsheet className="size-12" />
          <span>PDF</span><span>Excel</span><span>Análisis</span>
        </div>
      </section>

      <section className="onboarding-steps" aria-label="Cómo iniciar un análisis">
        {ONBOARDING_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.article key={step.title} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }}>
              <span className="onboarding-steps__number">{index + 1}</span>
              <span className="onboarding-steps__icon"><Icon className="size-5" /></span>
              <div><h2>{step.title}</h2><p>{step.description}</p></div>
            </motion.article>
          );
        })}
      </section>

      <UploadPanel />

      {history.length ? (
        <button type="button" className="dashboard-history-link" onClick={() => setView("historial")}>
          <History className="size-4" /><span><strong>Ya tienes {history.length} {history.length === 1 ? "análisis guardado" : "análisis guardados"}</strong><small>Consulta o recupera resultados anteriores.</small></span><ArrowRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function DashboardView() {
  const { activeAnalysis, result, aiStatus, setView } = useAppState();
  const aiBadge = aiStatus?.configured && aiStatus.enabled ? "IA disponible" : "IA no configurada";
  const excludedCount = result?.excludedEmployeeIdsApplied?.length ?? 0;
  const sourceFiles = useMemo(() => [...new Set((result?.payrollRecords ?? []).map((row) => row.sourceFile).filter(Boolean))], [result?.payrollRecords]);

  if (!result || !activeAnalysis) return <EmptyDashboard />;

  return (
    <div className="flex flex-col gap-6" data-surface="dashboard-view">
      <section className="dashboard-hero">
        <div className="dashboard-hero__glow" aria-hidden="true" />
        <div className="dashboard-hero__content">
          <span className="dashboard-hero__tag"><Sparkles className="size-3.5" /> Análisis activo</span>
          <SectionHeader
            title="Resumen del análisis retributivo"
            subtitle="Consulta el estado general y accede a las áreas que requieren revisión."
            actions={(
              <Card className="analysis-active-card px-3.5 py-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-indigo-50 text-primary"><Clock3 className="size-4" aria-hidden="true" /></span>
                <div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Procesado</p><p className="mt-0.5 text-sm font-semibold text-ink">{formatDate(activeAnalysis.createdAt)}</p></div>
                <StatusBadge value={aiBadge} />
              </Card>
            )}
          />
          <div className="dashboard-hero__trust">
            <span><ShieldCheck className="size-4" /> {activeAnalysis.pdfCount} recibos</span>
            <span><ShieldCheck className="size-4" /> {result.summary.uniquePeople} personas</span>
            <span><ShieldCheck className="size-4" /> Tolerancia {result.summary.tolerance} €</span>
          </div>
        </div>
      </section>

      {excludedCount ? <p className="inline-flex self-start rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-muted shadow-subtle">Exclusiones aplicadas: {excludedCount} matrículas</p> : null}

      <SummaryCards summary={result.summary} internalExcelChecks={result.internalExcelChecks} />

      <section className="dashboard-quick-actions" aria-label="Accesos rápidos">
        {QUICK_ACTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.view} type="button" onClick={() => setView(item.view)}>
              <span><Icon className="size-5" /></span>
              <div><strong>{item.label}</strong><small>{item.description}</small></div>
              <ArrowRight className="size-4" />
            </button>
          );
        })}
      </section>

      <section className="dashboard-lower-grid">
        <Card className="analysis-files-card p-0">
          <div className="analysis-files-card__header"><div><p>Documentos y fuentes</p><h2>Archivos del análisis</h2></div><span>{sourceFiles.length + 1} archivos</span></div>
          <div className="analysis-files-card__list">
            <div><span className="analysis-files-card__icon analysis-files-card__icon--excel"><FileSpreadsheet className="size-4" /></span><div><strong>{activeAnalysis.registroFileName}</strong><small>Registro Retributivo</small></div><StatusBadge value="Procesado" /></div>
            {sourceFiles.slice(0, 5).map((file) => <div key={file}><span className="analysis-files-card__icon"><FileText className="size-4" /></span><div><strong>{file}</strong><small>Recibo PDF</small></div><StatusBadge value="Procesado" /></div>)}
            {sourceFiles.length > 5 ? <p className="analysis-files-card__more">Y {sourceFiles.length - 5} archivos más incluidos en el análisis.</p> : null}
          </div>
        </Card>

        <button type="button" className="assistant-banner" onClick={() => setView("asistente")}>
          <span className="assistant-banner__icon"><Bot className="size-6" /></span>
          <div><p>Asistente contextual</p><strong>Pregunta sobre los resultados del análisis</strong><small>Consulta personas, conceptos, diferencias y fuentes sin salir de la aplicación.</small></div>
          <ArrowRight className="size-5" />
        </button>
      </section>

      <ChartsPanel result={result} />
    </div>
  );
}
