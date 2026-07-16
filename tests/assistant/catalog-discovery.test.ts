import { describe, expect, it, vi } from "vitest";
import { discoverCompleteCatalog, inferConservativeCapabilities } from "@/lib/assistant/catalog/discovery";

describe("model catalog discovery", () => {
  it("finishes pagination before publishing and never performs inference probes", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({ models: [{ id: "chat-a", displayName: "Chat A", supportedParameters: ["tools"] }], nextCursor: "page-2" })
      .mockResolvedValueOnce({ models: [{ id: "embed-a", displayName: "Embed A" }], complete: true });
    const probe = vi.fn();

    const result = await discoverCompleteCatalog({ providerId: "provider-1", readPage, probe });

    expect(readPage).toHaveBeenNthCalledWith(1, undefined, expect.any(AbortSignal));
    expect(readPage).toHaveBeenNthCalledWith(2, "page-2", expect.any(AbortSignal));
    expect(result.completion).toBe("complete");
    expect(result.models).toHaveLength(2);
    expect(probe).not.toHaveBeenCalled();
  });

  it("rejects a failure halfway through pagination without publishing mixed results", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({ models: [{ id: "chat-a", displayName: "Chat A" }], nextCursor: "page-2" })
      .mockRejectedValueOnce(new Error("private upstream detail"));
    await expect(discoverCompleteCatalog({ providerId: "provider-1", readPage })).rejects.toMatchObject({ code: "catalog_partial_error" });
  });

  it("uses conservative model-family patterns and leaves unknown tool support disabled", () => {
    expect(inferConservativeCapabilities({ id: "text-embedding-3-small" })).toEqual(expect.objectContaining({ chat: false, tools: false }));
    expect(inferConservativeCapabilities({ id: "whisper-1" })).toEqual(expect.objectContaining({ chat: false, tools: false }));
    expect(inferConservativeCapabilities({ id: "unclassified-chat-model" })).toEqual(expect.objectContaining({ chat: true, tools: "unknown" }));
    expect(inferConservativeCapabilities({ id: "unclassified-chat-model", supportedParameters: ["tools", "stream"] })).toEqual(expect.objectContaining({ chat: true, tools: true, streaming: true }));
  });
});
