"use client";

import { AlertCircle, BadgeEuro, FileText, Sigma, Users, UserX } from "lucide-react";
import { StatCard } from "@/components/common/StatCard";
import type { AnalysisSummary } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";

interface SummaryCardsProps {
  readonly summary?: AnalysisSummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const cards = [
    {
      label: "Recibos procesados",
      value: summary?.pdfsAnalyzed ?? 0,
      detail: summary?.pdfsFailed ? `${summary.pdfsFailed} con error` : "Paginas de recibos procesadas",
      icon: FileText,
      highlight: true,
    },
    {
      label: "Personas matched",
      value: summary?.matchedPeople ?? 0,
      detail: "Con Registro y PDF",
      icon: Users,
    },
    {
      label: "Conceptos pendientes de revisión",
      value: summary?.conceptsPendingReview ?? 0,
      detail: "Importe PDF pendiente de decisión, no incluido en el cálculo principal",
      icon: AlertCircle,
    },
    {
      label: "Importe pendiente de decisión",
      value: formatEuro(summary?.pendingDecisionPdfTotal ?? 0),
      detail: "No incluido en la diferencia matched",
      icon: AlertCircle,
    },
    {
      label: "Dif. matched",
      value: formatEuro(summary?.matchedTotalDifference ?? summary?.totalGlobalDifference ?? 0),
      detail: "Solo Registro/PDF encontrados",
      icon: BadgeEuro,
    },
    {
      label: "Conceptos ignorados",
      value: summary?.conceptsIgnored ?? 0,
      detail: "Fuera del calculo por criterio conservador",
      icon: UserX,
    },
    {
      label: "Conceptos no incluidos",
      value: summary?.conceptsNotIncluded ?? summary?.conceptsUnmapped ?? 0,
      detail: "Pendientes, sin mapear reales e ignorados",
      icon: Sigma,
    },
    {
      label: "Conceptos sin mapear reales",
      value: summary?.conceptsRealUnmapped ?? 0,
      detail: "Sin codigo Registro claro",
      icon: AlertCircle,
    },
    {
      label: "Sin PDF / Sin Registro",
      value: `${summary?.peopleInRegistroWithoutPdf ?? 0} / ${summary?.peopleInPdfWithoutRegistro ?? 0}`,
      detail: `PDF sin Registro: ${formatEuro(summary?.totalPdfWithoutRegistro ?? 0)}`,
      icon: Sigma,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card, index) => (
        <StatCard key={card.label} {...card} index={index} />
      ))}
    </section>
  );
}
