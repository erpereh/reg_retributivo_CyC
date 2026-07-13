export interface TokenBudgetInput {
  readonly contextWindow: number;
  readonly promptTokens: number;
  readonly toolSchemaTokens: number;
  readonly contextTokens: number;
  readonly outputTokens?: number;
  readonly safetyMarginPercent?: number;
  readonly warningThresholdPercent?: number;
  readonly compactionThresholdPercent?: number;
}
export interface TokenBudget {
  readonly contextWindow: number;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly availableContextTokens: number;
  readonly contextUsagePercent: number;
  readonly totalTokens: number;
  readonly warning: boolean;
  readonly requiresCompaction: boolean;
  readonly exceedsWindow: boolean;
}
export function calculateTokenBudget(input: TokenBudgetInput): TokenBudget {
  const numeric = [input.contextWindow, input.promptTokens, input.toolSchemaTokens, input.contextTokens, input.outputTokens ?? 2_048, input.safetyMarginPercent ?? 10, input.warningThresholdPercent ?? 75, input.compactionThresholdPercent ?? 85];
  if (numeric.some((value) => !Number.isFinite(value) || value < 0) || !Number.isInteger(input.contextWindow) || !Number.isInteger(input.promptTokens) || !Number.isInteger(input.toolSchemaTokens) || !Number.isInteger(input.contextTokens)) {
    throw new Error("Los valores del presupuesto deben ser enteros finitos y no negativos.");
  }
  if ((input.warningThresholdPercent ?? 75) >= (input.compactionThresholdPercent ?? 85) || (input.compactionThresholdPercent ?? 85) > 100 || (input.safetyMarginPercent ?? 10) > 50) {
    throw new Error("Los umbrales del presupuesto no son válidos.");
  }
  const reservedOutputTokens = input.outputTokens ?? 2_048;
  const safetyMarginTokens = Math.ceil(input.contextWindow * ((input.safetyMarginPercent ?? 10) / 100));
  const availableContextTokens = input.contextWindow - input.promptTokens - input.toolSchemaTokens - reservedOutputTokens - safetyMarginTokens;
  if (availableContextTokens < 0) throw new Error("La ventana de contexto no admite las reservas obligatorias.");
  const contextUsagePercent = availableContextTokens === 0 ? (input.contextTokens ? 100 : 0) : (input.contextTokens / availableContextTokens) * 100;
  const totalTokens = input.promptTokens + input.toolSchemaTokens + input.contextTokens + reservedOutputTokens + safetyMarginTokens;
  return {
    contextWindow: input.contextWindow, reservedOutputTokens, safetyMarginTokens, availableContextTokens, contextUsagePercent, totalTokens,
    warning: contextUsagePercent >= (input.warningThresholdPercent ?? 75),
    requiresCompaction: contextUsagePercent >= (input.compactionThresholdPercent ?? 85),
    exceedsWindow: totalTokens > input.contextWindow,
  };
}
