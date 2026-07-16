import { describe, expect, it } from "vitest";
import { createScopeSnapshot, normalizeScopedToolArguments, assertToolAllowedBySnapshot } from "@/lib/assistant/execution/scopeSnapshot";

describe("immutable analysis scope snapshots", () => {
  it("freezes the selected people, principal, documents and strategy for the whole execution", async () => {
    const associated = ["10048"];
    const documents = ["pdf-1"];
    const snapshot = await createScopeSnapshot({ analysisId: "a1", analysisVersion: "v1", strategy: "associated_people", associatedPersonIds: associated, primaryPersonId: "10048", documentIds: documents, allowedTools: ["getPersonProfile"] });
    associated.push("10050");
    documents.push("xlsx-2");
    expect(snapshot.associatedPersonIds).toEqual(["10048"]);
    expect(snapshot.documentIds).toEqual(["pdf-1"]);
    expect(snapshot.id).toMatch(/^scope-/);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("lets an explicit employee id override the primary and rejects people outside associated scope", async () => {
    const snapshot = await createScopeSnapshot({ analysisId: "a1", analysisVersion: "v1", strategy: "associated_people", associatedPersonIds: ["10048", "10050"], primaryPersonId: "10048", explicitPersonIds: ["10050"], documentIds: [], allowedTools: ["getPersonProfile"] });
    expect(normalizeScopedToolArguments(snapshot, "getPersonProfile", { analysisId: "a1" })).toEqual({ analysisId: "a1", personId: "10050" });
    expect(() => assertToolAllowedBySnapshot(snapshot, "getPersonProfile", { analysisId: "a1", personId: "99999" })).toThrow("person_outside_authorized_scope");
  });

  it("allows only aggregate summary without associated people and keeps full analysis demand-driven", async () => {
    const empty = await createScopeSnapshot({ analysisId: "a1", analysisVersion: "v1", strategy: "associated_people", associatedPersonIds: [], documentIds: ["pdf-1"], allowedTools: ["getAnalysisSummary", "searchDocumentChunks"] });
    expect(() => assertToolAllowedBySnapshot(empty, "getAnalysisSummary", { analysisId: "a1" })).not.toThrow();
    expect(() => assertToolAllowedBySnapshot(empty, "searchDocumentChunks", { analysisId: "a1", query: "todo" })).toThrow("associated_people_required");

    const full = await createScopeSnapshot({ analysisId: "a1", analysisVersion: "v1", strategy: "full_analysis", associatedPersonIds: [], documentIds: ["pdf-1"], allowedTools: ["searchDocumentChunks"] });
    expect(() => assertToolAllowedBySnapshot(full, "searchDocumentChunks", { analysisId: "a1", query: "diferencia", limit: 10 })).not.toThrow();
    expect(() => assertToolAllowedBySnapshot(full, "searchDocumentChunks", { analysisId: "a1", query: "", limit: 50 })).toThrow("tool_query_too_broad");
  });
});
