import { describe, expect, test } from "vitest";
import {
  copyDocumentContext,
  copySanitizedDocumentCorpus,
  planConversationDocumentDeletion,
  selectConversationDocuments,
} from "@/lib/assistant/documents/documentActions";

const documents = [
  { id: "d1", sanitizedSourceLabel: "Documento adicional 1", scope: { type: "conversation" as const, conversationId: "c1" }, mediaType: "txt" as const, status: "ready" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "d2", sanitizedSourceLabel: "Documento adicional 2", scope: { type: "conversation" as const, conversationId: "c2" }, mediaType: "csv" as const, status: "ready" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];

describe("general conversation documents", () => {
  test("retrieves only documents scoped to the selected conversation", () => {
    expect(selectConversationDocuments(documents, "c1").map((document) => document.id)).toEqual(["d1"]);
    expect(selectConversationDocuments(documents, "c3")).toEqual([]);
  });

  test("copies only explicitly selected sanitized context to an explicit destination", () => {
    const copied = copyDocumentContext({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"], confirmed: true }, documents);
    expect(copied).toEqual([expect.objectContaining({ id: "d1-copy-c3", scope: { type: "conversation", conversationId: "c3" }, sanitizedSourceLabel: "Documento adicional 1" })]);
    expect(() => copyDocumentContext({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d2"], confirmed: true }, documents)).toThrow(/origen/i);
    expect(() => copyDocumentContext({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: [], confirmed: true }, documents)).toThrow(/seleccionar/i);
    expect(() => copyDocumentContext({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"], confirmed: false }, documents)).toThrow(/confirmar/i);
  });

  test("copies the selected sanitized chunks and lexical index with remapped safe IDs", () => {
    const copied = copySanitizedDocumentCorpus(
      { sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"], confirmed: true },
      {
        documents,
        chunks: [{ id: "ch1", documentId: "d1", sequence: 0, content: "texto sanitizado", snippet: "texto", sanitizedHash: "abc", terms: ["texto"] }],
        searchTerms: [{ id: "t1", documentId: "d1", chunkId: "ch1", term: "texto", positions: [0] }],
        indexJobs: [{ id: "j1", documentId: "d1", status: "ready", indexedChunkIds: ["ch1"] }],
      },
    );
    expect(copied.documents[0]).toEqual(expect.objectContaining({ id: "d1-copy-c3", scope: { type: "conversation", conversationId: "c3" } }));
    expect(copied.chunks[0]).toEqual(expect.objectContaining({ id: "ch1-copy-c3", documentId: "d1-copy-c3", content: "texto sanitizado", sanitizedHash: "abc" }));
    expect(copied.searchTerms[0]).toEqual(expect.objectContaining({ id: "t1-copy-c3", documentId: "d1-copy-c3", chunkId: "ch1-copy-c3" }));
    expect(copied.indexJobs[0]).toEqual(expect.objectContaining({ id: "j1-copy-c3", documentId: "d1-copy-c3", indexedChunkIds: ["ch1-copy-c3"] }));
  });

  test("uses an explicit source-to-target map when source IDs contain -copy-", () => {
    const sourceDocument = { ...documents[0]!, id: "original-copy-special" };
    const copied = copySanitizedDocumentCorpus(
      { sourceConversationId: "c1", targetConversationId: "c3", documentIds: [sourceDocument.id], confirmed: true },
      {
        documents: [sourceDocument],
        chunks: [{ id: "chunk-copy-special", documentId: sourceDocument.id, sequence: 0, content: "texto", snippet: "texto", sanitizedHash: "abc", terms: ["texto"] }],
        searchTerms: [],
        indexJobs: [{ id: "job-copy-special", documentId: sourceDocument.id, status: "ready", indexedChunkIds: ["chunk-copy-special"] }],
      },
    );
    expect(copied.chunks[0]?.documentId).toBe("original-copy-special-copy-c3");
    expect(copied.indexJobs[0]?.documentId).toBe("original-copy-special-copy-c3");
  });

  test("deletes by default and transfers only after confirmation to a selected destination", () => {
    expect(planConversationDocumentDeletion({ conversationId: "c1" }, documents)).toEqual({ deleteDocumentIds: ["d1"], copies: [] });
    expect(() => planConversationDocumentDeletion({ conversationId: "c1", transferToConversationId: "c3", confirmed: false }, documents)).toThrow(/confirmar/i);
    expect(planConversationDocumentDeletion({ conversationId: "c1", transferToConversationId: "c3", confirmed: true }, documents)).toEqual({
      deleteDocumentIds: ["d1"],
      copies: [expect.objectContaining({ scope: { type: "conversation", conversationId: "c3" } })],
    });
  });
});
