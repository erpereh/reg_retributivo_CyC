// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAnalyses,
  deleteAnalysis,
  getAnalysis,
  listAnalyses,
  loadActiveAnalysisId,
  loadSettings,
  saveActiveAnalysisId,
  saveAnalysis,
  saveSettings,
  type AppSettings,
} from "@/lib/storage/analysisStorage";
import type { StoredAnalysis } from "@/lib/types";

const settings: AppSettings = {
  defaultTolerance: 2,
  enableAIByDefault: false,
  reviewThreshold: 5,
  incidentThreshold: 80,
  aiModel: "gemini-3.1-flash-lite",
};

function sampleAnalysis(id: string, createdAt: string): StoredAnalysis {
  return {
    id,
    createdAt,
    registroFileName: "registro.xlsx",
    pdfCount: 3,
    config: {
      tolerance: 1,
      enableAI: false,
      aiModel: "gemini-3.1-flash-lite",
      thresholds: { reviewThreshold: 1, incidentThreshold: 50 },
    },
    result: {
      summary: {
        generatedAt: createdAt,
        pdfsAnalyzed: 3,
        pdfsFailed: 0,
        uniquePeople: 2,
        peopleWithIssues: 1,
        fieldIssuesCount: 1,
        salaryIssuesCount: 1,
        salaryDifferenceTotal: 10,
        salaryDifferenceAbsTotal: 10,
        tolerance: 1,
      },
      payrollRecords: [],
      registroRecords: [],
      fieldIssues: [],
      salaryDifferences: [],
      errors: [],
      criteria: [],
    },
  };
}

describe("analysisStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", undefined);
    window.localStorage.clear();
  });

  test("persists settings and active analysis id in localStorage", () => {
    saveSettings(settings);
    saveActiveAnalysisId("analysis-1");

    expect(loadSettings()).toEqual(settings);
    expect(loadActiveAnalysisId()).toBe("analysis-1");

    saveActiveAnalysisId(undefined);
    expect(loadActiveAnalysisId()).toBeUndefined();
  });

  test("saves, lists, opens, deletes and clears analysis history", async () => {
    const older = sampleAnalysis("older", "2026-07-01T10:00:00.000Z");
    const newer = sampleAnalysis("newer", "2026-07-02T10:00:00.000Z");

    await saveAnalysis(older);
    await saveAnalysis(newer);
    saveActiveAnalysisId("older");

    expect((await listAnalyses()).map((item) => item.id)).toEqual(["newer", "older"]);
    expect((await getAnalysis("older"))?.pdfCount).toBe(3);

    await deleteAnalysis("older");
    expect(await getAnalysis("older")).toBeUndefined();
    expect(loadActiveAnalysisId()).toBeUndefined();

    await clearAnalyses();
    expect(await listAnalyses()).toEqual([]);
  });
});
