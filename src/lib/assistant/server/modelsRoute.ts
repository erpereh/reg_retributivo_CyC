import { NextResponse } from "next/server";
import { z } from "zod";
import { modelProfileSchema } from "@/lib/assistant/schemas";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import { ModelServiceInputError, type ModelService } from "@/lib/assistant/server/modelService";

const provider = z.enum(["gemini", "openai", "openrouter", "cerebras", "groq", "manual"]);
export const MAX_MODELS_REQUEST_BYTES = 64 * 1024;
export const DEFAULT_MODELS_PROVIDER_DEADLINE_MS = 30_000;
const listOperation = z.object({ operation: z.literal("list"), provider, baseUrl: z.string().url().max(2_048).optional(), apiKey: z.string().min(1).max(4_096).optional() }).strict();
const probeOperation = z.object({ operation: z.literal("probe"), profile: modelProfileSchema, apiKey: z.string().min(1).max(4_096).optional() }).strict();
const restoreOperation = z.object({ operation: z.literal("restore_detected"), profile: modelProfileSchema, apiKey: z.string().min(1).max(4_096).optional() }).strict();
export const modelsRequestSchema = z.discriminatedUnion("operation", [listOperation, probeOperation, restoreOperation]);

class RequestBodyTooLarge extends Error {}

async function readLimitedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MODELS_REQUEST_BYTES) throw new RequestBodyTooLarge();
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_MODELS_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { return undefined; }
}

function requestDeadlineSignal(parent: AbortSignal, deadlineMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(new DOMException("La operación fue cancelada.", "AbortError")); };
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, deadlineMs);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timeout); parent.removeEventListener("abort", abort); },
  };
}

export function createModelsPostHandler(service: ModelService, options: { deadlineMs?: number } = {}) {
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try { body = await readLimitedJson(request); } catch (error) {
      if (error instanceof RequestBodyTooLarge) return NextResponse.json({ error: "La solicitud supera el tamaño permitido." }, { status: 413 });
      return NextResponse.json({ error: "Solicitud de modelos no válida." }, { status: 400 });
    }
    const parsed = modelsRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Solicitud de modelos no válida." }, { status: 400 });
    const deadline = requestDeadlineSignal(request.signal, options.deadlineMs ?? DEFAULT_MODELS_PROVIDER_DEADLINE_MS);
    try {
      if (parsed.data.operation === "list") return NextResponse.json(await service.list({ ...parsed.data, signal: deadline.signal }));
      return NextResponse.json(await service.probe({
        profile: parsed.data.profile,
        apiKey: parsed.data.apiKey,
        restore: parsed.data.operation === "restore_detected",
        signal: deadline.signal,
      }));
    } catch (error) {
      if (error instanceof ModelServiceInputError) return NextResponse.json({ error: error.message }, { status: 400 });
      if (error instanceof ProviderAdapterError) return NextResponse.json({ error: error.publicMessage, code: error.code, classification: error.classification }, { status: error.classification === "auth" ? 401 : 502 });
      return NextResponse.json({ error: "No se pudo completar la operación con el proveedor.", code: "provider_error", classification: "provider" }, { status: 502 });
    } finally {
      deadline.dispose();
    }
  };
}
