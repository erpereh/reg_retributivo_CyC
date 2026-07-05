import type { ConceptComparisonRow, PersonComparisonRow } from "@/lib/types";
import { normalizeComparableText } from "@/lib/utils/normalize";

export interface ProbableCause {
  readonly label: string;
  readonly description: string;
  readonly review: string;
}

function closeTo(value: number, target: number, tolerance = 1): boolean {
  return Math.abs(Math.abs(value) - target) <= tolerance;
}

function hasOppositeCompensatedBlocks(row: PersonComparisonRow, tolerance: number): boolean {
  const diffs = [row.salaryDifference, row.salaryComplementDifference, row.extraSalaryDifference].filter((value) => Math.abs(value) > tolerance);
  return diffs.length >= 2 && Math.abs(row.totalDifference) <= tolerance && diffs.some((value) => value > 0) && diffs.some((value) => value < 0);
}

export function describePersonCause(row: PersonComparisonRow, tolerance: number): ProbableCause {
  const detail = normalizeComparableText(`${row.detail} ${row.person ?? ""}`);

  if (row.status === "Sin Registro") {
    return {
      label: "PDF sin Registro",
      description: "La matricula aparece en PDF pero no existe como empleado del Registro.",
      review: "Revisar la hoja Empleados del Registro y confirmar si la matricula debe incorporarse.",
    };
  }

  if (closeTo(row.extraSalaryDifference, 208, 2) || detail.includes("teletrabajo")) {
    return {
      label: "Teletrabajo",
      description: "La diferencia se parece a un importe de teletrabajo no incluido o tratado aparte.",
      review: "Revisar conceptos extrasalariales de PDF y su criterio de inclusion en Registro.",
    };
  }

  if (closeTo(row.salaryComplementDifference, 841.92, 2)) {
    return {
      label: "Bolsa vacaciones",
      description: "La diferencia coincide con el patron esperado para Bolsa de Vacaciones.",
      review: "Revisar el complemento salarial asociado y el codigo Registro sugerido.",
    };
  }

  if (hasOppositeCompensatedBlocks(row, tolerance)) {
    return {
      label: "Reclasificacion",
      description: "Hay diferencias opuestas entre bloques y el total queda dentro de tolerancia.",
      review: "Revisar si el concepto esta clasificado en el bloque correcto.",
    };
  }

  if (row.unmappedConceptsCount > 0) {
    return {
      label: "Concepto pendiente",
      description: "La fila tiene conceptos PDF pendientes o no incluidos que requieren decision.",
      review: "Revisar conceptos no incluidos y decidir si deben mapearse, ignorarse o mantenerse pendientes.",
    };
  }

  if (Math.abs(row.totalDifference) <= tolerance) {
    return {
      label: "Redondeo",
      description: "La diferencia esta dentro de la tolerancia configurada.",
      review: "No requiere ajuste salvo que el criterio interno exija cuadre exacto.",
    };
  }

  return {
    label: "Sin causa clara",
    description: "No se detecta una causa determinista con los datos disponibles.",
    review: "Revisar detalle de Registro, PDF y conceptos relacionados.",
  };
}

export function describeConceptCause(row: ConceptComparisonRow, tolerance: number): ProbableCause {
  const concept = normalizeComparableText(`${row.pdfConcept ?? ""} ${row.detail}`);

  if (concept.includes("teletrabajo") || closeTo(row.difference, 208, 2)) {
    return {
      label: "Teletrabajo",
      description: "El concepto o importe se parece a teletrabajo.",
      review: "Confirmar si corresponde a extrasalarial y si debe incluirse en el Registro.",
    };
  }

  if (row.status === "Sin mapear" || row.status === "Revisar") {
    return {
      label: "Concepto pendiente",
      description: "El concepto requiere revision de mapeo o criterio de inclusion.",
      review: "Revisar regla usada, codigo Registro y decision del concepto.",
    };
  }

  if (Math.abs(row.difference) <= tolerance) {
    return {
      label: "Redondeo",
      description: "La diferencia del concepto esta dentro de tolerancia.",
      review: "No requiere ajuste salvo criterio interno de cuadre exacto.",
    };
  }

  return {
    label: "Sin causa clara",
    description: "No se detecta una causa determinista para este concepto.",
    review: "Comparar importe Registro, PDF y regla aplicada.",
  };
}
