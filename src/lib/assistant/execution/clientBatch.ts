import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import type { AnalysisToolName, AnalysisToolRegistry } from "@/lib/assistant/tools/registry";
import { ProviderAdapterError, type ProviderToolContext } from "@/lib/assistant/providers/types";

export interface RequestedLocalTool { readonly requestId: string; readonly tool: AnalysisToolName; readonly args: unknown; readonly providerContext?: ProviderToolContext }
export interface SettledLocalTool {
  readonly requestId: string;
  readonly tool: AnalysisToolName;
  readonly args: unknown;
  readonly providerContext?: ProviderToolContext;
  readonly status: "success" | "empty" | "failed" | "cancelled";
  readonly data?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly sources: readonly unknown[];
}

export async function executeAtomicToolRound(registry: AnalysisToolRegistry, requests: readonly RequestedLocalTool[], options: Readonly<{ signal: AbortSignal; timeoutMs?: number }>): Promise<readonly SettledLocalTool[]> {
  if (new Set(requests.map((request) => request.requestId)).size !== requests.length) throw new Error("tool_request_duplicate");
  const timeoutMs = options.timeoutMs ?? 15_000;
  return Promise.all(requests.map(async (request): Promise<SettledLocalTool> => {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (options.signal.aborted) abort(); else options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
    try {
      controller.signal.throwIfAborted();
      const envelope = registry.executeEnvelope ? await registry.executeEnvelope(request.tool, request.args, request.requestId) : { data: await registry.execute(request.tool, request.args), sources: [] };
      controller.signal.throwIfAborted();
      assertSafeForProvider(envelope);
      const empty = envelope.data === null || (Array.isArray(envelope.data) && envelope.data.length === 0);
      return { requestId: request.requestId, tool: request.tool, args: request.args, ...(request.providerContext ? { providerContext: request.providerContext } : {}), status: empty ? "empty" : "success", data: envelope.data, sources: envelope.sources };
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const code = cancelled ? "cancelled" : error instanceof ProviderAdapterError ? error.code : "tool_failed";
      return { requestId: request.requestId, tool: request.tool, args: request.args, ...(request.providerContext ? { providerContext: request.providerContext } : {}), status: cancelled ? "cancelled" : "failed", error: { code, message: "No se pudo completar la consulta local." }, sources: [] };
    } finally { clearTimeout(timer); options.signal.removeEventListener("abort", abort); }
  }));
}
