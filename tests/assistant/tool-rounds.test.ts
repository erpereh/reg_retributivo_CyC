import { describe, expect, test } from "vitest";
import { canonicalizeToolArguments, createLocalToolRequestId, toolCallsMatch } from "@/lib/assistant/toolRounds";

describe("tool round identity", () => {
  test("normalizes defaults before hashing tool arguments", async () => {
    const omittedDefault = await canonicalizeToolArguments("searchPeople", { analysisId: "a1", query: "10048" });
    const explicitDefault = await canonicalizeToolArguments("searchPeople", { query: "10048", limit: 10, analysisId: "a1" });

    expect(omittedDefault.args).toEqual({ analysisId: "a1", query: "10048", limit: 10 });
    expect(omittedDefault.hash).toBe(explicitDefault.hash);
  });

  test("rejects a result whose canonical arguments differ from its call", async () => {
    const call = await canonicalizeToolArguments("getPersonProfile", { analysisId: "a1", personId: "10048" });
    const different = await canonicalizeToolArguments("getPersonProfile", { analysisId: "a1", personId: "10050" });

    expect(toolCallsMatch(
      { executionId: "e1", roundId: "r1", requestId: "q1", name: "getPersonProfile", argsHash: call.hash },
      { executionId: "e1", roundId: "r1", requestId: "q1", name: "getPersonProfile", argsHash: different.hash },
    )).toBe(false);
  });

  test("creates deterministic local ids when the provider omits a call id", () => {
    expect(createLocalToolRequestId("execution-1", "round-2", 0)).toBe("execution-1:round-2:tool:1");
    expect(createLocalToolRequestId("execution-1", "round-2", 1)).toBe("execution-1:round-2:tool:2");
  });
});
