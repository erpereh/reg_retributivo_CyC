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
  async planTools(request: Parameters<AIProviderAdapter["planTools"]>[0]): Promise<Awaited<ReturnType<AIProviderAdapter["planTools"]>>> {
    const latestQuestion = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const systemContext = request.messages.find((message) => message.role === "system")?.content ?? "";
    const personMatch = /matrícula\s+([\p{L}\p{N}._-]+)/iu.exec(latestQuestion);
    const analysisMatch = /Análisis:\s*([^.]*)\.\s*Matrículas asociadas:/u.exec(systemContext);
    const supportsPersonProfile = request.tools.some((tool) => tool.name === "getPersonProfile");
    if (personMatch && analysisMatch && supportsPersonProfile) {
      return { toolCalls: [{ id: "e2e-get-person-profile", name: "getPersonProfile", args: { analysisId: analysisMatch[1]!.trim(), personId: personMatch[1]! } }] };
    }
    return { toolCalls: [] };
  }

  async *streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent> {
    const wait = (milliseconds: number) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      request.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(request.signal?.reason); }, { once: true });
    });
    const reversedMessages = [...request.messages].reverse();
    const userQuestion = reversedMessages.find((message) => message.role === "user")?.content ?? "";
    const partial = reversedMessages.find((message) => message.role === "assistant")?.content ?? "";
    const synthesisMarker = "Resultados locales sanitizados para la síntesis final:\n";
    const synthesisMessage = reversedMessages.find((message) => message.role === "user" && message.content.includes(synthesisMarker));
    if (synthesisMessage) {
      try {
        const rounds = JSON.parse(synthesisMessage.content.split(synthesisMarker)[1] ?? "[]") as Array<Array<{ tool?: string; status?: string; data?: unknown }>>;
        const profile = rounds.flat().find((entry) => entry.tool === "getPersonProfile" && entry.status !== "failed")?.data as {
          personId?: string; totals?: { registro?: number; payroll?: number; difference?: number }; completeness?: { mismatches?: number };
          comparisons?: Array<{ pdfConcept?: string; registroCode?: string; difference?: number; cause?: { label?: string; confidence?: string } }>;
        } | undefined;
        if (profile?.personId && profile.totals) {
          const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
          const mismatches = (profile.comparisons ?? []).filter((item) => Math.abs(item.difference ?? 0) > 0.009).slice(0, 3);
          const concepts = mismatches.map((item) => `${item.pdfConcept ?? item.registroCode ?? "Concepto"}: ${money.format(item.difference ?? 0)} (${item.cause?.label ?? "revisión pendiente"}, confianza ${item.cause?.confidence ?? "baja"})`).join("; ");
          const text = `La matrícula ${profile.personId} presenta una diferencia de ${money.format(profile.totals.difference ?? 0)}: el Registro suma ${money.format(profile.totals.registro ?? 0)} y los recibos ${money.format(profile.totals.payroll ?? 0)}. Se han identificado ${profile.completeness?.mismatches ?? mismatches.length} conceptos descuadrados.${concepts ? ` Principales evidencias: ${concepts}.` : ""} Recomendación: revisar las evidencias originales y confirmar el criterio de inclusión de cada concepto.`;
          for (const delta of [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]) {
            if (request.signal?.aborted) throw request.signal.reason;
            await wait(15);
            yield { type: "text_delta", delta };
          }
          yield { type: "usage", usage: { inputTokens: Math.max(1, Math.ceil(synthesisMessage.content.length / 4)), outputTokens: Math.max(1, Math.ceil(text.length / 4)), totalTokens: Math.max(2, Math.ceil((synthesisMessage.content.length + text.length) / 4)), estimated: true } };
          yield { type: "done", finishReason: "stop" };
          return;
        }
      } catch {
        // Fall through to the generic deterministic response.
      }
    }
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
