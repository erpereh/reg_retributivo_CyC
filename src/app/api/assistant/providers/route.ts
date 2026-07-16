import { providerRuntime } from "@/lib/assistant/server/providerRuntime";
import { createProvidersPostHandler } from "@/lib/assistant/server/providersRoute";

export const runtime = "nodejs";
export const POST = createProvidersPostHandler(providerRuntime);
