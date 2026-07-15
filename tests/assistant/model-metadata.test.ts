import { describe, expect, test } from "vitest";
import type { DetectedModel, ModelProfile } from "@/lib/assistant/domain";
import { applySelectedModelMetadata, resolveSelectedModelMetadata } from "@/lib/assistant/modelMetadata";

const profile = (overrides: Partial<ModelProfile> = {}): ModelProfile => ({
  id: "gemini-profile",
  name: "Gemini",
  provider: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com",
  modelId: "gemini-flash",
  enabled: true,
  generalChatCompatible: true,
  analysisCompatible: true,
  supportsStreaming: true,
  supportsTools: true,
  supportsStructuredOutput: true,
  capabilitiesSource: "detected",
  manualContextWindow: 123_456,
  maxOutputTokens: 2_048,
  ...overrides,
});

const catalog: DetectedModel[] = [
  {
    id: "gemini-flash",
    providerModelName: "models/gemini-flash",
    generationModelId: "gemini-flash-generation",
    baseModelId: "gemini-flash-base",
    displayName: "Gemini Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportedMethods: ["generateContent"],
  },
  {
    id: "gemini-embedding",
    providerModelName: "models/gemini-embedding",
    generationModelId: "gemini-embedding",
    displayName: "Gemini Embedding",
    supportedMethods: ["embedContent"],
  },
];

describe("selected model metadata", () => {
  test.each(["gemini-flash", "gemini-flash-generation", "gemini-flash-base", "models/gemini-flash"])("resolves the detected model by %s", (modelId) => {
    expect(resolveSelectedModelMetadata(profile({ detectedModels: [...catalog] }), modelId).selectedModel?.id).toBe("gemini-flash");
  });

  test("normalizes aliases while retaining the full catalog and manual window", () => {
    const updated = applySelectedModelMetadata(profile({ modelId: "models/gemini-flash" }), catalog, "models/gemini-flash");

    expect(updated).toMatchObject({
      modelId: "gemini-flash",
      detectedContextWindow: 1_048_576,
      manualContextWindow: 123_456,
      maxOutputTokens: 2_048,
    });
    expect(updated.detectedModels).toEqual(catalog);

    const resolved = resolveSelectedModelMetadata(updated, updated.modelId);
    expect(resolved).toMatchObject({
      generationModelId: "gemini-flash-generation",
      contextWindow: 1_048_576,
      requestedMaxOutputTokens: 2_048,
      selectionAvailable: true,
    });
  });

  test("clears only derived context when a refreshed catalog no longer contains the selection", () => {
    const updated = applySelectedModelMetadata(profile({ detectedContextWindow: 1_048_576, detectedModels: [...catalog] }), [catalog[1]], "gemini-flash");

    expect(updated).toMatchObject({
      modelId: "gemini-flash",
      detectedContextWindow: undefined,
      manualContextWindow: 123_456,
      maxOutputTokens: 2_048,
      detectedModels: [catalog[1]],
    });
    expect(resolveSelectedModelMetadata(updated, updated.modelId)).toMatchObject({ selectionAvailable: false, contextWindow: 123_456 });
  });

  test("caps the requested output by the provider limit without reserving the full provider maximum", () => {
    const resolved = resolveSelectedModelMetadata(profile({ detectedModels: [...catalog] }), "gemini-flash");

    expect(resolved.requestedMaxOutputTokens).toBe(2_048);
    expect(resolved.providerMaxOutputTokens).toBe(65_536);
  });

  test("uses the manual window when a detected catalog entry omits its window", () => {
    const resolved = resolveSelectedModelMetadata(profile({ detectedModels: [{ ...catalog[0], contextWindow: undefined }], detectedContextWindow: 1_048_576 }), "gemini-flash");

    expect(resolved.contextWindow).toBe(123_456);
  });
});
