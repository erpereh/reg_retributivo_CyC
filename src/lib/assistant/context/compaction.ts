export interface CompactableMessage { readonly id: string; readonly content: string; readonly tokens: number }
export interface ContextSnapshotLineage {
  readonly id: string;
  readonly summarizedMessageIds: readonly string[];
  readonly decisions: readonly string[];
  readonly figures: readonly number[];
  readonly sourceIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly personIds: readonly string[];
  readonly analysisVersion: string;
}
export interface CompactionInput {
  readonly messages: readonly CompactableMessage[];
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly figures: readonly number[];
  readonly sourceIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly personIds: readonly string[];
  readonly analysisVersion: string;
  readonly keepRecent: number;
  readonly idFactory?: () => string;
}
export function compactContextPayload(input: CompactionInput): { readonly payloadMessages: readonly CompactableMessage[]; readonly snapshot: ContextSnapshotLineage } {
  if (!Number.isInteger(input.keepRecent) || input.keepRecent < 0 || input.keepRecent > input.messages.length) throw new Error("keepRecent no es válido.");
  if (input.messages.some((message) => !Number.isInteger(message.tokens) || message.tokens < 0)) throw new Error("Los mensajes de compactación no son válidos.");
  assertSafeForPersistence(input.summary);
  const uniqueId = (input.idFactory ?? (() => crypto.randomUUID()))();
  const boundary = Math.max(0, input.messages.length - input.keepRecent);
  const summarized = input.messages.slice(0, boundary);
  const snapshot: ContextSnapshotLineage = {
    id: `snapshot-${uniqueId}`,
    summarizedMessageIds: summarized.map((message) => message.id), decisions: [...input.decisions], figures: [...input.figures],
    sourceIds: [...input.sourceIds], actionIds: [...input.actionIds], personIds: [...input.personIds], analysisVersion: input.analysisVersion,
  };
  const summaryMessage = { id: `snapshot-message-${uniqueId}`, content: input.summary, tokens: Math.max(1, Math.ceil(input.summary.length / 4)) };
  return { payloadMessages: summarized.length ? [summaryMessage, ...input.messages.slice(boundary)] : [...input.messages], snapshot };
}
import { assertSafeForPersistence } from "@/lib/assistant/privacy/assertions";
