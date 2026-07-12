"use client";

import { AlertCircle, BadgeEuro, FileCheck2, FileText, Sigma, Users, UserX } from "lucide-react";
import { Card } from "@/components/common/Card";
import { CompactMetric } from "@/components/common/CompactMetric";
import { MetricCard } from "@/components/common/MetricCard";
import type { AnalysisSummary, InternalExcelCheckRow } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";

interface SummaryCardsProps {
  readonly summary?: AnalysisSummary;
  readonly internalExcelChecks?: readonly InternalExcelCheckRow[];
}

function internalTone(rows: readonly InternalExcelCheckRow[]): "green" | "orange" | "red" {
  if (rows.some((row) => row.status === "Diferencia")) return "red";
  if (rows.some((row) => row.status === "Revisar")) return "orange";
  return "green";
}

export function SummaryCards({ summary, internalExcelChecks = [] }: SummaryCardsProps) {
  const internalOk = internalExcelChecks.filter((row) => row.status === "OK").length;
  const primary = [
    {
      label: "Personas analizadas",
      value: summary?.uniquePeople ?? 0,
      detail: `${summary?.matchedPeople ?? 0} con Reg. Retrib. y Recibo`,
      icon: Users,
      highlight: true,
      accent: "blue" as const,
    },
    {
      label: "Personas con diferencia",
      value: summary?.peopleWithDifferences ?? 0,
      detail: "Matched fuera de tolerancia",
      icon: Users,
      accent: "red" as const,
    },
    {
      label: "Diferencia total matched",
      value: formatEuro(summary?.matchedTotalDifference ?? summary?.totalGlobalDifference ?? 0),
      detail: "Solo personas con Reg. Retrib. y Recibo",
      icon: BadgeEuro,
      accent: "green" as const,
    },
    {
      label: "Recibo sin Reg. Retrib.",
      value: summary?.peopleInPdfWithoutRegistro ?? 0,
      detail: formatEuro(summary?.totalPdfWithoutRegistro ?? 0),
      icon: Sigma,
      accent: "violet" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section data-testid="primary-kpis" aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {primary.map((metric) => (
          <div key={metric.label} data-testid="primary-kpi">
            <MetricCard {...metric} />
          </div>
        ))}
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Card role="region" aria-label="Estado del análisis" className="p-4 sm:p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-ink">Estado del análisis</h2>
            <p className="mt-1 text-sm text-muted">Cobertura y consistencia de los datos procesados.</p>
          </div>
          <div className="flex flex-col">
            <CompactMetric
              variant="row"
              label="Cuadre Reg."
              value={`${internalOk} / ${internalExcelChecks.length} OK`}
              detail="Periodo completo vs desglose. No compara contra recibos."
              icon={FileCheck2}
              tone={internalTone(internalExcelChecks)}
            />
            <CompactMetric
              variant="row"
              label="Recibos procesados"
              value={summary?.pdfsAnalyzed ?? 0}
              detail={summary?.pdfsFailed ? `${summary.pdfsFailed} con error` : "Páginas de recibos procesadas"}
              icon={FileText}
              tone="blue"
            />
            <CompactMetric
              variant="row"
              label="Reg. Retrib. sin Recibo"
              value={summary?.peopleInRegistroWithoutPdf ?? 0}
              detail="Personas del Excel sin recibo asociado"
              icon={UserX}
              tone="gray"
            />
          </div>
        </Card>

        <Card role="region" aria-label="Revisión pendiente" className="p-4 sm:p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-ink">Revisión pendiente</h2>
            <p className="mt-1 text-sm text-muted">Decisiones y configuración que requieren atención.</p>
          </div>
          <div className="flex flex-col">
            <CompactMetric
              variant="row"
              label="Conceptos pendientes de revisión"
              value={summary?.conceptsPendingReview ?? 0}
              detail="Requieren decisión; no se incluyen en el cálculo principal."
              icon={AlertCircle}
              tone="orange"
            />
            <CompactMetric
              variant="row"
              label="Importe pendiente de decisión"
              value={formatEuro(summary?.pendingDecisionPdfTotal ?? 0)}
              detail="Importe Recibo pendiente de decisión, no incluido en el cálculo principal"
              icon={BadgeEuro}
              tone="orange"
            />
            <CompactMetric
              variant="row"
              label="Conceptos desactivados"
              value={summary?.conceptsIgnored ?? 0}
              detail="Reglas configuradas fuera del análisis"
              icon={UserX}
              tone="gray"
            />
            <CompactMetric
              variant="row"
              label="Conceptos sin mapear reales"
              value={summary?.conceptsRealUnmapped ?? 0}
              detail="Problema real de mapeo: sin código Reg. Retrib. claro"
              icon={AlertCircle}
              tone="red"
            />
          </div>
        </Card>
      </section>
    </div>
  );
}
