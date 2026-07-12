import { assistantStreamEventSchema, type AssistantStreamEvent } from "@/lib/assistant/schemas";

export class IncrementalNdjsonDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";

  push(chunk: Uint8Array | string): AssistantStreamEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const records = this.buffer.split("\n");
    this.buffer = records.pop() ?? "";
    return records.filter((record) => record.trim().length > 0).map((record) => assistantStreamEventSchema.parse(JSON.parse(record)));
  }

  finish(): AssistantStreamEvent[] {
    this.buffer += this.decoder.decode();
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const record = this.buffer;
    this.buffer = "";
    return [assistantStreamEventSchema.parse(JSON.parse(record))];
  }
}
