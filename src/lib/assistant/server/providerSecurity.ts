import { isIP } from "node:net";
import { resolveManualEndpoint, type ResolvedAddress } from "@/lib/assistant/server/manualEndpoint";

export class ProviderSecurityError extends Error {
  constructor(readonly code: "provider_env_not_allowed" | "provider_endpoint_not_allowed") {
    super(code);
    this.name = "ProviderSecurityError";
  }
}

const COMPATIBLE_ENV = /^OPENAI_COMPATIBLE_[A-Z0-9]+(?:_[A-Z0-9]+)*_API_KEY$/;
const CLOUD_METADATA_HOSTS = new Set(["169.254.169.254", "100.100.100.200", "metadata.google.internal", "metadata.azure.internal"]);

export function validateCompatibleEnvName(value: string): string {
  if (!COMPATIBLE_ENV.test(value)) throw new ProviderSecurityError("provider_env_not_allowed");
  return value;
}

export interface CompatibleEndpointOptions {
  readonly production: boolean;
  readonly allowDevelopmentLocalhost?: boolean;
  readonly resolver?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
}

export async function resolveCompatibleEndpoint(
  input: string,
  options: CompatibleEndpointOptions,
): Promise<Readonly<{ url: URL; addresses: readonly ResolvedAddress[] }>> {
  let url: URL;
  try { url = new URL(input); } catch { throw new ProviderSecurityError("provider_endpoint_not_allowed"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const allowedProtocol = options.production ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
  if (!url.hostname || !allowedProtocol || url.username || url.password || url.search || url.hash || CLOUD_METADATA_HOSTS.has(hostname)) {
    throw new ProviderSecurityError("provider_endpoint_not_allowed");
  }
  if (local) {
    if (options.production || !options.allowDevelopmentLocalhost) throw new ProviderSecurityError("provider_endpoint_not_allowed");
    return { url, addresses: [{ address: hostname === "::1" ? "::1" : "127.0.0.1", family: hostname === "::1" ? 6 : 4 }] };
  }
  try {
    const resolved = await resolveManualEndpoint(url, options.resolver);
    if (resolved.addresses.some((address) => isIP(address.address) === 0)) throw new ProviderSecurityError("provider_endpoint_not_allowed");
    return resolved;
  } catch {
    throw new ProviderSecurityError("provider_endpoint_not_allowed");
  }
}
