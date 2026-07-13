import { assistantStreamEventSchema, type AssistantStreamEvent } from "@/lib/assistant/schemas";

export class SafeDeltaBuffer {
  private buffer = "";
  private total = 0;
  constructor(private readonly audit: (value: string) => void, private readonly tailLength = 512, private readonly maxTotal = 16_384) {}
  push(delta: string): string[] {
    this.total += delta.length; if (this.total > this.maxTotal) throw new RangeError("El texto supera el tamaño permitido.");
    this.buffer += delta; this.audit(this.buffer);
    if (this.buffer.length <= this.tailLength) return [];
    const prefix = this.buffer.slice(0, this.buffer.length - this.tailLength); this.audit(prefix); this.buffer = this.buffer.slice(prefix.length); return [prefix];
  }
  flush(): string[] { if (!this.buffer) return []; this.audit(this.buffer); const value = this.buffer; this.buffer = ""; return [value]; }
}

export class IncrementalNdjsonDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private totalBytes = 0;

  constructor(private readonly limits: { maxLineBytes?: number; maxTotalBytes?: number } = {}) {}

  push(chunk: Uint8Array | string): AssistantStreamEvent[] {
    this.totalBytes += typeof chunk === "string" ? new TextEncoder().encode(chunk).byteLength : chunk.byteLength;
    if (this.totalBytes > (this.limits.maxTotalBytes ?? 2 * 1024 * 1024)) throw new Error("El stream NDJSON supera el tamaño permitido.");
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const records = this.buffer.split("\n");
    this.buffer = records.pop() ?? "";
    this.assertLine(this.buffer);
    return records.filter((record) => record.trim().length > 0).map((record) => { this.assertLine(record); return assistantStreamEventSchema.parse(JSON.parse(record)); });
  }

  finish(): AssistantStreamEvent[] {
    this.buffer += this.decoder.decode();
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const record = this.buffer;
    this.buffer = "";
    this.assertLine(record);
    return [assistantStreamEventSchema.parse(JSON.parse(record))];
  }

  private assertLine(value: string): void {
    if (new TextEncoder().encode(value).byteLength > (this.limits.maxLineBytes ?? 64 * 1024)) throw new Error("Una línea NDJSON supera el tamaño permitido.");
  }
}
