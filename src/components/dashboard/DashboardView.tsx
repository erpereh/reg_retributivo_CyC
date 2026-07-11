"use client";

import { Clock3 } from "lucide-react";
import { useAppState } from "@/components/app/AppState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { ChartsPanel } from "@/components/dashboard/ChartsPanel";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { UploadPanel } from "@/components/upload/UploadPanel";

function formatDate(value?: string): string {
  if (!value) {
    return "Sin análisis activo";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DashboardView() {
  const { activeAnalysis, result, aiStatus } = useAppState();
  const aiBadge = aiStatus?.configured && aiStatus.enabled ? "IA disponible" : "IA no configurada";
  const excludedCount = result?.excludedEmployeeIdsApplied?.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Comparativa Recibos vs Registro Retributivo"
        subtitle="Resumen del análisis retributivo: diferencias matched, conceptos pendientes, Recibo sin Reg. Retrib. y estado general del cuadre."
        actions={
          activeAnalysis ? (
            <Card className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-primary">
                <Clock3 className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase text-muted">Análisis activo</p>
                <p className="text-sm font-semibold text-ink">{formatDate(activeAnalysis.createdAt)}</p>
              </div>
              <StatusBadge value={aiBadge} />
            </Card>
          ) : null
        }
      />
      <UploadPanel />
      {excludedCount ? (
        <p className="inline-flex self-start rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-muted">
          Exclusiones aplicadas: {excludedCount} matrículas
        </p>
      ) : null}
      <SummaryCards summary={result?.summary} internalExcelChecks={result?.internalExcelChecks} />
      <ChartsPanel result={result} />
    </div>
  );
}
