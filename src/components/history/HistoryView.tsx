"use client";

import { CalendarDays, Download, FileText, History, RotateCcw, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/components/common/SectionHeader";
import type { StoredAnalysis } from "@/lib/types";
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
  index,
}: Readonly<{
  analysis: StoredAnalysis;
  active: boolean;
  exporting: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onExport: () => void;
  index: number;
}>) {
  const summary = analysis.result?.summary;

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.22), ease: "easeOut" }}>
      <Card interactive className={cn("p-5", active && "ring-2 ring-primary/70")}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-primary">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{formatDate(analysis.createdAt)}</p>
                <p className="truncate text-sm text-muted">{analysis.registroFileName}</p>
              </div>
              {active ? <Badge value="Análisis activo" /> : null}
              <Badge value={analysis.config.enableAI ? "IA activada" : "IA desactivada"} />
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["PDFs", analysis.pdfCount],
                ["Personas", summary?.uniquePeople ?? 0],
                ["Con diferencias", summary?.peopleWithDifferences ?? 0],
                ["Sin mapear", summary?.conceptsUnmapped ?? 0],
                ["Dif. total", formatEuro(summary?.totalGlobalDifference ?? 0)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase text-muted">{label as string}</dt>
                  <dd className="mt-1 text-base font-semibold text-ink">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={onOpen} className="btn-primary">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Abrir análisis
            </button>
            <button type="button" onClick={onExport} disabled={exporting} className="btn-secondary">
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar Excel
            </button>
            <button type="button" onClick={onDelete} className="btn-danger">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Eliminar
            </button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export function HistoryView() {
  const { history, activeAnalysis, exporting, openStoredAnalysis, removeStoredAnalysis, clearStoredHistory, exportStoredAnalysis } = useAppState();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Historial de análisis"
        subtitle="Recupera comparativas previas guardadas localmente en este navegador."
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
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Limpiar historial
            </button>
          ) : null
        }
      />

      {!history.length ? (
        <EmptyState
          icon={History}
          title="No hay análisis guardados todavía"
          description="Cada análisis completado se guardará aquí sin conservar PDFs ni archivos originales."
          action={
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-primary">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Analiza PDFs para crear el primer registro
            </span>
          }
        />
      ) : (
        <section className="space-y-4">
          {history.map((analysis, index) => (
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
              index={index}
            />
          ))}
        </section>
      )}
    </div>
  );
}
