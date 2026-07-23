import type { AnalysisResult, AppView, StoredAnalysis } from "@/lib/types";

export type GlobalSearchKind = "person" | "concept" | "document" | "analysis";

export interface GlobalSearchEntry {
  readonly id: string;
  readonly kind: GlobalSearchKind;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
  readonly targetView: AppView;
  readonly query?: string;
  readonly analysisId?: string;
}

export interface GlobalSearchGroup {
  readonly kind: GlobalSearchKind;
  readonly label: string;
  readonly entries: readonly GlobalSearchEntry[];
}

const GROUP_LABELS: Record<GlobalSearchKind, string> = {
  person: "Personas",
  concept: "Conceptos",
  document: "Documentos",
  analysis: "Historial",
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueById(entries: readonly GlobalSearchEntry[]): GlobalSearchEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function buildGlobalSearchIndex(
  result: AnalysisResult | undefined,
  history: readonly StoredAnalysis[],
): GlobalSearchEntry[] {
  const people: GlobalSearchEntry[] = (result?.people ?? []).map((row) => ({
    id: `person:${row.employeeNumber}`,
    kind: "person",
    title: row.person?.trim() || `Matrícula ${row.employeeNumber}`,
    subtitle: [row.employeeNumber, row.position, row.workplace].filter(Boolean).join(" · "),
    keywords: [row.employeeNumber, row.person ?? "", row.position ?? "", row.category ?? "", row.workplace ?? ""],
    targetView: "personas",
    query: row.employeeNumber,
  }));

  const mappedConcepts: GlobalSearchEntry[] = (result?.concepts ?? []).map((row, index) => {
    const name = row.pdfConcept?.trim() || row.registroCode || "Concepto sin nombre";
    return {
      id: `concept:${row.registroCode}:${name}:${index}`,
      kind: "concept",
      title: name,
      subtitle: [row.registroCode, row.block, row.person || row.employeeNumber].filter(Boolean).join(" · "),
      keywords: [name, row.registroCode, row.block, row.person ?? "", row.employeeNumber],
      targetView: "conceptos",
      query: name,
    };
  });

  const unmappedConcepts: GlobalSearchEntry[] = (result?.unmappedConcepts ?? []).map((row) => ({
    id: `concept:unmapped:${row.pdfConcept}`,
    kind: "concept",
    title: row.pdfConcept,
    subtitle: `Pendiente de revisión · ${row.peopleCount} personas`,
    keywords: [row.pdfConcept, row.suggestedRegistroCode ?? "", row.suggestedBlock ?? ""],
    targetView: "conceptos",
    query: row.pdfConcept,
  }));

  const sourceFiles = [...new Set((result?.payrollRecords ?? []).map((row) => row.sourceFile).filter(Boolean))];
  const documents: GlobalSearchEntry[] = sourceFiles.map((sourceFile) => ({
    id: `document:${sourceFile}`,
    kind: "document",
    title: sourceFile,
    subtitle: "Recibo incluido en el análisis activo",
    keywords: [sourceFile],
    targetView: "dashboard",
  }));

  const analyses: GlobalSearchEntry[] = history.map((analysis) => ({
    id: `analysis:${analysis.id}`,
    kind: "analysis",
    title: new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(analysis.createdAt)),
    subtitle: `${analysis.registroFileName} · ${analysis.result.summary.uniquePeople} personas`,
    keywords: [analysis.registroFileName, analysis.createdAt, String(analysis.result.summary.uniquePeople)],
    targetView: "historial",
    analysisId: analysis.id,
  }));

  return uniqueById([...people, ...mappedConcepts, ...unmappedConcepts, ...documents, ...analyses]);
}

function score(entry: GlobalSearchEntry, query: string): number {
  const normalizedQuery = normalize(query);
  const title = normalize(entry.title);
  const subtitle = normalize(entry.subtitle);
  const keywords = entry.keywords.map(normalize);
  if (title === normalizedQuery) return 100;
  if (keywords.some((value) => value === normalizedQuery)) return 95;
  if (title.startsWith(normalizedQuery)) return 80;
  if (keywords.some((value) => value.startsWith(normalizedQuery))) return 70;
  if (title.includes(normalizedQuery)) return 60;
  if (subtitle.includes(normalizedQuery)) return 45;
  if (keywords.some((value) => value.includes(normalizedQuery))) return 35;
  return 0;
}

export function searchGlobalIndex(
  entries: readonly GlobalSearchEntry[],
  query: string,
  limit = 12,
): GlobalSearchEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  return entries
    .map((entry) => ({ entry, score: score(entry, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title, "es"))
    .slice(0, limit)
    .map((item) => item.entry);
}

export function groupGlobalSearchResults(entries: readonly GlobalSearchEntry[]): GlobalSearchGroup[] {
  return (["person", "concept", "document", "analysis"] as const)
    .map((kind) => ({ kind, label: GROUP_LABELS[kind], entries: entries.filter((entry) => entry.kind === kind) }))
    .filter((group) => group.entries.length > 0);
}
