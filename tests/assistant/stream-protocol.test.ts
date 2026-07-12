import { describe, expect, test } from "vitest";
import { IncrementalNdjsonDecoder } from "@/lib/assistant/streamProtocol";

const events = [
  { type: "status", roundId: "r1", label: "Preparando" },
  { type: "tool_request", roundId: "r1", requestId: "q1", tool: "getPersonProfile", args: { analysisId: "analysis-1", personId: "10048" } },
  { type: "tool_result_ack", roundId: "r1", requestId: "q1" },
  { type: "text_delta", roundId: "r1", messageId: "m1", delta: "Hola" },
  {
    type: "source",
    roundId: "r1",
    source: {
      id: "s1", conversationId: "c1", sourceType: "person_profile", sanitizedSourceLabel: "Persona matrícula 10048",
      availability: "available", personId: "10048", conceptIds: [], excerpt: "Totales locales", sanitizedHash: "hash",
    },
  },
  {
    type: "action", roundId: "r1", action: {
      id: "a1", conversationId: "c1", messageId: "m1", label: "Abrir persona", description: "Abre la ficha",
      action: { type: "open_person", analysisId: "analysis-1", personId: "10048" }, status: "pending", createdAt: "2026-07-13T10:00:00.000Z",
    },
  },
  { type: "usage", roundId: "r1", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, estimated: true } },
  { type: "done", roundId: "r1", finishReason: "stop" },
  { type: "error", roundId: "r1", code: "fake_error", message: "Error seguro", retryable: false },
] as const;

describe("incremental NDJSON decoder", () => {
  test.each(events)("accepts the $type event", (event) => {
    const decoder = new IncrementalNdjsonDecoder();
    expect(decoder.push(`${JSON.stringify(event)}\n`)).toEqual([event]);
    expect(decoder.finish()).toEqual([]);
  });

  test("decodes UTF-8 records split across arbitrary chunks", () => {
    const decoder = new IncrementalNdjsonDecoder();
    const encoded = new TextEncoder().encode(`${JSON.stringify(events[0])}\n${JSON.stringify(events[3])}\n`);
    expect(decoder.push(encoded.slice(0, 11))).toEqual([]);
    expect(decoder.push(encoded.slice(11, 37))).toEqual([]);
    expect(decoder.push(encoded.slice(37))).toEqual([events[0], events[3]]);
  });

  test.each([
    "{not-json}\n",
    `${JSON.stringify({ type: "markdown", roundId: "r1", content: "```event" })}\n`,
    `${JSON.stringify({ type: "text_delta", roundId: "r1", messageId: "m1" })}\n`,
  ])("fails closed for malformed or invalid records", (line) => {
    const decoder = new IncrementalNdjsonDecoder();
    expect(() => decoder.push(line)).toThrow();
  });

  test.each([
    { type: "tool_request", roundId: "r1", requestId: "q1", tool: "searchPeople", args: { analysisId: "analysis-1", personId: "10048" } },
    { type: "tool_request", roundId: "r1", requestId: "q1", tool: "getPersonProfile", args: { personId: "10048" } },
    { type: "tool_request", roundId: "r1", requestId: "q1", tool: "getPersonProfile", args: { analysisId: "analysis-1", personId: "10048", name: "Ana" } },
  ])("rejects unknown or invalid Phase 1 tool requests", (event) => {
    const decoder = new IncrementalNdjsonDecoder();
    expect(() => decoder.push(`${JSON.stringify(event)}\n`)).toThrow();
  });

  test("fails closed when the final record is incomplete", () => {
    const decoder = new IncrementalNdjsonDecoder();
    decoder.push('{"type":"done"');
    expect(() => decoder.finish()).toThrow();
  });
});
