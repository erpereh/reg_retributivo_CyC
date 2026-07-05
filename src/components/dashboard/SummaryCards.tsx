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
      badge: "Proceso",
      tooltip: "Recibos procesados desde los PDFs cargados. Es volumen de analisis, no una diferencia economica.",
    },
    {
      label: "Personas matched",
      value: summary?.matchedPeople ?? 0,
      detail: "Con Registro y PDF",
      icon: Users,
      accent: "green" as const,
      badge: "Matched",
      tooltip: "Personas encontradas tanto en Registro como en PDF. Son la base de la diferencia matched.",
    },
    {
      label: "Conceptos pendientes de revisión",
      value: summary?.conceptsPendingReview ?? 0,
      detail: "Importe PDF pendiente de decisión, no incluido en el cálculo principal",
      icon: AlertCircle,
      accent: "orange" as const,
      badge: "Decision",
      tooltip: "Requieren decision manual; no son errores automaticos. No entran en el calculo principal hasta que se active una decision desde Ajustes.",
    },
    {
      label: "Importe pendiente de decisión",
      value: formatEuro(summary?.pendingDecisionPdfTotal ?? 0),
      detail: "No incluido en la diferencia matched",
      icon: AlertCircle,
      accent: "orange" as const,
      badge: "Separado",
      tooltip: "Importe detectado en PDFs que requiere revision manual. No afecta al calculo principal hasta que se decida incluirlo.",
    },
    {
      label: "Dif. matched",
      value: formatEuro(summary?.matchedTotalDifference ?? summary?.totalGlobalDifference ?? 0),
      detail: "Solo Registro/PDF encontrados",
      icon: BadgeEuro,
      accent: "red" as const,
      badge: "Matched",
      tooltip: "Diferencia calculada solo entre personas encontradas tanto en Registro como en PDF. No incluye PDF sin Registro ni conceptos pendientes.",
    },
    {
      label: "Conceptos ignorados",
      value: summary?.conceptsIgnored ?? 0,
      detail: "Excluidos correctamente por criterio conservador",
      icon: UserX,
      accent: "gray" as const,
      badge: "Correcto",
      tooltip: "Conceptos excluidos deliberadamente del calculo, por ejemplo deducciones, retenciones o duplicados informativos.",
    },
    {
      label: "Conceptos sin mapear reales",
      value: summary?.conceptsRealUnmapped ?? 0,
      detail: "Problema real de mapeo: sin codigo Registro claro",
      icon: AlertCircle,
      accent: "red" as const,
      badge: "Mapeo",
      tooltip: "Conceptos detectados en PDF que no tienen un codigo Registro claro. Estos si requieren revisar el mapeo.",
    },
    {
      label: "PDF sin Registro",
      value: summary?.peopleInPdfWithoutRegistro ?? 0,
      detail: `PDF sin Registro: ${formatEuro(summary?.totalPdfWithoutRegistro ?? 0)}`,
      icon: Sigma,
      accent: "violet" as const,
      badge: "Separado",
      tooltip: "Importes detectados en PDFs cuya matricula no existe en la hoja Empleados del Registro. Se muestran separados del matched.",
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
