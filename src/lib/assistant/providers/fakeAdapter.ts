import type { SourceReference } from "@/lib/assistant/domain";
import { formatEuro } from "@/lib/utils/money";

export const GENERAL_RETRIBUTIVO_PROMPT = "Retributivo:glossary:v1. Explica exclusivamente qué compara Retributivo y los términos Registro Retributivo, recibos, Cuadre Reg., conceptos y agrupaciones.";

export interface GeneralFakeRequest {
  systemPrompt: typeof GENERAL_RETRIBUTIVO_PROMPT;
  question: string;
  messageId: string;
}

export interface ProfileFakeRequest {
  messageId: string;
  totals: { registro: number; payroll: number; difference: number };
  source: SourceReference;
}

function line(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export class FakeAssistantAdapter {
  async *streamGeneral(request: GeneralFakeRequest): AsyncIterable<Uint8Array> {
    const roundId = `round-${request.messageId}`;
    yield line({ type: "status", roundId, label: "Consultando glosario" });
    yield line({ type: "text_delta", roundId, messageId: request.messageId, delta: "Retributivo compara el Registro Retributivo y los recibos. Cuadre Reg. muestra sus diferencias; conceptos y agrupaciones organizan el análisis." });
    yield line({ type: "done", roundId, finishReason: "stop" });
  }

  async *streamPersonProfile(request: ProfileFakeRequest): AsyncIterable<Uint8Array> {
    const roundId = `round-${request.messageId}`;
    yield line({ type: "text_delta", roundId, messageId: request.messageId, delta: `Registro: ${formatEuro(request.totals.registro)} · Recibos: ${formatEuro(request.totals.payroll)} · Diferencia: ${formatEuro(request.totals.difference)}` });
    yield line({ type: "source", roundId, source: request.source });
    yield line({ type: "done", roundId, finishReason: "stop" });
  }
}
