import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

export const DEFAULT_MANUAL_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const IANA_IPV6_SPECIAL_REGISTRY_VERSION = "2025-10-09";

export interface ResolvedAddress { readonly address: string; readonly family: 4 | 6 }
type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;
type PinnedLookup = (hostname: string, options: { all?: boolean }, callback: (error: Error | null, value?: unknown, family?: number) => void) => void;
interface ClosableDispatcher {
  close(): Promise<unknown> | void;
  destroy(error?: Error): Promise<unknown> | void;
}
type AgentFactory = (lookup: PinnedLookup, maxResponseBytes: number) => ClosableDispatcher;
type FetchWithDispatcher = (input: string | URL | Request, init?: RequestInit & { dispatcher?: ClosableDispatcher }) => Promise<Response>;

export class ManualEndpointPolicyError extends Error {
  constructor(message = "El endpoint Manual no cumple la política de red pública.") {
    super(message);
    this.name = "ManualEndpointPolicyError";
  }
}

function ipv4Octets(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets.every((item) => Number.isInteger(item) && item >= 0 && item <= 255) ? octets : undefined;
}

function publicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIpv6(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) !== 6) return undefined;
  const [left = "", right = ""] = normalized.split("::");
  const parse = (part: string): number[] => part ? part.split(":").flatMap((token) => {
    if (token.includes(".")) {
      const octets = ipv4Octets(token);
      return octets ? [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!] : [];
    }
    return [Number.parseInt(token, 16)];
  }) : [];
  const leftParts = parse(left);
  const rightParts = parse(right);
  const missing = 8 - leftParts.length - rightParts.length;
  const parts = normalized.includes("::") ? [...leftParts, ...Array(Math.max(0, missing)).fill(0), ...rightParts] : leftParts;
  return parts.length === 8 && parts.every((item) => Number.isInteger(item) && item >= 0 && item <= 0xffff) ? parts : undefined;
}

// Conservative snapshot of every prefix in the IANA IPv6 Special-Purpose Address Space registry.
// Even entries marked globally reachable are rejected: Manual endpoints must use ordinary global unicast.
const IANA_IPV6_SPECIAL_PREFIXES: readonly (readonly [string, number])[] = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["100:0:0:1::", 64], ["2001::", 23], ["2001::", 32], ["2001:1::1", 128],
  ["2001:1::2", 128], ["2001:1::3", 128], ["2001:2::", 48], ["2001:3::", 32], ["2001:4:112::", 48],
  ["2001:10::", 28], ["2001:20::", 28], ["2001:30::", 28], ["2001:db8::", 32], ["2002::", 16],
  ["2620:4f:8000::", 48], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10],
];

function matchesIpv6Prefix(address: readonly number[], prefix: string, bits: number): boolean {
  const expected = expandIpv6(prefix);
  if (!expected) return false;
  const completeWords = Math.floor(bits / 16);
  for (let index = 0; index < completeWords; index += 1) if (address[index] !== expected[index]) return false;
  const remaining = bits % 16;
  if (!remaining) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  return (address[completeWords]! & mask) === (expected[completeWords]! & mask);
}

function publicIpv6(address: string): boolean {
  const parts = expandIpv6(address);
  if (!parts) return false;
  if (IANA_IPV6_SPECIAL_PREFIXES.some(([prefix, bits]) => matchesIpv6Prefix(parts, prefix, bits))) return false;
  return (parts[0]! & 0xe000) === 0x2000;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address.replace(/^\[|\]$/g, ""));
  return version === 4 ? publicIpv4(address) : version === 6 ? publicIpv6(address.replace(/^\[|\]$/g, "")) : false;
}

const defaultResolver: Resolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) => record.family === 4 || record.family === 6 ? [{ address: record.address, family: record.family }] : []);
};

export function validateManualEndpointUrl(input: string | URL): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new ManualEndpointPolicyError("La URL Manual no es válida."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || (local && url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new ManualEndpointPolicyError("La URL Manual debe ser HTTPS y no incluir credenciales, consulta ni fragmento.");
  }
  return url;
}

export async function resolveManualEndpoint(input: string | URL, resolver: Resolver = defaultResolver): Promise<{ url: URL; addresses: readonly ResolvedAddress[] }> {
  const url = validateManualEndpointUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "127.0.0.1") return { url, addresses: [{ address: "127.0.0.1", family: 4 }] };
  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [{ address: hostname, family: literalVersion as 4 | 6 }] : await resolver(hostname);
  if (!addresses.length || addresses.some((record) => !isPublicIpAddress(record.address))) throw new ManualEndpointPolicyError();
  return { url, addresses };
}

function pinnedLookup(addresses: readonly ResolvedAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, addresses.map((record) => ({ ...record })));
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  };
}

function defaultAgentFactory(lookup: PinnedLookup, maxResponseBytes: number): ClosableDispatcher {
  return new Agent({
    maxRedirections: 0,
    maxResponseSize: maxResponseBytes,
    connect: { lookup: lookup as never },
  });
}

function boundedResponse(response: Response, dispatcher: ClosableDispatcher, maxBytes: number): Response {
  if (!response.body) {
    void dispatcher.close();
    return response;
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) void dispatcher.destroy(error);
    else void dispatcher.close();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { finish(); controller.close(); return; }
        bytes += result.value.byteLength;
        if (bytes > maxBytes) {
          const error = new ManualEndpointPolicyError("La respuesta del proveedor supera el tamaño permitido.");
          await reader.cancel(error);
          finish(error);
          controller.error(error);
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        const safe = error instanceof ManualEndpointPolicyError ? error : new ManualEndpointPolicyError("No se pudo leer la respuesta del proveedor.");
        finish(safe);
        controller.error(safe);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      finish(new ManualEndpointPolicyError("La petición al proveedor fue cancelada."));
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createPinnedManualFetcher(options: {
  lookup?: Resolver;
  agentFactory?: AgentFactory;
  fetcher?: FetchWithDispatcher;
  maxResponseBytes?: number;
} = {}): FetchWithDispatcher {
  const resolver = options.lookup ?? defaultResolver;
  const agentFactory = options.agentFactory ?? defaultAgentFactory;
  const networkFetch = options.fetcher ?? (undiciFetch as unknown as FetchWithDispatcher);
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MANUAL_RESPONSE_LIMIT;
  return async (input, init = {}) => {
    const { url, addresses } = await resolveManualEndpoint(typeof input === "string" || input instanceof URL ? input : input.url, resolver);
    const dispatcher = agentFactory(pinnedLookup(addresses), maxResponseBytes);
    try {
      const response = await networkFetch(url, { ...init, redirect: "manual", dispatcher });
      if (response.status >= 300 && response.status < 400) {
        const error = new ManualEndpointPolicyError("El endpoint Manual no puede usar redirecciones.");
        void dispatcher.destroy(error);
        throw error;
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        const error = new ManualEndpointPolicyError("La respuesta del proveedor supera el tamaño permitido.");
        void dispatcher.destroy(error);
        throw error;
      }
      return boundedResponse(response, dispatcher, maxResponseBytes);
    } catch (error) {
      void dispatcher.destroy(error instanceof Error ? error : undefined);
      throw error;
    }
  };
}
