import { createHmac, timingSafeEqual } from "node:crypto";

export type ToolCallStatus = "pending" | "success" | "empty" | "failed" | "cancelled";
export type LocalToolOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: true; readonly data: null; readonly empty: true; readonly message: string }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface PendingToolCall {
  readonly requestId: string;
  readonly toolName: string;
  readonly argumentHash: string;
  readonly order: number;
  readonly status: ToolCallStatus;
}

export interface ExecutionState {
  readonly id: string;
  readonly conversationId: string;
  readonly analysisId?: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly snapshotId: string;
  readonly round: number;
  readonly status: "running" | "waiting_for_tools" | "ready_to_continue" | "completed" | "cancelled";
  readonly nativeState: unknown;
  readonly pendingCalls: readonly PendingToolCall[];
  readonly recoveredSourceRefIds: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface LocalToolBatchResult {
  readonly requestId: string;
  readonly toolName: string;
  readonly outcome: LocalToolOutcome;
  readonly sourceRefIds: readonly string[];
}

export interface ExecutionStateStore {
  create(state: ExecutionState): Promise<void>;
  get(id: string): Promise<ExecutionState>;
  mutate(id: string, update: (current: ExecutionState) => ExecutionState): Promise<ExecutionState>;
  delete(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

function executionError(code: string): Error { return new Error(code); }

export class InMemoryExecutionStateStore implements ExecutionStateStore {
  private readonly states = new Map<string, ExecutionState>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly clock: () => number = Date.now) {}

  async create(state: ExecutionState): Promise<void> {
    if (this.states.has(state.id)) throw executionError("execution_exists");
    this.states.set(state.id, structuredClone(state));
  }

  async get(id: string): Promise<ExecutionState> {
    const state = this.states.get(id);
    if (!state || state.expiresAt <= this.clock()) {
      this.states.delete(id);
      throw executionError("execution_expired");
    }
    return structuredClone(state);
  }

  async mutate(id: string, update: (current: ExecutionState) => ExecutionState): Promise<ExecutionState> {
    let resolveResult!: (state: ExecutionState) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<ExecutionState>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.queue = this.queue.then(async () => {
      try {
        const current = await this.get(id);
        const next = update(current);
        this.states.set(id, structuredClone(next));
        resolveResult(structuredClone(next));
      } catch (error) { rejectResult(error); }
    });
    await this.queue;
    return result;
  }

  async delete(id: string): Promise<void> { this.states.delete(id); }
  async cancel(id: string): Promise<void> { this.states.delete(id); }
}

interface ContinuationClaims {
  readonly executionId: string;
  readonly conversationId: string;
  readonly analysisId?: string;
  readonly round: number;
  readonly snapshotId: string;
  readonly expiresAt: number;
  readonly calls: readonly Pick<PendingToolCall, "requestId" | "toolName" | "argumentHash" | "order">[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export class ContinuationSigner {
  constructor(private readonly secret: string, private readonly clock: () => number = Date.now) {
    if (secret.length < 32) throw new Error("continuation_secret_too_short");
  }

  signRound(state: ExecutionState): string {
    const claims: ContinuationClaims = {
      executionId: state.id,
      conversationId: state.conversationId,
      ...(state.analysisId ? { analysisId: state.analysisId } : {}),
      round: state.round,
      snapshotId: state.snapshotId,
      expiresAt: state.expiresAt,
      calls: state.pendingCalls.map(({ requestId, toolName, argumentHash, order }) => ({ requestId, toolName, argumentHash, order })),
    };
    const payload = Buffer.from(canonical(claims)).toString("base64url");
    return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`;
  }

  verify(token: string): ContinuationClaims {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw executionError("continuation_token_invalid");
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    let received: Buffer;
    try { received = Buffer.from(signature, "base64url"); } catch { throw executionError("continuation_token_invalid"); }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw executionError("continuation_token_invalid");
    let claims: ContinuationClaims;
    try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ContinuationClaims; } catch { throw executionError("continuation_token_invalid"); }
    if (claims.expiresAt <= this.clock()) throw executionError("execution_expired");
    return claims;
  }
}

function outcomeStatus(outcome: LocalToolOutcome): ToolCallStatus {
  if (!outcome.ok) return outcome.error.code === "cancelled" ? "cancelled" : "failed";
  return "empty" in outcome && outcome.empty ? "empty" : "success";
}

export interface AtomicBatchInput {
  readonly token: string;
  readonly executionId: string;
  readonly conversationId: string;
  readonly analysisId?: string;
  readonly round: number;
  readonly snapshotId: string;
  readonly results: readonly LocalToolBatchResult[];
}

export async function acceptAtomicToolBatch(
  store: ExecutionStateStore,
  signer: ContinuationSigner,
  input: AtomicBatchInput,
): Promise<ExecutionState> {
  await store.get(input.executionId);
  const claims = signer.verify(input.token);
  const scopeMatches = claims.executionId === input.executionId && claims.conversationId === input.conversationId
    && claims.analysisId === input.analysisId && claims.round === input.round && claims.snapshotId === input.snapshotId;
  if (!scopeMatches) throw executionError("continuation_token_invalid");
  return store.mutate(input.executionId, (state) => {
    if (state.status !== "waiting_for_tools") throw executionError("continuation_already_consumed");
    if (state.pendingCalls.length !== input.results.length) throw executionError("tool_batch_incomplete");
    for (let index = 0; index < state.pendingCalls.length; index += 1) {
      const expected = state.pendingCalls[index]!;
      const signed = claims.calls[index];
      const actual = input.results[index]!;
      if (!signed || signed.requestId !== expected.requestId || signed.toolName !== expected.toolName || signed.argumentHash !== expected.argumentHash || signed.order !== expected.order) throw executionError("continuation_token_invalid");
      if (actual.requestId !== expected.requestId || actual.toolName !== expected.toolName) throw executionError("tool_batch_order_invalid");
    }
    return {
      ...state,
      status: "ready_to_continue",
      pendingCalls: state.pendingCalls.map((call, index) => ({ ...call, status: outcomeStatus(input.results[index]!.outcome) })),
      recoveredSourceRefIds: [...new Set([...state.recoveredSourceRefIds, ...input.results.flatMap((result) => result.sourceRefIds)])],
    };
  });
}
