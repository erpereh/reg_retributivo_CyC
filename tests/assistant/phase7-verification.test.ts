import { describe, expect, it } from "vitest";
import { createE2EChatAdapterResolver, isAssistantE2EMode } from "@/lib/assistant/server/e2eAdapter";
import { createSanitizedPerformanceFixture, summarizeIndexMeasurements } from "@/lib/assistant/search/performanceFixture";
import { DirectIndexExecutor } from "@/lib/assistant/search/directIndex";
import { DeterministicE2EAdapter } from "@/lib/assistant/server/e2eAdapter";
import { createModelService } from "@/lib/assistant/server/modelService";
import { ASSISTANT_STORES } from "@/lib/assistant/storage/database";
import { assertSafeForPersistence, PrivacyBoundaryError } from "@/lib/assistant/privacy/assertions";
import { readFileSync } from "node:fs";

describe("Phase 7 verification contracts", () => {
  it.each(ASSISTANT_STORES)("audits %s recursively without echoing sensitive values", (store) => {
    let caught: unknown;
    try { assertSafeForPersistence({ [store]: [{ nested: "persona@example.com" }] }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PrivacyBoundaryError);
    expect(String(caught)).not.toContain("persona@example.com");
  });

  it("enables the deterministic adapter only for the explicit test-server flag", async () => {
    expect(isAssistantE2EMode({ ASSISTANT_E2E_MODE: "1", NODE_ENV: "test" })).toBe(true);
    expect(isAssistantE2EMode({ ASSISTANT_E2E_MODE: "1", NODE_ENV: "development" })).toBe(true);
    expect(isAssistantE2EMode({ ASSISTANT_E2E_MODE: "1", NODE_ENV: "production" })).toBe(false);
    expect(isAssistantE2EMode({ ASSISTANT_E2E_MODE: "1" })).toBe(false);
    expect(isAssistantE2EMode({ ASSISTANT_E2E_MODE: "true", NODE_ENV: "test" })).toBe(false);

    const resolver = createE2EChatAdapterResolver({ ASSISTANT_E2E_MODE: "1", NODE_ENV: "test" });
    const binding = await resolver({ modelId: "e2e-model" } as never);
    expect(binding.apiKey).toBe("");
    expect(await binding.adapter.listModels({ apiKey: binding.apiKey })).toEqual([
      expect.objectContaining({ id: "e2e-model", contextWindow: 32_768 }),
    ]);
  });

  it("rejects construction outside the E2E server", () => {
    expect(() => createE2EChatAdapterResolver({ ASSISTANT_E2E_MODE: "1", NODE_ENV: "production" })).toThrow("e2e_mode_disabled");
  });

  it("keeps browser E2E code free of client fake chat adapters", () => {
    const scope = readFileSync(new URL("../../src/components/assistant/AssistantE2EAppScope.tsx", import.meta.url), "utf8");
    const harness = readFileSync(new URL("../../src/components/assistant/AssistantE2EHarness.tsx", import.meta.url), "utf8");
    expect(`${scope}\n${harness}`).not.toMatch(/FakeAssistantAdapter|BrowserE2EAssistantAdapter|runFallbackPartial|adapter=\{/u);
    expect(scope).toContain("<AssistantProvider activeAnalysis={activeAnalysis} onNavigate={navigateAssistantIntent}>");
  });

  it("lists E2E models without making behavioral probes", async () => {
    const service = createModelService({
      resolveAdapter: () => new DeterministicE2EAdapter(),
      env: { OPENAI_API_KEY: "e2e-ephemeral-key" },
    });
    await expect(service.list({ provider: "openai" })).resolves.toEqual({
      models: [expect.objectContaining({ id: "e2e-model", contextWindow: 32_768 })],
    });
  });

  it("plans and synthesizes a real person profile from local tool evidence", async () => {
    const adapter = new DeterministicE2EAdapter();
    const plan = await adapter.planTools({
      apiKey: "", modelId: "e2e-model",
      messages: [
        { role: "system", content: "Análisis: analysis-real. Matrículas asociadas: 10048." },
        { role: "user", content: "Consulta la matrícula 10048" },
      ],
      tools: [{ name: "getPersonProfile", description: "Ficha", parameters: {} }],
    });
    expect(plan.toolCalls).toEqual([{ id: "e2e-get-person-profile", name: "getPersonProfile", args: { analysisId: "analysis-real", personId: "10048" } }]);

    const evidence = [[{ tool: "getPersonProfile", status: "success", data: { personId: "10048", totals: { registro: 63862.04, payroll: 64070.09, difference: 208.05 }, completeness: { mismatches: 1 }, comparisons: [{ pdfConcept: "Teletrabajo", difference: 208.05, cause: { label: "Teletrabajo", confidence: "alta" } }] } }]];
    const chunks: string[] = [];
    for await (const event of adapter.streamResponse({ apiKey: "", modelId: "e2e-model", messages: [{ role: "user", content: `Consulta la matrícula 10048\n\nResultados locales sanitizados para la síntesis final:\n${JSON.stringify(evidence)}` }] })) {
      if (event.type === "text_delta") chunks.push(event.delta);
    }
    expect(chunks.join("")).toContain("matrícula 10048");
    expect(chunks.join("")).toContain("208,05");
    expect(chunks.join("")).toContain("Teletrabajo");
  });

  it("builds an exclusively sanitized fixture above 5,000 chunks", () => {
    const chunks = createSanitizedPerformanceFixture(5_200);
    expect(chunks).toHaveLength(5_200);
    expect(JSON.stringify(chunks)).not.toMatch(/@|iban|nif|tel[eé]fono|\\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/iu);
    expect(new DirectIndexExecutor().execute(chunks).indexedChunkIds).toHaveLength(5_200);
  });

  it("summarizes exactly five measured runs after warm-up", () => {
    expect(summarizeIndexMeasurements([12, 8, 10, 9, 11], [])).toEqual({
      runs: 5,
      medianMs: 10,
      p95Ms: 12,
      longTasks: 0,
      workerRequired: false,
    });
    expect(summarizeIndexMeasurements([12, 8, 10, 9, 11], [51]).workerRequired).toBe(true);
    expect(summarizeIndexMeasurements([12, 8, 51, 9, 11], []).workerRequired).toBe(true);
    expect(() => summarizeIndexMeasurements([1, 2, 3, 4], [])).toThrow();
  });

});
