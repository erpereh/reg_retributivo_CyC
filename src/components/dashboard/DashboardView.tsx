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
import type { AppView, StoredAnalysis } from "@/lib/types";

const DASHBOARD_TITLE = "Comparativa Recibos vs Registro Retributivo";
const DASHBOARD_SUBTITLE = "Resumen del análisis retributivo: diferencias matched, conceptos pendientes, Recibo sin Reg. Retrib. y estado general del cuadre.";

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

function EmptyDashboard({ activeAnalysis, aiBadge }: Readonly<{ activeAnalysis?: Pick<StoredAnalysis, "createdAt">; aiBadge: string }>) {
  const state = useAppState();
  const history = state.history ?? [];
  const reduceMotion = useReducedMotion();

  return (
    <div className="dashboard-empty">
      <section className="dashboard-welcome">
        <div className="dashboard-welcome__copy">
          <span className="dashboard-hero__tag"><Sparkles className="size-3.5" /> Comparativa retributiva profesional</span>
          <h1>{DASHBOARD_TITLE}</h1>
          <p>{DASHBOARD_SUBTITLE}</p>
          {activeAnalysis ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-muted shadow-subtle"><Clock3 className="size-4" />{formatDate(activeAnalysis.createdAt)}</span>
              <StatusBadge value={aiBadge} />
            </div>
          ) : null}
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
        <button type="button" className="dashboard-history-link" onClick={() => state.setView?.("historial")}>
          <History className="size-4" /><span><strong>Ya tienes {history.length} {history.length === 1 ? "análisis guardado" : "análisis guardados"}</strong><small>Consulta o recupera resultados anteriores.</small></span><ArrowRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function DashboardView() {
  const { activeAnalysis, result, aiStatus, setView, resetForNewAnalysis } = useAppState();
  const aiBadge = aiStatus?.configured && aiStatus.enabled ? "IA disponible" : "IA no configurada";
  const excludedCount = result?.excludedEmployeeIdsApplied?.length ?? 0;
  const sourceFiles = useMemo(() => [...new Set((result?.payrollRecords ?? []).map((row) => row.sourceFile).filter(Boolean))], [result?.payrollRecords]);

  if (!result || !activeAnalysis) return <EmptyDashboard activeAnalysis={activeAnalysis} aiBadge={aiBadge} />;

  const metrics = [
    { label: "Personas analizadas", value: result.summary.uniquePeople, detail: `${result.summary.matchedPeople} con datos cruzados`, icon: UsersRound },
    { label: "Con diferencias", value: result.summary.peopleWithDifferences, detail: "Fuera de la tolerancia", icon: CheckCircle2 },
    { label: "Recibos procesados", value: result.summary.pdfsAnalyzed, detail: result.summary.pdfsFailed ? `${result.summary.pdfsFailed} con error` : "Procesamiento completado", icon: FileText },
    { label: "Documentos", value: sourceFiles.length + 1, detail: "PDF y Registro Retributivo", icon: FileSpreadsheet },
  ] as const;

  return (
    <div className="dashboard-reference" data-surface="dashboard-view">
      <header className="dashboard-reference__header">
        <div className="dashboard-reference__header-copy">
          <h1>Buenos días</h1>
          <p>Este es el resumen del análisis retributivo activo.</p>
        </div>
        <button type="button" className="btn-primary min-h-10 px-4" onClick={resetForNewAnalysis}><FileSpreadsheet className="size-4" />Nuevo análisis</button>
      </header>

      <section className="dashboard-reference__metrics" aria-label="Indicadores principales">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label} className="dashboard-reference__metric">
              <div className="dashboard-reference__metric-top"><span>{metric.label}</span><span className="dashboard-reference__metric-icon"><Icon className="size-4" /></span></div>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </Card>
          );
        })}
      </section>

      <section className="dashboard-reference__grid">
        <Card className="dashboard-reference__section">
          <div className="dashboard-reference__section-header"><div><h2>Resumen del análisis</h2><p>Estado de la comparativa entre recibos y Registro Retributivo</p></div><StatusBadge value="Procesado" /></div>
          <div className="dashboard-reference__overview">
            <div><span>Personas con diferencia</span><strong>{result.summary.peopleWithDifferences}</strong></div>
            <div><span>Conceptos pendientes</span><strong>{result.summary.conceptsPendingReview ?? 0}</strong></div>
            <div><span>Tolerancia aplicada</span><strong>{result.summary.tolerance} €</strong></div>
          </div>
          <div className="mt-4"><SummaryCards summary={result.summary} internalExcelChecks={result.internalExcelChecks} /></div>
        </Card>

        <div className="flex flex-col gap-3">
          <button type="button" className="dashboard-reference__assistant" onClick={() => setView("asistente") }>
            <span className="dashboard-reference__assistant-icon"><Bot className="size-4" /></span>
            <span><strong>Asistente retributivo</strong><p>Pregunta por personas, conceptos, diferencias o fuentes del análisis.</p><small>Abrir asistente →</small></span>
          </button>
          <Card className="dashboard-reference__section">
            <div className="dashboard-reference__section-header"><div><h2>Análisis activo</h2><p>{formatDate(activeAnalysis.createdAt)}</p></div><StatusBadge value={aiBadge} /></div>
            <div className="analysis-files-card__list">
              <div><span className="analysis-files-card__icon analysis-files-card__icon--excel"><FileSpreadsheet className="size-4" /></span><div><strong>{activeAnalysis.registroFileName}</strong><small>Registro Retributivo</small></div></div>
              <div><span className="analysis-files-card__icon"><FileText className="size-4" /></span><div><strong>{activeAnalysis.pdfCount} recibos</strong><small>{sourceFiles.length} fuentes detectadas</small></div></div>
              {excludedCount ? <p className="analysis-files-card__more">{excludedCount} matrículas excluidas por configuración.</p> : null}
            </div>
          </Card>
        </div>
      </section>

      <ChartsPanel result={result} />
    </div>
  );
}
