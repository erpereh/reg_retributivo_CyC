import { describe, expect, test } from "vitest";
import type { SourceReference } from "@/lib/assistant/domain";
import { canNavigateToSource, sourcesForRetrieval, transitionSourceAvailability } from "@/lib/assistant/sources/sourceLifecycle";

function source(id: string, availability: SourceReference["availability"]): SourceReference {
  return { id, conversationId: "c1", sourceType: "document", sanitizedSourceLabel: `Documento ${id}`, availability, conceptIds: [], excerpt: "texto sanitizado", sanitizedHash: id };
}

describe("source lifecycle", () => {
  test("only available sources participate in retrieval and navigation", () => {
    const sources = [source("available", "available"), source("history", "historical_unavailable"), source("deleted", "deleted")];
    expect(sourcesForRetrieval(sources).map((item) => item.id)).toEqual(["available"]);
    expect(canNavigateToSource(sources[0]!)).toBe(true);
    expect(canNavigateToSource(sources[1]!)).toBe(false);
    expect(canNavigateToSource(sources[2]!)).toBe(false);
  });

  test("preserves cited evidence as historical and makes deleted sources inert", () => {
    expect(transitionSourceAvailability(source("s1", "available"), "preserve_evidence").availability).toBe("historical_unavailable");
    expect(transitionSourceAvailability(source("s1", "available"), "delete").availability).toBe("deleted");
    expect(() => transitionSourceAvailability(source("s1", "deleted"), "restore")).toThrow(/restaurar/i);
  });
});
