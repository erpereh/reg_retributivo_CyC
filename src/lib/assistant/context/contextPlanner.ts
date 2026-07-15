import type { ContextStrategy, ResponseMode } from "@/lib/assistant/domain";
import type { DocumentScope } from "@/lib/assistant/domain";
import { calculateTokenBudget, type TokenBudget } from "@/lib/assistant/context/tokenBudget";

export type ContextKind = "tool" | "metadata" | "lexical" | "chunk" | "message";
export interface ContextCandidate {
  readonly id: string; readonly kind: ContextKind; readonly content: string; readonly tokens: number; readonly relevance: number;
  readonly sourceId: string; readonly sanitizedHash: string; readonly factKey: string; readonly facets?: Readonly<Record<string, readonly string[]>>; readonly scope: DocumentScope;
}
export interface ContextPlanInput {
  readonly strategy: ContextStrategy; readonly responseMode?: ResponseMode; readonly candidates: readonly ContextCandidate[]; readonly scope: DocumentScope;
  readonly contextWindow: number; readonly promptTokens: number; readonly toolSchemaTokens: number;
  readonly outputTokens?: number;
  readonly safetyMarginPercent?: number; readonly warningThresholdPercent?: number; readonly compactionThresholdPercent?: number;
}
export interface ContextPlan { readonly items: readonly ContextCandidate[]; readonly budget: TokenBudget; readonly actualStrategy: ContextStrategy; readonly actualResponseMode: ResponseMode }
const PRIORITY: Record<ContextKind, number> = { tool: 0, metadata: 1, lexical: 2, chunk: 3, message: 4 };

export function responseModeInstructions(mode: ResponseMode): string {
  return mode === "strict"
    ? "Afirma solo lo respaldado por fuentes. Si falta información, indícalo y enumera qué falta."
    : "Separa la respuesta en: Confirmado por los datos; Posible explicación; Información necesaria para verificarlo.";
}

export class ContextPlanner {
  plan(input: ContextPlanInput): ContextPlan {
    if (!input.scope) throw new Error("El scope de contexto es obligatorio.");
    if (input.candidates.some((item) => !Number.isFinite(item.tokens) || item.tokens < 0 || !Number.isInteger(item.tokens) || !Number.isFinite(item.relevance) || item.relevance < 0 || item.relevance > 1)) throw new Error("Los candidatos de contexto no son válidos.");
    const capacity = calculateTokenBudget({ contextWindow: input.contextWindow, promptTokens: input.promptTokens, toolSchemaTokens: input.toolSchemaTokens, contextTokens: 0, outputTokens: input.outputTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent });
    const structuredFacts = new Set(input.candidates.filter((item) => item.kind === "tool").map((item) => item.factKey));
    const seen = new Set<string>();
    const relevant = input.candidates.filter((item) => sameScope(item.scope, input.scope) && item.relevance > 0)
      .filter((item) => item.kind === "tool" || !structuredFacts.has(item.factKey))
      .filter((item) => input.strategy !== "automatic" || item.kind !== "message" || item.relevance >= 0.25)
      .filter((item) => input.strategy !== "optimized" || item.kind !== "message" || item.relevance >= 0.5)
      .filter((item) => { const key = `${item.sourceId}\u0000${item.sanitizedHash}\u0000${item.factKey}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.relevance - a.relevance || a.id.localeCompare(b.id));
    const items: ContextCandidate[] = [];
    let contextTokens = 0;
    for (const candidate of relevant) {
      if (contextTokens + candidate.tokens > capacity.availableContextTokens) continue;
      items.push(candidate); contextTokens += candidate.tokens;
    }
    const budget = calculateTokenBudget({ contextWindow: input.contextWindow, promptTokens: input.promptTokens, toolSchemaTokens: input.toolSchemaTokens, contextTokens, outputTokens: input.outputTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent });
    return { items, budget, actualStrategy: input.strategy, actualResponseMode: input.responseMode ?? "strict" };
  }
}

function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return left.type === right.type && (left.type === "analysis" ? right.type === "analysis" && left.analysisId === right.analysisId : right.type === "conversation" && left.conversationId === right.conversationId);
}
