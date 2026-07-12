import type { SourceReference } from "@/lib/assistant/domain";

export function sourcesForRetrieval(sources: readonly SourceReference[]): readonly SourceReference[] {
  return sources.filter((source) => source.availability === "available");
}
export function canNavigateToSource(source: SourceReference): boolean {
  return source.availability === "available";
}

export function transitionSourceAvailability(source: SourceReference, action: "preserve_evidence" | "delete" | "restore"): SourceReference {
  if (action === "restore") {
    if (source.availability === "deleted") throw new Error("Una fuente eliminada no se puede restaurar.");
    return { ...source, availability: "available" };
  }
  return { ...source, availability: action === "preserve_evidence" ? "historical_unavailable" : "deleted" };
}
