import type { DetectedModel, ModelProfile, TokenUsage } from "@/lib/assistant/domain";

export type ProviderId = ModelProfile["provider"];
export type ModelProfileInput = ModelProfile;
export type ProviderErrorClassification = "transient" | "auth" | "privacy" | "incompatible" | "context" | "cancelled" | "provider";

export interface ProviderPreset {
  readonly label: string;
  readonly baseUrl?: string;
  readonly envName?: "GEMINI_API_KEY" | "OPENAI_API_KEY" | "OPENROUTER_API_KEY" | "CEREBRAS_API_KEY" | "GROQ_API_KEY";
}

export const PROVIDER_PRESETS: Readonly<Record<ProviderId, ProviderPreset>> = {
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", envName: "GEMINI_API_KEY" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", envName: "OPENAI_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", envName: "OPENROUTER_API_KEY" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", envName: "CEREBRAS_API_KEY" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", envName: "GROQ_API_KEY" },
  manual: { label: "Manual", envName: undefined },
};

export interface ProviderModel extends DetectedModel {
  readonly supportedParameters?: readonly string[];
}

export interface ModelMetadata extends ProviderModel {}
export interface TokenCount { readonly tokens: number; readonly estimated: boolean }
export interface ProviderMessage { readonly role: "system" | "user" | "assistant" | "tool"; readonly content: string }
export interface ProviderTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface ProviderToolCall { readonly id: string; readonly name: string; readonly args: unknown }
export interface ToolPlan { readonly toolCalls: readonly ProviderToolCall[] }

export type ProviderStreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "done"; readonly finishReason: string };

export interface AdapterAuth { readonly apiKey: string; readonly signal?: AbortSignal }
export interface ModelRequest extends AdapterAuth { readonly modelId: string }
export interface TokenCountRequest extends ModelRequest { readonly text: string }
export interface ToolPlanRequest extends ModelRequest { readonly messages: readonly ProviderMessage[]; readonly tools: readonly ProviderTool[] }
export interface StreamResponseRequest extends ModelRequest {
  readonly messages: readonly ProviderMessage[];
  readonly maxOutputTokens?: number;
}

export interface BehavioralProbeResult {
  readonly connection: boolean;
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly structuredArguments: boolean;
  readonly structuredOutput: boolean;
  readonly cancellation: boolean;
  readonly sanitizedErrors: boolean;
}

export interface AIProviderAdapter {
  listModels(request: AdapterAuth): Promise<readonly ProviderModel[]>;
  getModelMetadata(request: ModelRequest): Promise<ModelMetadata>;
  countTokens(request: TokenCountRequest): Promise<TokenCount>;
  probeCapabilities(request: ModelRequest): Promise<BehavioralProbeResult>;
  planTools(request: ToolPlanRequest): Promise<ToolPlan>;
  streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent>;
}

const PUBLIC_MESSAGES: Readonly<Record<ProviderErrorClassification, string>> = {
  transient: "El proveedor no está disponible temporalmente.",
  auth: "No se pudo autenticar con el proveedor.",
  privacy: "La solicitud fue bloqueada por privacidad.",
  incompatible: "El modelo no ofrece las capacidades necesarias.",
  context: "La ventana de contexto no es suficiente.",
  cancelled: "La comprobación fue cancelada.",
  provider: "El proveedor devolvió una respuesta no válida.",
};
const PUBLIC_MESSAGES_BY_CODE: Readonly<Record<string, string>> = {
  empty_response: "El modelo no devolvió contenido.",
  tool_round_limit: "El asistente necesitó demasiadas rondas de herramientas.",
  stream_truncated: "La respuesta se interrumpió antes de completarse.",
  stream_parse: "No se pudo interpretar la respuesta del proveedor.",
  gemini_response_blocked: "Gemini bloqueó la respuesta.",
  gemini_stream_parse: "No se pudo interpretar la respuesta del proveedor.",
};

export class ProviderAdapterError extends Error {
  readonly code: string;
  readonly classification: ProviderErrorClassification;
  readonly publicMessage: string;

  constructor(classification: ProviderErrorClassification, code = `provider_${classification}`) {
    super(PUBLIC_MESSAGES[classification]);
    this.name = "ProviderAdapterError";
    this.code = code;
    this.classification = classification;
    this.publicMessage = PUBLIC_MESSAGES_BY_CODE[code] ?? PUBLIC_MESSAGES[classification];
  }

  toJSON() {
    return { name: this.name, code: this.code, classification: this.classification, publicMessage: this.publicMessage };
  }
}

export function providerErrorFromStatus(status: number): ProviderAdapterError {
  const code = `provider_http_${status}`;
  if (status === 401 || status === 403) return new ProviderAdapterError("auth", code);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return new ProviderAdapterError("transient", code);
  if (status === 413) return new ProviderAdapterError("context", code);
  return new ProviderAdapterError("provider", code);
}

export function sanitizeProviderError(error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new ProviderAdapterError("cancelled");
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return providerErrorFromStatus(status);
  return new ProviderAdapterError("provider");
}
