import type { DetectedModel, ModelProfile } from "@/lib/assistant/domain";

export const DEFAULT_REQUESTED_MAX_OUTPUT_TOKENS = 2_048;

export function normalizeModelIdentifier(value: string | undefined): string {
  return value?.trim().replace(/^(?:models\/)+/iu, "") ?? "";
}

function sameModelIdentifier(value: string | undefined, normalizedTarget: string): boolean {
  return Boolean(normalizedTarget) && normalizeModelIdentifier(value) === normalizedTarget;
}

export function resolveSelectedDetectedModel(profile: Pick<ModelProfile, "detectedModels"> | undefined, modelId: string | undefined): DetectedModel | undefined {
  const target = normalizeModelIdentifier(modelId);
  return profile?.detectedModels?.find((model) => (
    sameModelIdentifier(model.id, target)
    || sameModelIdentifier(model.generationModelId, target)
    || sameModelIdentifier(model.baseModelId, target)
    || sameModelIdentifier(model.providerModelName, target)
  ));
}

export interface SelectedModelMetadata {
  readonly selectedModel?: DetectedModel;
  readonly canonicalModelId: string;
  readonly generationModelId: string;
  readonly detectedContextWindow?: number;
  readonly contextWindow?: number;
  readonly providerMaxOutputTokens?: number;
  readonly requestedMaxOutputTokens: number;
  readonly selectionAvailable: boolean;
}

export function resolveSelectedModelMetadata(profile: ModelProfile | undefined, modelId = profile?.modelId): SelectedModelMetadata {
  const selectedModel = resolveSelectedDetectedModel(profile, modelId);
  const canonicalModelId = normalizeModelIdentifier(selectedModel?.id ?? modelId);
  const detectedContextWindow = selectedModel?.contextWindow;
  const providerMaxOutputTokens = selectedModel?.maxOutputTokens;
  const requestedMaxOutputTokens = Math.min(profile?.maxOutputTokens ?? DEFAULT_REQUESTED_MAX_OUTPUT_TOKENS, providerMaxOutputTokens ?? Number.POSITIVE_INFINITY);
  const hasDetectedCatalog = Boolean(profile?.detectedModels?.length);
  const contextWindow = selectedModel?.contextWindow ?? (hasDetectedCatalog ? profile?.manualContextWindow : profile?.detectedContextWindow ?? profile?.manualContextWindow);
  return {
    ...(selectedModel ? { selectedModel } : {}),
    canonicalModelId,
    generationModelId: normalizeModelIdentifier(selectedModel?.generationModelId ?? selectedModel?.id ?? modelId),
    ...(detectedContextWindow !== undefined ? { detectedContextWindow } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(providerMaxOutputTokens !== undefined ? { providerMaxOutputTokens } : {}),
    requestedMaxOutputTokens,
    selectionAvailable: !hasDetectedCatalog || Boolean(selectedModel),
  };
}

export function applySelectedModelMetadata(profile: ModelProfile, models: readonly DetectedModel[], modelId: string): ModelProfile {
  const catalogProfile: ModelProfile = { ...profile, detectedModels: [...models] };
  const selectedModel = resolveSelectedDetectedModel(catalogProfile, modelId);
  return {
    ...catalogProfile,
    modelId: normalizeModelIdentifier(selectedModel?.id ?? modelId),
    detectedContextWindow: selectedModel?.contextWindow,
  };
}
