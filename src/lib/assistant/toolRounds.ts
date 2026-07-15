import type { SourceReference } from "@/lib/assistant/domain";
import { ANALYSIS_TOOL_SCHEMAS, type AnalysisToolName } from "@/lib/assistant/tools/registry";

export interface CanonicalToolArguments {
  readonly args: unknown;
  readonly canonical: string;
  readonly hash: string;
}

export interface ProviderToolCallRecord {
  readonly executionId: string;
  readonly roundId: string;
  readonly requestId: string;
  readonly name: AnalysisToolName;
  readonly args: unknown;
  readonly argsHash: string;
  /** Ephemeral, provider-specific call state. It is never persisted or displayed. */
  readonly providerMetadata?: unknown;
}

export type ToolResultOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: true; readonly data: null; readonly empty: true; readonly message: string }
  | { readonly ok: false; readonly error: { readonly code: "tool_execution_failed" | "tool_invalid_arguments" | "tool_result_invalid" | "tool_not_available"; readonly message: string } };

export interface ProviderToolResultRecord extends Omit<ProviderToolCallRecord, "providerMetadata"> {
  readonly outcome: ToolResultOutcome;
  readonly sources: readonly SourceReference[];
}

export interface ToolRound {
  readonly executionId: string;
  readonly roundId: string;
  readonly text?: string;
  readonly calls: readonly ProviderToolCallRecord[];
  readonly results: readonly ProviderToolResultRecord[];
}

export function createLocalToolRequestId(executionId: string, roundId: string, ordinal: number): string {
  return `${executionId}:${roundId}:tool:${ordinal + 1}`;
}

export async function canonicalizeToolArguments(name: AnalysisToolName, input: unknown): Promise<CanonicalToolArguments> {
  const parsed = ANALYSIS_TOOL_SCHEMAS[name].input.parse(input);
  const args = stripUndefined(parsed);
  const canonical = canonicalJson(args);
  return { args, canonical, hash: await sha256(canonical) };
}

export function toolCallsMatch(call: Pick<ProviderToolCallRecord, "executionId" | "roundId" | "requestId" | "name" | "argsHash">, result: Pick<ProviderToolResultRecord, "executionId" | "roundId" | "requestId" | "name" | "argsHash">): boolean {
  return call.executionId === result.executionId
    && call.roundId === result.roundId
    && call.requestId === result.requestId
    && call.name === result.name
    && call.argsHash === result.argsHash;
}

export function assertEphemeralProviderMetadata(value: unknown): void {
  if (value === undefined) return;
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 16_384) throw new Error("Los metadatos nativos de la herramienta no son válidos.");
  const forbidden = /"(?:api[_-]?key|authorization|token|secret|password|result|response|sources?)"\s*:/iu;
  if (forbidden.test(serialized) || /(?:sk-|AIza)[A-Za-z0-9_-]{12,}/u.test(serialized)) throw new Error("Los metadatos nativos contienen información no permitida.");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)]));
  return value;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
