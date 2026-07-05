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
      label: "Pendientes revision",
      value: `${summary?.conceptsPendingReview ?? 0} / ${formatEuro(summary?.pendingDecisionPdfTotal ?? 0)}`,
      detail: "Importe PDF pendiente de decision, no incluido en el calculo principal",
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
      detail: `No incluidos: ${summary?.conceptsNotIncluded ?? summary?.conceptsUnmapped ?? 0}`,
      icon: UserX,
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
