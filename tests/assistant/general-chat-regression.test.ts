import { describe, expect, test, vi } from "vitest";
import { AssistantOrchestrator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";

function ndjson(events: readonly Record<string, unknown>[]) {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

describe("general chat regression", () => {
  test("persists one direct hello without planning tools or empty_response", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => ndjson([
      { type: "text_delta", roundId: body.roundId, messageId: "assistant-1", delta: "Hola" },
      { type: "done", roundId: body.roundId, finishReason: "STOP" },
    ]));
    const persistMessage = vi.fn(async () => undefined);
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope: vi.fn(async () => undefined), persistMessage } as never);

    const result = await orchestrator.send({ conversationId: "c1", question: "hola", assistantMessageId: "assistant-1", modelProfileId: "p1", modelId: "gemini-flash", responseMode: "strict", contextStrategy: "automatic" });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ phase: "general", question: "hola" }), expect.any(AbortSignal));
    expect(registry.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ text: "Hola", producedMessages: [expect.objectContaining({ id: "assistant-1", content: "Hola", status: "completed" })] });
    expect(persistMessage).toHaveBeenCalledTimes(1);
    expect(persistMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "assistant-1", content: "Hola", status: "completed" }), expect.anything());
  });
});
