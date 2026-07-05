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
      detail: summary?.pdfsFailed ? `${summary.pdfsFailed} con error` : "Páginas de recibos procesadas",
      icon: FileText,
      highlight: true,
    },
    {
      label: "Personas analizadas",
      value: summary?.uniquePeople ?? 0,
      detail: "Matrículas Registro/PDF",
      icon: Users,
    },
    {
      label: "Personas con diferencias",
      value: summary?.peopleWithDifferences ?? 0,
      detail: "Fuera de OK",
      icon: UserX,
    },
    {
      label: "Conceptos sin mapear",
      value: summary?.conceptsUnmapped ?? 0,
      detail: "Pendientes de decisión",
      icon: AlertCircle,
    },
    {
      label: "Dif. total global",
      value: formatEuro(summary?.totalGlobalDifference ?? 0),
      detail: "PDF incluido - Registro",
      icon: BadgeEuro,
    },
    {
      label: "Dif. por bloques",
      value: `${formatEuro(summary?.totalSalaryDifference ?? 0)} / ${formatEuro(summary?.totalSalaryComplementDifference ?? 0)} / ${formatEuro(summary?.totalExtraSalaryDifference ?? 0)}`,
      detail: summary?.aiEnabled ? "IA solo textos" : "Reglas deterministas",
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
