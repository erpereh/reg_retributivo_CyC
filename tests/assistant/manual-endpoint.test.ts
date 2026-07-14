import { describe, expect, test, vi } from "vitest";
import { createPinnedManualFetcher, isPublicIpAddress, resolveManualEndpoint } from "@/lib/assistant/server/manualEndpoint";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";

describe("Manual endpoint network policy", () => {
  test.each([
    "127.0.0.1", "10.0.0.8", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.0.0.8", "192.168.1.1", "224.0.0.1",
    "::1", "fe80::1", "fc00::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::1", "100::1",
    "2001::1", "2001:2::1", "2001:db8::1", "2002::1", "3fff::1",
  ])("rejects non-public address %s", (address) => expect(isPublicIpAddress(address)).toBe(false));

  test.each(["8.8.8.8", "1.1.1.1", "2404:6800:4003::200e", "2606:4700:4700::1111", "2a00:1450:4003::80e"])("accepts public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  test("rejects literal private hosts and DNS names resolving to any private address", async () => {
    await expect(resolveManualEndpoint("http://127.0.0.1:11434/v1", vi.fn())).resolves.toMatchObject({
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(resolveManualEndpoint("https://models.example.test/v1", vi.fn(async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.4", family: 4 as const },
    ]))).rejects.toThrow(/públic/i);
  });

  test("pins validated DNS answers inside fetch and never follows redirects", async () => {
    let pinnedLookup: ((hostname: string, options: { all?: boolean }, callback: (error: Error | null, value?: unknown, family?: number) => void) => void) | undefined;
    const dispatcher = { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) };
    const agentFactory = vi.fn((lookup) => { pinnedLookup = lookup; return dispatcher; });
    const networkFetch = vi.fn(async (_url, init) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.dispatcher).toBe(dispatcher);
      return new Response("ok", { status: 200 });
    });
    const fetcher = createPinnedManualFetcher({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory,
      fetcher: networkFetch,
    });

    const response = await fetcher("https://models.example.test/v1/models");
    await response.text();
    const callback = vi.fn();
    pinnedLookup!("models.example.test", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(dispatcher.close).toHaveBeenCalled();
  });

  test("rejects redirects and oversized provider bodies without exposing their content", async () => {
    const redirecting = createPinnedManualFetcher({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory: vi.fn(() => ({ close: vi.fn(), destroy: vi.fn() })),
      fetcher: vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } })),
    });
    await expect(redirecting("https://models.example.test/v1/models")).rejects.toThrow(/redirecciones/i);

    const oversized = createPinnedManualFetcher({
      maxResponseBytes: 8,
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory: vi.fn(() => ({ close: vi.fn(), destroy: vi.fn() })),
      fetcher: vi.fn(async () => new Response("provider-secret-body")),
    });
    await expect(oversized("https://models.example.test/v1/models").then((response) => response.text())).rejects.toThrow(/tamaño/i);
  });

  test("destroys the pinned dispatcher when an adapter rejects an HTTP response", async () => {
    const dispatcher = { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) };
    const fetcher = createPinnedManualFetcher({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory: vi.fn(() => dispatcher),
      fetcher: vi.fn(async () => new Response("private failure", { status: 401 })),
    });
    const adapter = new OpenAICompatibleAdapter({ provider: "manual", baseUrl: "https://models.example.test/v1", fetcher });
    await expect(adapter.listModels({ apiKey: "secret" })).rejects.toMatchObject({ classification: "auth" });
    expect(dispatcher.destroy).toHaveBeenCalled();
  });

  test("destroys the pinned dispatcher when a streaming response is not SSE", async () => {
    const dispatcher = { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) };
    const fetcher = createPinnedManualFetcher({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory: vi.fn(() => dispatcher),
      fetcher: vi.fn(async () => new Response("not an event stream", { headers: { "content-type": "application/json" } })),
    });
    const adapter = new OpenAICompatibleAdapter({ provider: "manual", baseUrl: "https://models.example.test/v1", fetcher });
    const consume = async () => {
      for await (const _event of adapter.streamResponse({ apiKey: "secret", modelId: "model", messages: [], maxOutputTokens: 1 })) { /* consume */ }
    };
    await expect(consume()).rejects.toMatchObject({ classification: "incompatible" });
    expect(dispatcher.destroy).toHaveBeenCalled();
  });

  test("cancels a Manual SSE body when the consumer returns before EOF", async () => {
    const dispatcher = { close: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) };
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n')); },
    });
    const fetcher = createPinnedManualFetcher({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      agentFactory: vi.fn(() => dispatcher),
      fetcher: vi.fn(async () => new Response(upstream, { headers: { "content-type": "text/event-stream" } })),
    });
    const adapter = new OpenAICompatibleAdapter({ provider: "manual", baseUrl: "https://models.example.test/v1", fetcher });
    const iterator = adapter.streamResponse({ apiKey: "secret", modelId: "model", messages: [], maxOutputTokens: 1 })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "text_delta", delta: "OK" } });
    await iterator.return?.();
    expect(dispatcher.close.mock.calls.length + dispatcher.destroy.mock.calls.length).toBeGreaterThan(0);
  });
});
