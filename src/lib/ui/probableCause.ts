import type { ConceptComparisonRow, PersonComparisonRow } from "@/lib/types";
import { normalizeComparableText } from "@/lib/utils/normalize";
import { formatEuro } from "@/lib/utils/money";

export interface ProbableCause {
  readonly label: string;
  readonly description: string;
  readonly review: string;
}

function closeTo(value: number, target: number, tolerance = 1): boolean {
  return Math.abs(Math.abs(value) - target) <= tolerance;
}

interface BlockDifference {
  readonly label: string;
  readonly value: number;
}

function compensatedBlockPair(row: PersonComparisonRow, tolerance: number): readonly [BlockDifference, BlockDifference] | undefined {
  const threshold = Math.max(tolerance, 5);
  const blocks: readonly BlockDifference[] = [
    { label: "bloque Salario", value: row.salaryDifference },
    { label: "bloque Complemento Salarial", value: row.salaryComplementDifference },
    { label: "bloque Extrasalarial", value: row.extraSalaryDifference },
  ];
  const pairs: Array<readonly [BlockDifference, BlockDifference]> = [
    [blocks[0], blocks[1]],
    [blocks[0], blocks[2]],
    [blocks[1], blocks[2]],
  ];

  return pairs
    .filter(([left, right]) => Math.abs(left.value) > tolerance && Math.abs(right.value) > tolerance)
    .filter(([left, right]) => Math.sign(left.value) !== Math.sign(right.value))
    .filter(([left, right]) => Math.abs(left.value + right.value) <= threshold)
    .sort(([leftA, rightA], [leftB, rightB]) => Math.abs(leftA.value + rightA.value) - Math.abs(leftB.value + rightB.value))[0];
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

  const reclassificationPair = compensatedBlockPair(row, tolerance);
  if (reclassificationPair) {
    const [left, right] = reclassificationPair;
    const remaining = [
      { label: "bloque Salario", value: row.salaryDifference },
      { label: "bloque Complemento Salarial", value: row.salaryComplementDifference },
      { label: "bloque Extrasalarial", value: row.extraSalaryDifference },
    ].filter((block) => block.label !== left.label && block.label !== right.label);
    const remainingText = remaining.length ? ` La diferencia restante queda en ${remaining[0].label}: ${formatEuro(remaining[0].value)}.` : "";

    return {
      label: "Reclasificación entre bloques",
      description: `${left.label} (${formatEuro(left.value)}) y ${right.label} (${formatEuro(right.value)}) tienen diferencias de signo contrario y quedan casi compensados.${remainingText}`,
      review: `Revisar si el importe compensado está clasificado de forma distinta entre ${left.label} y ${right.label}. Revisar también la diferencia restante en ${remaining[0]?.label ?? "los demás bloques"}.`,
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
