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
      label: "PDFs analizados",
      value: summary?.pdfsAnalyzed ?? 0,
      detail: summary?.pdfsFailed ? `${summary.pdfsFailed} con error` : "Recibos procesados",
      icon: FileText,
      highlight: true,
    },
    {
      label: "Personas únicas",
      value: summary?.uniquePeople ?? 0,
      detail: "Trabajadores detectados",
      icon: Users,
    },
    {
      label: "Personas con incidencias",
      value: summary?.peopleWithIssues ?? 0,
      detail: "Requieren revisión",
      icon: UserX,
    },
    {
      label: "Campos incorrectos",
      value: summary?.fieldIssuesCount ?? 0,
      detail: "Datos maestros a revisar",
      icon: AlertCircle,
    },
    {
      label: "Diferencia salarial total",
      value: formatEuro(summary?.salaryDifferenceTotal ?? 0),
      detail: "Suma neta de diferencias",
      icon: BadgeEuro,
    },
    {
      label: "Diferencia absoluta total",
      value: formatEuro(summary?.salaryDifferenceAbsTotal ?? 0),
      detail: summary?.aiEnabled ? "IA usada en observaciones" : "Observaciones deterministas",
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
