"use client";

import { AlertCircle, BadgeEuro, FileCheck2, FileText, Sigma, Users, UserX } from "lucide-react";
import { StatCard } from "@/components/common/StatCard";
import type { AnalysisSummary, InternalExcelCheckRow } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";

interface SummaryCardsProps {
  readonly summary?: AnalysisSummary;
  readonly internalExcelChecks?: readonly InternalExcelCheckRow[];
}

function getInternalExcelAccent(rows: readonly InternalExcelCheckRow[]): "green" | "orange" | "red" {
  if (rows.some((row) => row.status === "Diferencia")) {
    return "red";
  }

  if (rows.some((row) => row.status === "Revisar")) {
    return "orange";
  }

  return "green";
}

export function SummaryCards({ summary, internalExcelChecks = [] }: SummaryCardsProps) {
  const internalOk = internalExcelChecks.filter((row) => row.status === "OK").length;
  const internalTotal = internalExcelChecks.length;
  const internalAccent = getInternalExcelAccent(internalExcelChecks);

  const cards = [
    {
      label: "Recibos procesados",
      value: summary?.pdfsAnalyzed ?? 0,
      detail: summary?.pdfsFailed ? `${summary.pdfsFailed} con error` : "Páginas de recibos procesadas",
      icon: FileText,
      highlight: true,
      badge: "Proceso",
      tooltip: "Recibos procesados desde los recibos cargados. Es volumen de análisis, no una diferencia económica.",
    },
    {
      label: "Cuadre interno Excel",
      value: `${internalOk} / ${internalTotal} OK`,
      detail: "Periodo completo vs desglose de conceptos",
      icon: FileCheck2,
      accent: internalAccent,
      badge: internalAccent === "green" ? "OK" : internalAccent === "orange" ? "Revisión" : "Diferencia",
      tooltip:
        "El cuadre interno compara las columnas de retribuciones del periodo completo contra la suma de conceptos de Salario, C. Salarial y Extrasalarial dentro del propio Excel. No compara contra recibos.",
    },
    {
      label: "Personas analizadas",
      value: summary?.uniquePeople ?? 0,
      detail: `${summary?.matchedPeople ?? 0} con Reg. Retrib. y Recibo`,
      icon: Users,
      accent: "green" as const,
      badge: "Personas",
      tooltip: "Personas evaluadas en el análisis activo, incluyendo matched y casos separados.",
    },
    {
      label: "Personas con diferencia",
      value: summary?.peopleWithDifferences ?? 0,
      detail: "Matched con diferencia fuera de tolerancia",
      icon: Users,
      accent: "red" as const,
      badge: "Diferencia",
      tooltip: "Personas matched que tienen diferencia entre Reg. Retrib. y Recibo según la tolerancia configurada.",
    },
    {
      label: "Diferencia total matched",
      value: formatEuro(summary?.matchedTotalDifference ?? summary?.totalGlobalDifference ?? 0),
      detail: "Solo personas con Reg. Retrib. y Recibo",
      icon: BadgeEuro,
      accent: "green" as const,
      badge: "Matched",
      tooltip: "Diferencia total calculada solo entre personas encontradas tanto en Reg. Retrib. como en Recibo.",
    },
    {
      label: "Conceptos pendientes de revisión",
      value: summary?.conceptsPendingReview ?? 0,
      detail: "Importe Recibo pendiente de decisión, no incluido en el cálculo principal",
      icon: AlertCircle,
      accent: "orange" as const,
      badge: "Decisión",
      tooltip: "Requieren decisión manual; no son errores automáticos. No entran en el cálculo principal hasta que se active una decisión desde Ajustes.",
    },
    {
      label: "Importe pendiente de decisión",
      value: formatEuro(summary?.pendingDecisionPdfTotal ?? 0),
      detail: "No incluido en la diferencia matched",
      icon: AlertCircle,
      accent: "orange" as const,
      badge: "Separado",
      tooltip: "Importe detectado en recibos que requiere revisión manual. No afecta al cálculo principal hasta que se decida incluirlo.",
    },
    {
      label: "Conceptos desactivados",
      value: summary?.conceptsIgnored ?? 0,
      detail: "Reglas configuradas fuera del análisis",
      icon: UserX,
      accent: "gray" as const,
      badge: "Desactivado",
      tooltip: "Conceptos configurados para no entrar en la comparativa.",
    },
    {
      label: "Conceptos sin mapear reales",
      value: summary?.conceptsRealUnmapped ?? 0,
      detail: "Problema real de mapeo: sin código Reg. Retrib. claro",
      icon: AlertCircle,
      accent: "red" as const,
      badge: "Mapeo",
      tooltip: "Conceptos detectados en recibos que no tienen un código Reg. Retrib. claro. Estos sí requieren revisar el mapeo.",
    },
    {
      label: "Recibo sin Reg. Retrib.",
      value: summary?.peopleInPdfWithoutRegistro ?? 0,
      detail: `Recibo sin Reg. Retrib.: ${formatEuro(summary?.totalPdfWithoutRegistro ?? 0)}`,
      icon: Sigma,
      accent: "violet" as const,
      badge: "Separado",
      tooltip: "Importes detectados en recibos cuya matrícula no existe en la hoja Empleados del Reg. Retrib. Se muestran separados del matched.",
    },
    {
      label: "Reg. Retrib. sin Recibo",
      value: summary?.peopleInRegistroWithoutPdf ?? 0,
      detail: "Personas del Excel sin recibo asociado",
      icon: UserX,
      accent: "gray" as const,
      badge: "Separado",
      tooltip: "Personas presentes en Reg. Retrib. para las que no se ha detectado recibo.",
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
