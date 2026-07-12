"use client";

import { CalendarDays, Download, FileText, History, RotateCcw, Trash2 } from "lucide-react";
import { useAppState } from "@/components/app/AppState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import type { StoredAnalysis } from "@/lib/types";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function HistoryCard({
  analysis,
  active,
  exporting,
  onOpen,
  onDelete,
  onExport,
}: Readonly<{
  analysis: StoredAnalysis;
  active: boolean;
  exporting: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onExport: () => void;
}>) {
  const summary = analysis.result?.summary;

  return (
    <Card
      interactive
      data-surface="history-row"
      className={cn("p-4", active && "border-blue-300 bg-blue-50/40 ring-1 ring-primary/30")}
    >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-primary">
                <CalendarDays className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{formatDate(analysis.createdAt)}</p>
                <p className="max-w-[420px] truncate text-sm text-muted">{displayText(analysis.registroFileName)}</p>
              </div>
              {active ? <StatusBadge value="Análisis activo" tone="success" /> : null}
              <StatusBadge value="IA bajo demanda" tone="info" />
            </div>

            <dl
              data-surface="history-metrics"
              className="mt-4 grid overflow-hidden rounded-2xl bg-slate-50/80 xl:grid-cols-6 xl:divide-x xl:divide-y-0 xl:divide-line/80"
            >
              {[
                ["Recibos", analysis.pdfCount],
                ["Personas", summary?.uniquePeople ?? 0],
                ["Con diferencias", summary?.peopleWithDifferences ?? 0],
                ["Pendientes", summary?.conceptsPendingReview ?? 0],
                ["Ignorados", summary?.conceptsIgnored ?? 0],
                ["Diferencia", formatEuro(summary?.matchedTotalDifference ?? summary?.totalGlobalDifference ?? 0)],
              ].map(([label, value]) => (
                <div key={label as string} data-variant="row" className="border-t border-line/70 px-3 py-3 first:border-t-0 xl:border-t-0">
                  <dt className="text-[11px] font-semibold uppercase text-muted">{label as string}</dt>
                  <dd className="mt-1 truncate text-sm font-semibold text-ink tabular-nums">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={onOpen} className="btn-primary">
              <RotateCcw className="size-4" aria-hidden="true" />
              Abrir análisis
            </button>
            <button type="button" onClick={onExport} disabled={exporting} className="btn-secondary">
              <Download className="size-4" aria-hidden="true" />
              Exportar Excel
            </button>
            <button type="button" onClick={onDelete} className="btn-danger">
              <Trash2 className="size-4" aria-hidden="true" />
              Eliminar
            </button>
          </div>
        </div>
    </Card>
  );
}

export function HistoryView() {
  const { history, activeAnalysis, exporting, openStoredAnalysis, removeStoredAnalysis, clearStoredHistory, exportStoredAnalysis } = useAppState();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Historial de análisis"
        subtitle="Recupera análisis anteriores guardados localmente, cambia el análisis activo o exporta comparativas ya generadas."
        actions={
          history.length ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (window.confirm("¿Seguro que quieres limpiar todo el historial?")) {
                  void clearStoredHistory();
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Limpiar historial
            </button>
          ) : null
        }
      />

      {!history.length ? (
        <EmptyState
          icon={History}
          title="No hay análisis guardados todavía"
          description="Los análisis completados aparecerán aquí para abrirlos, exportarlos o eliminarlos sin conservar recibos ni archivos originales."
          action={
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-primary">
              <FileText className="size-4" aria-hidden="true" />
              Analiza recibos para crear el primer análisis
            </span>
          }
        />
      ) : (
        <section className="space-y-4">
          {history.map((analysis) => (
            <HistoryCard
              key={analysis.id}
              analysis={analysis}
              active={activeAnalysis?.id === analysis.id}
              exporting={exporting}
              onOpen={() => void openStoredAnalysis(analysis.id)}
              onExport={() => void exportStoredAnalysis(analysis)}
              onDelete={() => {
                if (window.confirm("¿Eliminar este análisis del historial?")) {
                  void removeStoredAnalysis(analysis.id);
                }
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}
