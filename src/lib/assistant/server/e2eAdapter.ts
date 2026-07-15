import type { ChatAdapterResolver } from "@/lib/assistant/server/chatService";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import type {
  AIProviderAdapter,
  BehavioralProbeResult,
  ProviderModel,
  ProviderStreamEvent,
  StreamResponseRequest,
} from "@/lib/assistant/providers/types";

type ServerEnv = Readonly<Record<string, string | undefined> & { ASSISTANT_E2E_MODE?: string; NODE_ENV?: string }>;

const E2E_MODEL: ProviderModel = {
  id: "e2e-model",
  displayName: "Modelo determinista E2E",
  contextWindow: 32_768,
  maxOutputTokens: 2_048,
  supportedParameters: ["stream", "tools", "structured_output"],
};

const E2E_CAPABILITIES: BehavioralProbeResult = {
  connection: true,
  streaming: true,
  tools: true,
  structuredArguments: true,
  structuredOutput: true,
  cancellation: true,
  sanitizedErrors: true,
};

export function isAssistantE2EMode(env: ServerEnv = process.env): boolean {
  return env.ASSISTANT_E2E_MODE === "1" && (env.NODE_ENV === "test" || env.NODE_ENV === "development");
}

export class DeterministicE2EAdapter implements AIProviderAdapter {
  async listModels(): Promise<readonly ProviderModel[]> { return [E2E_MODEL]; }
  async getModelMetadata(): Promise<ProviderModel> { return E2E_MODEL; }
  async countTokens({ text }: { readonly text: string }): Promise<{ tokens: number; estimated: boolean }> {
    return { tokens: Math.max(1, Math.ceil(text.length / 4)), estimated: true };
  }
  async probeCapabilities(): Promise<BehavioralProbeResult> { return E2E_CAPABILITIES; }
  async planTools(): Promise<{ toolCalls: readonly [] }> { return { toolCalls: [] }; }

  async *streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent> {
    const reversedMessages = [...request.messages].reverse();
    const user = reversedMessages.find((message) => message.role === "user");
    const assistant = reversedMessages.find((message) => message.role === "assistant");
    const userQuestion = user?.role === "user" ? user.content : "";
    const partial = assistant?.role === "assistant" ? assistant.content : "";
    const wait = (milliseconds: number) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      request.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(request.signal?.reason); }, { once: true });
    });
    if (partial.includes("Primera parte sanitizada")) {
      if (request.modelId === "e2e-current-model") throw new ProviderAdapterError("transient", "e2e_current_continuation_transient");
      yield { type: "text_delta", delta: "Continuación por e2e-default-model." };
      yield { type: "done", finishReason: "stop" };
      return;
    }
    if (userQuestion === "¿Qué compara el Registro Retributivo con los Recibos?" && request.modelId === "e2e-current-model") {
      yield { type: "text_delta", delta: "Primera parte sanitizada." };
      throw new ProviderAdapterError("transient", "e2e_current_initial_transient");
    }
    if (userQuestion === "¿Qué es Retributivo?" && !partial) {
      await wait(80);
      yield { type: "text_delta", delta: `Respuesta parcial sanitizada. ${"contexto sanitizado ".repeat(35)}` };
      await wait(1_000);
      yield { type: "text_delta", delta: "Continuación que debe cancelarse." };
      yield { type: "done", finishReason: "stop" };
      return;
    }
    const pieces = ["Retributivo compara el Registro Retributivo y los recibos. ", "Cuadre Reg. muestra sus diferencias; conceptos y agrupaciones organizan el análisis."];
    for (const delta of pieces) {
      if (request.signal?.aborted) throw request.signal.reason;
      await wait(15);
      yield { type: "text_delta", delta };
    }
    yield { type: "usage", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, estimated: false } };
    yield { type: "done", finishReason: "stop" };
  }
}

export function createE2EChatAdapterResolver(env: ServerEnv = process.env): ChatAdapterResolver {
  if (!isAssistantE2EMode(env)) throw new Error("e2e_mode_disabled");
  return async () => ({ adapter: new DeterministicE2EAdapter(), apiKey: "" });
}
