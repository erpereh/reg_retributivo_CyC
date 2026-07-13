import type { SanitizedDocumentChunk } from "@/lib/assistant/documents/chunker";

export interface IndexMeasurementSummary {
  readonly runs: 5;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly longTasks: number;
  readonly workerRequired: boolean;
}

export function createSanitizedPerformanceFixture(size = 5_200): readonly SanitizedDocumentChunk[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("invalid_fixture_size");
  return Array.from({ length: size }, (_, index) => {
    const employeeId = String(10_000 + (index % 200));
    const period = `2026-${String((index % 12) + 1).padStart(2, "0")}`;
    const content = `Matrícula ${employeeId}; periodo ${period}; concepto salario base; categoría técnica; importe ${1000 + (index % 50)}`;
    return {
      id: `perf-document-chunk-${index + 1}`,
      documentId: "perf-document",
      sequence: index,
      content,
      snippet: content,
      sanitizedHash: `safe-${index.toString(16).padStart(8, "0")}`,
      terms: ["matricula", employeeId, "periodo", period, "concepto", "salario", "base", "categoria", "tecnica", "importe"],
    };
  });
}

export function summarizeIndexMeasurements(measurements: readonly number[], longTasks: readonly number[]): IndexMeasurementSummary {
  if (measurements.length !== 5 || measurements.some((value) => !Number.isFinite(value) || value < 0)) throw new RangeError("five_measurements_required");
  const sorted = [...measurements].sort((left, right) => left - right);
  return {
    runs: 5,
    medianMs: sorted[2]!,
    p95Ms: sorted[4]!,
    longTasks: longTasks.length,
    workerRequired: measurements.some((duration) => duration > 50) || longTasks.some((duration) => duration > 50),
  };
}
