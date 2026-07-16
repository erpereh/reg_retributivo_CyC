// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ChatAction, ChatMessage, Conversation, SourceReference } from "@/lib/assistant/domain";
import { executeChatAction } from "@/lib/assistant/integrations/actions";
import { canonicalizeAnalysis, createAnalysisVersionSnapshot, syncAnalysisVersion } from "@/lib/assistant/integrations/analysisVersion";
import { createAnalysisCleanupJob, resumeAnalysisCleanupJobs, runAnalysisCleanupBatch, runAnalysisCleanupJob } from "@/lib/assistant/integrations/analysisCleanup";
import { continuePersonInAssistant } from "@/lib/assistant/integrations/personIntegration";
import { ASSISTANT_DB_VERSION, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";

const now = "2026-07-13T12:00:00.000Z";
const conversation = (id: string, analysisId = "a1"): Conversation => ({
  id, type: "analysis", analysisId, title: "Análisis", associatedPersonIds: [], modelProfileId: "model",
  responseMode: "strict", contextStrategy: "automatic", analysisVersion: "old", status: "active", createdAt: now, updatedAt: now,
});
const message = (id: string, conversationId: string): ChatMessage => ({
  id, conversationId, role: "assistant", content: "Histórico", status: "completed", contextOrigin: "analysis", modelProfileId: "model",
  responseMode: "strict", contextStrategy: "automatic", analysisVersion: "old", sourceRefIds: [], actionIds: [], createdAt: now,
});
const ingestionBlock = (analysisId = "a1") => ({
  document: { id: `doc-${analysisId}`, sanitizedSourceLabel: "Documento", scope: { type: "analysis" as const, analysisId }, mediaType: "txt" as const, status: "ready" as const, createdAt: now, updatedAt: now },
  chunks: [{ id: `chunk-${analysisId}`, documentId: `doc-${analysisId}`, sequence: 0, content: "dato saneado", snippet: "dato", sanitizedHash: "hash", terms: ["dato"] }],
  searchTerms: [{ id: `term-${analysisId}`, documentId: `doc-${analysisId}`, chunkId: `chunk-${analysisId}`, term: "dato", positions: [0] }],
  indexJob: { id: `index-${analysisId}`, documentId: `doc-${analysisId}`, status: "ready" as const, indexedChunkIds: [`chunk-${analysisId}`] },
});

describe("Phase 6 core integrations", () => {
  let factory: IDBFactory;
  beforeEach(() => { factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange); });

  test("migrates the assistant database to schema 5 with cleanup indexes and legacy backup", async () => {
    const db = await openAssistantDatabase(factory, "phase6-schema");
    expect(ASSISTANT_DB_VERSION).toBe(5);
    expect(db.version).toBe(5);
    expect(db.objectStoreNames.contains("modelProfiles")).toBe(true);
    const cleanup = db.transaction("cleanupJobs").objectStore("cleanupJobs");
    expect(Array.from(cleanup.indexNames)).toEqual(expect.arrayContaining(["status", "analysisId", "statusUpdatedAt"]));
    db.close();
  });

  test("canonicalizes only calculation data deterministically and hashes privately", async () => {
    const left = { people: [{ person: "Ana Privada", employeeNumber: "001", totalDifference: -0, status: "OK", files: ["c:/secret.pdf"] }], config: { tolerance: 1 }, metadata: { author: "Ana" } };
    const right = { metadata: { author: "Otra" }, config: { tolerance: 1 }, people: [{ files: ["otro.pdf"], status: "OK", totalDifference: 0, employeeNumber: "001", person: "Otra" }] };
    expect(canonicalizeAnalysis(left)).toBe(canonicalizeAnalysis(right));
    expect(canonicalizeAnalysis(left)).toBe('{"config":{"tolerance":1},"people":[{"employeeNumber":"001","status":"OK","totalDifference":0}]}');
    const first = await createAnalysisVersionSnapshot("a1", left, now);
    const second = await createAnalysisVersionSnapshot("a1", right, now);
    expect(first.analysisVersion).toBe(second.analysisVersion);
    expect(first).not.toHaveProperty("canonical");
  });

  test("hashes analyses above the former canonical limit without persisting the canonical payload", async () => {
    const oversizedAnalysis = { result: { concepts: [{ code: "C-1", status: "x".repeat(2_000_100), amount: 208 }] } };
    const snapshot = await createAnalysisVersionSnapshot("a-large", oversizedAnalysis, now);

    expect(snapshot.analysisVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot).not.toHaveProperty("canonical");
    expect(JSON.stringify(snapshot).length).toBeLessThan(512);
  });

  test("updates only future conversation context and preserves historical message versions", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-version" });
    await repositories.conversations.put(conversation("c1"));
    await repositories.messages.put(message("m1", "c1"));
    const result = await syncAnalysisVersion(repositories, "a1", { people: [{ employeeNumber: "001", totalDifference: 5, status: "Diferencia" }] }, now);
    expect(result.changed).toBe(true);
    expect((await repositories.conversations.get("c1"))?.analysisVersion).toBe(result.snapshot.analysisVersion);
    expect((await repositories.messages.get("m1"))?.analysisVersion).toBe("old");
    expect((await repositories.events.listByConversation("c1"))[0]?.event.type).toBe("analysis_updated");
    repositories.close();
  });

  test("continues a person in an off-page same-analysis conversation without sending", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-person" });
    for (let index = 0; index < 60; index += 1) await repositories.conversations.put(conversation(`other-${index}`, "other"));
    await repositories.conversations.put({ ...conversation("same"), associatedPersonIds: ["001"] });
    const send = vi.fn();
    const selected = await continuePersonInAssistant({ repositories, analysisId: "a1", analysisVersion: "v1", personId: "001", modelProfileId: "model", now, send });
    expect(selected.id).toBe("same");
    expect(selected.associatedPersonIds).toEqual(["001"]);
    expect(selected.primaryPersonId).toBe("001");
    expect(send).not.toHaveBeenCalled();
    expect(await repositories.conversations.get("other-1")).toEqual(expect.objectContaining({ analysisId: "other" }));
    repositories.close();
  });

  test("validates and persists safe actions and rejects cross-analysis entities", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-actions" });
    await repositories.conversations.put({ ...conversation("c1"), associatedPersonIds: ["001"] });
    await repositories.messages.put(message("m1", "c1"));
    const action: ChatAction = { id: "act1", conversationId: "c1", messageId: "m1", label: "Abrir", description: "Abrir persona", action: { type: "open_person", analysisId: "a1", personId: "001" }, status: "pending", createdAt: now };
    await repositories.actions.put(action);
    const accepted = await executeChatAction({ action, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now });
    expect(accepted.status).toBe("accepted");
    expect(accepted.intent).toEqual({ type: "open_person", analysisId: "a1", personId: "001" });
    expect((await repositories.actions.get("act1"))?.status).toBe("accepted");
    const { intent: _intent, output: _output, ...resolvedAction } = accepted;
    await expect(executeChatAction({ action: resolvedAction, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now })).rejects.toThrow(/resuelta/i);
    expect((await repositories.actions.get("act1"))?.status).toBe("accepted");
    const invalid = { ...action, id: "act2", action: { type: "open_person" as const, analysisId: "other", personId: "001" } };
    await repositories.actions.put(invalid);
    await expect(executeChatAction({ action: invalid, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now })).rejects.toThrow(/análisis/i);
    expect((await repositories.actions.get("act2"))?.status).toBe("rejected");
    repositories.close();
  });

  test("preserves historical evidence read-only and resumes cleanup idempotently", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-cleanup" });
    await repositories.conversations.put(conversation("c1"));
    await repositories.messages.put(message("m1", "c1"));
    const source: SourceReference = { id: "s1", conversationId: "c1", messageId: "m1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Análisis", availability: "available", conceptIds: [], excerpt: "dato", sanitizedHash: "hash" };
    await repositories.sources.put(source);
    await repositories.documents.put({ id: "d1", sanitizedSourceLabel: "Doc", scope: { type: "analysis", analysisId: "a1" }, mediaType: "txt", status: "ready", createdAt: now, updatedAt: now });
    await repositories.chunks.put({ id: "ch1", documentId: "d1", analysisId: "a1", content: "dato" });
    const job = createAnalysisCleanupJob("a1", "preserve_conversations", now);
    await repositories.cleanupJobs.put(job);
    const deleteFunctional = vi.fn();
    await runAnalysisCleanupJob(repositories, job.id, deleteFunctional, now);
    await runAnalysisCleanupJob(repositories, job.id, deleteFunctional, now);
    expect((await repositories.conversations.get("c1"))?.status).toBe("archived_analysis_deleted");
    expect((await repositories.sources.get("s1"))?.availability).toBe("historical_unavailable");
    expect(await repositories.documents.get("d1")).toBeUndefined();
    expect(await repositories.chunks.get("ch1")).toBeUndefined();
    expect(deleteFunctional).toHaveBeenCalledTimes(1);
    expect((await repositories.cleanupJobs.get(job.id))?.status).toBe("completed");
    repositories.close();
  });

  test("delete_all cascades assistant data but keeps general conversation documents isolated", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-delete-all" });
    await repositories.conversations.put(conversation("analysis-c"));
    const { analysisId: _analysisId, analysisVersion: _analysisVersion, ...generalBase } = conversation("general-c");
    await repositories.conversations.put({ ...generalBase, type: "general" });
    await repositories.messages.put(message("analysis-m", "analysis-c"));
    await repositories.documents.put({ id: "analysis-d", sanitizedSourceLabel: "Análisis", scope: { type: "analysis", analysisId: "a1" }, mediaType: "txt", status: "ready", createdAt: now, updatedAt: now });
    await repositories.documents.put({ id: "general-d", sanitizedSourceLabel: "General", scope: { type: "conversation", conversationId: "general-c" }, mediaType: "txt", status: "ready", createdAt: now, updatedAt: now });
    const job = createAnalysisCleanupJob("a1", "delete_all", now); await repositories.cleanupJobs.put(job);
    await runAnalysisCleanupJob(repositories, job.id, vi.fn(), now);
    expect(await repositories.conversations.get("analysis-c")).toBeUndefined();
    expect(await repositories.messages.get("analysis-m")).toBeUndefined();
    expect(await repositories.documents.get("analysis-d")).toBeUndefined();
    expect(await repositories.documents.get("general-d")).toBeTruthy();
    repositories.close();
  });

  test("copy_document_context requires explicit scoped conversations and remaps sanitized corpus", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-copy-action" });
    const { analysisId: _sourceAnalysisId, analysisVersion: _sourceVersion, ...sourceBase } = conversation("source");
    const source = { ...sourceBase, type: "general" as const };
    const target = { ...source, id: "target" };
    await repositories.conversations.put(source); await repositories.conversations.put(target); await repositories.messages.put(message("m-copy", "source"));
    await repositories.writeIngestionBlock({
      document: { id: "d-copy", sanitizedSourceLabel: "Documento adicional 1", scope: { type: "conversation", conversationId: "source" }, mediaType: "txt", status: "ready", createdAt: now, updatedAt: now },
      chunks: [{ id: "chunk-copy", documentId: "d-copy", sequence: 0, content: "contenido sanitizado", snippet: "contenido", sanitizedHash: "hash", terms: ["contenido"] }],
      searchTerms: [{ id: "term-copy", documentId: "d-copy", chunkId: "chunk-copy", term: "contenido", positions: [0] }],
      indexJob: { id: "index-copy", documentId: "d-copy", status: "ready", indexedChunkIds: ["chunk-copy"] },
    });
    const action: ChatAction = { id: "copy-action", conversationId: "source", messageId: "m-copy", label: "Copiar", description: "Copiar contexto", action: { type: "copy_document_context", sourceConversationId: "source", targetConversationId: "target", documentIds: ["d-copy"] }, status: "pending", createdAt: now };
    await repositories.actions.put(action);
    await executeChatAction({ action, repositories, now });
    expect(await repositories.documents.get("d-copy-copy-target")).toEqual(expect.objectContaining({ scope: { type: "conversation", conversationId: "target" } }));
    expect(await repositories.documents.get("d-copy")).toBeTruthy();
    repositories.close();
  });

  test("resumes failed cleanup jobs independently when another retry still fails", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-resume-failed" });
    const first = createAnalysisCleanupJob("a-fails", "delete_all", now);
    const second = createAnalysisCleanupJob("a-recovers", "delete_all", now);
    await repositories.cleanupJobs.put({ ...first, status: "failed", lastError: "sanitized" });
    await repositories.cleanupJobs.put({ ...second, status: "failed", lastError: "sanitized" });
    await expect(resumeAnalysisCleanupJobs(repositories, async (analysisId) => {
      if (analysisId === "a-fails") throw new Error("boom");
    })).resolves.toBeUndefined();
    expect((await repositories.cleanupJobs.get(first.id))?.status).toBe("failed");
    expect((await repositories.cleanupJobs.get(second.id))?.status).toBe("completed");
    repositories.close();
  });

  test("persists every cleanup job before executing a resilient batch", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-cleanup-batch" });
    const observedCounts: number[] = [];
    await expect(runAnalysisCleanupBatch(repositories, ["a-first", "a-second"], "delete_all", async (analysisId) => {
      observedCounts.push((await repositories.cleanupJobs.listByStatus(["pending", "running", "completed", "failed"])).length);
      if (analysisId === "a-first") throw new Error("boom");
    }, now)).rejects.toThrow("1 limpiezas");
    expect(observedCounts).toEqual([2, 2]);
    expect((await repositories.cleanupJobs.get("cleanup-a-first-delete_all"))?.status).toBe("failed");
    expect((await repositories.cleanupJobs.get("cleanup-a-second-delete_all"))?.status).toBe("completed");
    repositories.close();
  });

  test("refuses an in-flight conversation block after cleanup made it historical", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-active-write-cas" });
    await repositories.conversations.put(conversation("c-race"));
    await repositories.cleanupAnalysis("a1", "preserve_conversations");
    await expect(repositories.writeConversationBlock({
      conversation: conversation("c-race"), messages: [message("late-message", "c-race")], sources: [],
    })).rejects.toThrow();
    expect(await repositories.messages.get("late-message")).toBeUndefined();
    expect((await repositories.conversations.get("c-race"))?.status).toBe("archived_analysis_deleted");
    repositories.close();
  });

  test("preserves dangling referenced sources and deletes orphan corpus for analysis conversations", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-cleanup-ownership" });
    await repositories.conversations.put(conversation("c-owned"));
    await repositories.messages.put({ ...message("m-owned", "c-owned"), sourceRefIds: ["source-dangling"] });
    await repositories.sources.put({ id: "source-dangling", conversationId: "c-owned", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Evidencia", availability: "available", conceptIds: [], excerpt: "dato", sanitizedHash: "hash" });
    await repositories.sources.put({ id: "source-unused", conversationId: "c-owned", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Sobrante", availability: "available", conceptIds: [], excerpt: "dato", sanitizedHash: "hash" });
    await repositories.documents.put({ id: "doc-owned", sanitizedSourceLabel: "Copiado", scope: { type: "conversation", conversationId: "c-owned" }, mediaType: "txt", status: "ready", createdAt: now, updatedAt: now });
    await repositories.chunks.put({ id: "chunk-owned", documentId: "doc-owned", content: "dato" });
    await repositories.searchTerms.put({ id: "term-owned", documentId: "doc-owned", chunkId: "chunk-owned", term: "dato" });
    await repositories.indexJobs.put({ id: "job-owned", documentId: "doc-owned", status: "ready", indexedChunkIds: ["chunk-owned"] });
    await repositories.cache.put({ id: "cache-owned", documentId: "doc-owned", value: "dato" });
    await repositories.cleanupAnalysis("a1", "preserve_conversations");
    expect(await repositories.sources.get("source-dangling")).toMatchObject({ availability: "historical_unavailable" });
    expect(await repositories.sources.get("source-unused")).toBeUndefined();
    for (const [repository, id] of [[repositories.documents, "doc-owned"], [repositories.chunks, "chunk-owned"], [repositories.searchTerms, "term-owned"], [repositories.indexJobs, "job-owned"], [repositories.cache, "cache-owned"]] as const) expect(await repository.get(id)).toBeUndefined();
    repositories.close();
  });

  test("rolls back snapshot, conversation version and event as one transaction", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-version-atomic" });
    await repositories.conversations.put(conversation("c-atomic"));
    const snapshot = await createAnalysisVersionSnapshot("a1", { people: [{ employeeNumber: "001", totalDifference: 9 }] }, now);
    await expect(repositories.syncAnalysisVersion({ snapshot: { ...snapshot, id: undefined } as never, analysisId: "a1", updatedAt: now })).rejects.toThrow();
    expect((await repositories.conversations.get("c-atomic"))?.analysisVersion).toBe("old");
    expect(await repositories.events.listByConversation("c-atomic")).toEqual([]);
    expect(await repositories.analysisVersions.get(snapshot.id)).toBeUndefined();
    repositories.close();
  });

  test("propagates a sanitized aggregate batch failure after processing every job", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-batch-failure" });
    const attempted: string[] = [];
    await expect(runAnalysisCleanupBatch(repositories, ["a-first", "a-second"], "delete_all", async (analysisId) => {
      attempted.push(analysisId);
      if (analysisId === "a-first") throw new Error("private failure details");
    }, now)).rejects.toThrow("No se pudieron completar 1 limpiezas coordinadas.");
    expect(attempted).toEqual(["a-first", "a-second"]);
    expect((await repositories.cleanupJobs.get("cleanup-a-first-delete_all"))?.status).toBe("failed");
    expect((await repositories.cleanupJobs.get("cleanup-a-second-delete_all"))?.status).toBe("completed");
    repositories.close();
  });

  test("uses persisted action identity as a CAS and accepts at most one concurrent resolution", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-action-cas" });
    await repositories.conversations.put(conversation("c-action"));
    await repositories.messages.put(message("m-action", "c-action"));
    const pending: ChatAction = { id: "action-cas", conversationId: "c-action", messageId: "m-action", label: "Asociar", description: "Asociar persona", action: { type: "add_person", analysisId: "a1", personId: "001" }, status: "pending", createdAt: now };
    await repositories.actions.put(pending);
    const input = { action: pending, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now };
    const concurrent = await Promise.allSettled([executeChatAction(input), executeChatAction(input)]);
    expect(concurrent.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect((await repositories.actions.get(pending.id))?.status).toBe("accepted");
    expect((await repositories.events.listByConversation("c-action")).filter((event) => event.event.type === "action_accepted")).toHaveLength(1);
    expect((await repositories.conversations.get("c-action"))?.associatedPersonIds).toEqual(["001"]);
    repositories.close();
  });

  test("rejects a same-id action whose payload differs from the persisted proposal", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-action-identity" });
    await repositories.conversations.put(conversation("c-action")); await repositories.messages.put(message("m-action", "c-action"));
    const persisted: ChatAction = { id: "action-identity", conversationId: "c-action", messageId: "m-action", label: "Abrir", description: "Abrir persona", action: { type: "open_person", analysisId: "a1", personId: "001" }, status: "pending", createdAt: now };
    await repositories.actions.put(persisted);
    await expect(executeChatAction({ action: { ...persisted, action: { type: "add_person", analysisId: "a1", personId: "001" } }, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now })).rejects.toThrow(/propuesta|disponible|identidad/i);
    expect(await repositories.actions.get(persisted.id)).toEqual(persisted);
    expect((await repositories.conversations.get("c-action"))?.associatedPersonIds).toEqual([]);
    repositories.close();
  });

  test.each(["preserve_conversations", "delete_all"] as const)("keeps cleanup terminal against stale version sync and conversation creation (%s)", async (policy) => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: `phase6-terminal-${policy}` });
    await repositories.conversations.put(conversation("terminal-conversation"));
    await repositories.cleanupAnalysis("a1", policy);
    const snapshot = await createAnalysisVersionSnapshot("a1", { people: [{ employeeNumber: "001", totalDifference: 4 }] }, now);
    await expect(repositories.syncAnalysisVersion({ snapshot, analysisId: "a1", updatedAt: now })).rejects.toThrow();
    expect(await repositories.analysisVersions.get(snapshot.id)).toBeUndefined();
    expect(await repositories.events.listByConversation("terminal-conversation")).toEqual([]);
    await expect(repositories.continueAnalysisPerson({ analysisId: "a1", analysisVersion: snapshot.analysisVersion, personId: "001", modelProfileId: "model", updatedAt: now })).resolves.toBeUndefined();
    await expect(repositories.writeConversationBlock({ conversation: conversation("late-conversation"), messages: [message("late-message", "late-conversation")], sources: [] })).rejects.toThrow();
    expect((await repositories.conversations.list({ limit: 20 })).items.filter((item) => item.analysisId === "a1" && item.status === "active")).toEqual([]);
    expect(await repositories.messages.get("late-message")).toBeUndefined();
    repositories.close();
  });

  test("blocks every delayed analysis ingestion and conversion writer after cleanup", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-terminal-ingestion" });
    await repositories.conversations.put({ id: "general-before-cleanup", type: "general", title: "General", associatedPersonIds: [], modelProfileId: "model", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: now, updatedAt: now });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "stale-ingestion" });
    await repositories.cleanupAnalysis("a1", "delete_all");
    await expect(repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "late-ingestion" })).rejects.toThrow();
    await expect(repositories.writeIngestionBlock(ingestionBlock())).rejects.toThrow();
    await expect(repositories.replaceAnalysisCorpus({ analysisId: "a1", ingestionId: "stale-ingestion", blocks: [ingestionBlock()] })).resolves.toBe(false);
    await expect(repositories.convertConversationToAnalysis({ conversationId: "general-before-cleanup", analysisId: "a1", analysisVersion: "late-version", convertedAt: now })).resolves.toBeUndefined();
    expect(await repositories.documents.get("doc-a1")).toBeUndefined();
    expect(await repositories.chunks.get("chunk-a1")).toBeUndefined();
    expect(await repositories.conversations.get("general-before-cleanup")).toMatchObject({ type: "general" });
    expect(await repositories.events.listByConversation("general-before-cleanup")).toEqual([]);
    repositories.close();
  });

  test.each([
    { name: "missing conversation", setup: async () => undefined },
    { name: "historical conversation", setup: async (repositories: Awaited<ReturnType<typeof createIndexedDbRepositories>>) => { await repositories.conversations.put({ ...conversation("action-terminal"), status: "archived_analysis_deleted" }); await repositories.messages.put(message("action-message", "action-terminal")); } },
    { name: "mismatched message", setup: async (repositories: Awaited<ReturnType<typeof createIndexedDbRepositories>>) => { await repositories.conversations.put(conversation("action-terminal")); await repositories.conversations.put(conversation("other-conversation", "other")); await repositories.messages.put(message("action-message", "other-conversation")); } },
  ])("terminally rejects an exact pending action with $name", async ({ name, setup }) => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: `phase6-action-terminal-${name.replaceAll(" ", "-")}` });
    await setup(repositories);
    const pending: ChatAction = { id: "terminal-action", conversationId: "action-terminal", messageId: "action-message", label: "Asociar", description: "Asociar persona", action: { type: "add_person", analysisId: "a1", personId: "001" }, status: "pending", createdAt: now };
    await repositories.actions.put(pending);
    await expect(executeChatAction({ action: pending, repositories, analysis: { id: "a1", result: { people: [{ employeeNumber: "001" }] } as never }, now })).rejects.toThrow();
    expect(await repositories.actions.get(pending.id)).toMatchObject({ status: "rejected", resolvedAt: now });
    expect((await repositories.events.listByConversation("action-terminal")).filter((event) => event.event.type === "action_rejected")).toHaveLength(1);
    expect((await repositories.conversations.get("action-terminal"))?.associatedPersonIds ?? []).toEqual([]);
    repositories.close();
  });
});
