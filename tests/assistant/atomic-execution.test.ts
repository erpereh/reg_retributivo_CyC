import { describe, expect, it } from "vitest";
import {
  ContinuationSigner,
  InMemoryExecutionStateStore,
  acceptAtomicToolBatch,
  type ExecutionState,
  type LocalToolBatchResult,
} from "@/lib/assistant/execution/state";

const now = Date.parse("2026-07-16T10:00:00.000Z");

function execution(): ExecutionState {
  return {
    id: "exec-1",
    conversationId: "conversation-1",
    analysisId: "analysis-1",
    providerId: "provider-1",
    modelId: "model-1",
    snapshotId: "snapshot-1",
    round: 1,
    status: "waiting_for_tools",
    nativeState: { opaque: "server-only" },
    pendingCalls: [
      { requestId: "call-1", toolName: "getPersonProfile", argumentHash: "hash-1", order: 0, status: "pending" },
      { requestId: "call-2", toolName: "getPersonConcepts", argumentHash: "hash-2", order: 1, status: "pending" },
    ],
    recoveredSourceRefIds: [],
    createdAt: now,
    expiresAt: now + 15 * 60_000,
  };
}

function result(requestId: string, toolName: string): LocalToolBatchResult {
  return { requestId, toolName, outcome: { ok: true, data: { safe: true } }, sourceRefIds: [] };
}

describe("atomic native tool continuation", () => {
  it("accepts the complete ordered batch once and invalidates its token", async () => {
    const store = new InMemoryExecutionStateStore(() => now);
    const signer = new ContinuationSigner("0123456789abcdef0123456789abcdef", () => now);
    await store.create(execution());
    const token = signer.signRound(execution());

    const accepted = await acceptAtomicToolBatch(store, signer, {
      token,
      executionId: "exec-1",
      conversationId: "conversation-1",
      analysisId: "analysis-1",
      round: 1,
      snapshotId: "snapshot-1",
      results: [result("call-1", "getPersonProfile"), result("call-2", "getPersonConcepts")],
    });

    expect(accepted.pendingCalls.map((call) => call.status)).toEqual(["success", "success"]);
    expect(accepted.status).toBe("ready_to_continue");
    await expect(acceptAtomicToolBatch(store, signer, {
      token, executionId: "exec-1", conversationId: "conversation-1", analysisId: "analysis-1", round: 1, snapshotId: "snapshot-1",
      results: [result("call-1", "getPersonProfile"), result("call-2", "getPersonConcepts")],
    })).rejects.toThrow("continuation_already_consumed");
  });

  it("rejects partial, reordered, altered-scope and expired batches", async () => {
    let clock = now;
    const store = new InMemoryExecutionStateStore(() => clock);
    const signer = new ContinuationSigner("0123456789abcdef0123456789abcdef", () => clock);
    await store.create(execution());
    const token = signer.signRound(execution());
    const base = { token, executionId: "exec-1", conversationId: "conversation-1", analysisId: "analysis-1", round: 1, snapshotId: "snapshot-1" };

    await expect(acceptAtomicToolBatch(store, signer, { ...base, results: [result("call-1", "getPersonProfile")] })).rejects.toThrow("tool_batch_incomplete");
    await expect(acceptAtomicToolBatch(store, signer, { ...base, results: [result("call-2", "getPersonConcepts"), result("call-1", "getPersonProfile")] })).rejects.toThrow("tool_batch_order_invalid");
    await expect(acceptAtomicToolBatch(store, signer, { ...base, conversationId: "other", results: [result("call-1", "getPersonProfile"), result("call-2", "getPersonConcepts")] })).rejects.toThrow("continuation_token_invalid");
    clock = now + 16 * 60_000;
    await expect(acceptAtomicToolBatch(store, signer, { ...base, results: [result("call-1", "getPersonProfile"), result("call-2", "getPersonConcepts")] })).rejects.toThrow("execution_expired");
  });

  it("removes state on cancellation and never exposes native state in signed claims", async () => {
    const store = new InMemoryExecutionStateStore(() => now);
    const signer = new ContinuationSigner("0123456789abcdef0123456789abcdef", () => now);
    const state = execution();
    await store.create(state);
    const token = signer.signRound(state);
    expect(Buffer.from(token.split(".")[0]!, "base64url").toString()).not.toContain("server-only");
    await store.cancel("exec-1");
    await expect(store.get("exec-1")).rejects.toThrow("execution_expired");
  });
});
