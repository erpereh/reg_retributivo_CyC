import { describe, expect, test, vi } from "vitest";
import { createModelsPostHandler, MAX_MODELS_REQUEST_BYTES } from "@/lib/assistant/server/modelsRoute";
import { createModelService } from "@/lib/assistant/server/modelService";
import { CAPABILITY_PAYLOAD_VERSION } from "@/lib/assistant/server/capabilityPayload";
import { ProviderAdapterError, type AIProviderAdapter, type ModelProfileInput } from "@/lib/assistant/providers/types";

const profile = (patch: Partial<ModelProfileInput> = {}): ModelProfileInput => ({
  id: "profile-1", name: "Perfil", provider: "manual", baseUrl: "https://models.example.test/v1", modelId: "future-model",
  enabled: true, generalChatCompatible: false, analysisCompatible: false, supportsStreaming: false, supportsTools: false,
  supportsStructuredOutput: false, capabilitiesSource: "detected", ...patch,
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/assistant/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function adapter(overrides: Partial<AIProviderAdapter> = {}): AIProviderAdapter {
  return {
    listModels: vi.fn(async () => [{ id: "future-model", displayName: "Future", contextWindow: 16_000, maxOutputTokens: 4_096 }]),
    getModelMetadata: vi.fn(async () => ({ id: "future-model", displayName: "Future", contextWindow: 16_000, maxOutputTokens: 4_096 })),
    countTokens: vi.fn(async () => ({ tokens: 1_000, estimated: true })),
    probeCapabilities: vi.fn(async () => ({ connection: true, streaming: true, tools: true, structuredArguments: true, structuredOutput: true, cancellation: true, sanitizedErrors: true })),
    planTools: vi.fn(async () => ({ toolCalls: [] })),
    streamResponse: vi.fn(async function* () { yield { type: "done" as const, finishReason: "stop" }; }),
    ...overrides,
  };
}

describe("POST /api/assistant/models", () => {
  test("strictly lists models with a request-local manual key", async () => {
    const fake = adapter();
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(request({ operation: "list", provider: "manual", baseUrl: "https://models.example.test/v1", apiKey: "request-only" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ models: [expect.objectContaining({ id: "future-model" })] });
    expect(fake.listModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "request-only" }));

    const invalid = await POST(request({ operation: "list", provider: "manual", baseUrl: "http://unsafe.test/v1", apiKey: "x", unknown: true }));
    expect(invalid.status).toBe(400);
  });

  test("rejects oversized request bodies before parsing or calling a provider", async () => {
    const fake = adapter();
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(new Request("http://localhost/api/assistant/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "list", provider: "manual", baseUrl: "https://models.example.test/v1", apiKey: "x".repeat(MAX_MODELS_REQUEST_BYTES) }),
    }));
    expect(response.status).toBe(413);
    expect(fake.listModels).not.toHaveBeenCalled();
  });

  test("requires every behavioral capability and enough measured context", async () => {
    const fake = adapter();
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(request({ operation: "probe", profile: profile({ manualContextWindow: 16_000 }), apiKey: "secret" }));
    const body = await response.json();
    expect(body.probe).toMatchObject({
      connection: true, streaming: true, tools: true, structuredArguments: true, structuredOutput: true,
      sufficientContext: true, cancellation: true, sanitizedErrors: true, requiredContextTokens: 3_387, analysisCompatible: true,
    });
    expect(body.profile).toMatchObject({ supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, analysisCompatible: true, detectedContextWindow: 16_000 });
    expect(fake.countTokens).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(new RegExp(`${CAPABILITY_PAYLOAD_VERSION}.*getPersonProfile`, "s")),
      signal: expect.any(AbortSignal),
    }));
    expect(fake.probeCapabilities).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fake.getModelMetadata).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  test("marks a 2xx model incompatible when behavior or context is insufficient", async () => {
    const fake = adapter({
      getModelMetadata: vi.fn(async () => ({ id: "future-model", displayName: "Future" })),
      probeCapabilities: vi.fn(async () => ({ connection: true, streaming: true, tools: true, structuredArguments: false, structuredOutput: true, cancellation: true, sanitizedErrors: true })),
    });
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(request({ operation: "probe", profile: profile({ manualContextWindow: 3_000 }), apiKey: "secret" }));
    const body = await response.json();
    expect(body.probe).toMatchObject({ connection: true, structuredArguments: false, sufficientContext: false, analysisCompatible: false });
  });

  test("restores detected capabilities over manual overrides", async () => {
    const fake = adapter();
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(request({ operation: "restore_detected", profile: profile({ capabilitiesSource: "manual", supportsTools: false, manualContextWindow: 99_999 }), apiKey: "secret" }));
    const body = await response.json();
    expect(body.profile).toMatchObject({ capabilitiesSource: "detected", supportsTools: true, detectedContextWindow: 16_000 });
    expect(body.profile.manualContextWindow).toBeUndefined();
  });

  test("does not use a manual context window while restoring detected metadata", async () => {
    const fake = adapter({
      getModelMetadata: vi.fn(async () => ({ id: "future-model", displayName: "Future" })),
    });
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: {} }));
    const response = await POST(request({
      operation: "restore_detected",
      profile: profile({ capabilitiesSource: "manual", manualContextWindow: 99_999, analysisCompatible: true }),
      apiKey: "secret",
    }));
    const body = await response.json();
    expect(body.probe).toMatchObject({ contextWindowSource: "unknown", sufficientContext: false, analysisCompatible: false });
    expect(body.profile).toMatchObject({ capabilitiesSource: "detected", analysisCompatible: false });
    expect(body.profile.manualContextWindow).toBeUndefined();
  });

  test("uses server-only preset keys and sanitizes all upstream failures", async () => {
    const fake = adapter({ listModels: vi.fn(async () => { throw new Error("sk-server-secret upstream private body"); }) });
    const POST = createModelsPostHandler(createModelService({ resolveAdapter: () => fake, env: { OPENAI_API_KEY: "sk-server-secret" } }));
    const response = await POST(request({ operation: "list", provider: "openai" }));
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(502);
    expect(serialized).not.toContain("sk-server-secret");
    expect(serialized).not.toContain("upstream private body");
  });

  test("propagates client abort and enforces a bounded server deadline", async () => {
    const signals: AbortSignal[] = [];
    const pending = () => vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      if (!signal) throw new Error("missing signal");
      signals.push(signal);
      return await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new ProviderAdapterError("cancelled")), { once: true }));
    });
    const clientAdapter = adapter({ listModels: pending() });
    const clientController = new AbortController();
    const clientRequest = new Request("http://localhost/api/assistant/models", {
      method: "POST", signal: clientController.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "list", provider: "manual", baseUrl: "https://models.example.test/v1", apiKey: "x" }),
    });
    const clientResponsePromise = createModelsPostHandler(createModelService({ resolveAdapter: () => clientAdapter, env: {} }), { deadlineMs: 1_000 })(clientRequest);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    clientController.abort();
    expect((await clientResponsePromise).status).toBe(502);
    expect(signals[0]?.aborted).toBe(true);

    const deadlineAdapter = adapter({ listModels: pending() });
    const deadlineResponse = await createModelsPostHandler(createModelService({ resolveAdapter: () => deadlineAdapter, env: {} }), { deadlineMs: 5 })(request({ operation: "list", provider: "manual", baseUrl: "https://models.example.test/v1", apiKey: "x" }));
    expect(deadlineResponse.status).toBe(502);
    expect(signals[1]?.aborted).toBe(true);
  });
});
