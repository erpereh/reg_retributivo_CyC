import { z } from "zod";
import type { ProviderRuntimeService } from "@/lib/assistant/server/providerRuntime";

const id = z.string().min(1).max(256);
const providerConfigSchema = z.object({
  id,
  providerType: z.enum(["gemini", "openai", "openrouter", "cerebras", "groq", "openai-compatible"]),
  displayName: z.string().min(1).max(200),
  baseUrl: z.string().url().max(2_048),
  envVarName: z.string().min(1).max(128),
  enabled: z.boolean(),
  connectionStatus: z.enum(["active", "inactive", "missing_key", "error", "connected"]),
  lastCheckedAt: z.string().optional(), lastCatalogRefreshAt: z.string().optional(), lastCatalogErrorCode: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
const providerDescriptorSchema = z.object({
  providerId: id,
  providerType: z.enum(["gemini", "openai", "openrouter", "cerebras", "groq", "openai-compatible"]),
  baseUrl: z.string().url().max(2_048),
  envVarName: z.string().min(1).max(128),
}).strict();
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("register"), config: providerConfigSchema }).strict(),
  z.object({ operation: z.literal("status"), provider: providerDescriptorSchema }).strict(),
  z.object({ operation: z.literal("catalog"), provider: providerDescriptorSchema }).strict(),
  z.object({ operation: z.literal("compatibility"), provider: providerDescriptorSchema, modelId: id }).strict(),
]);

const MAX_BYTES = 16 * 1024;

export function createProvidersPostHandler(service: ProviderRuntimeService) {
  return async (request: Request): Promise<Response> => {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return Response.json({ error: "Solicitud no válida." }, { status: 413 });
    let body: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return Response.json({ error: "Solicitud no válida." }, { status: 413 });
      body = JSON.parse(text);
    } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Solicitud no válida." }, { status: 400 });
    try {
      switch (parsed.data.operation) {
        case "register": return Response.json(await service.register(parsed.data.config));
        case "status": return Response.json(await service.status(parsed.data.provider));
        case "catalog": return Response.json(await service.catalog(parsed.data.provider, request.signal));
        case "compatibility": return Response.json(await service.checkCompatibility(parsed.data.provider, parsed.data.modelId, request.signal));
      }
    } catch (error) {
      const code = error instanceof Error && ["provider_not_allowed", "provider_key_not_configured"].includes(error.message) ? error.message : "provider_error";
      return Response.json({ error: code === "provider_key_not_configured" ? "Proveedor no configurado." : "No se pudo completar la operación.", code }, { status: code === "provider_key_not_configured" ? 401 : 502 });
    }
  };
}
