// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppStateProvider, useAppState } from "@/components/app/AppState";
import { getAnalysis, listAnalyses, saveActiveAnalysisId, saveAnalysis, STORAGE_SCHEMA_VERSION, type AppSettings } from "@/lib/storage/analysisStorage";
import type { AnalysisResult, ConceptMappingRule, StoredAnalysis } from "@/lib/types";

const settings: AppSettings = {
  defaultTolerance: 1,
  enableAIByDefault: false,
  autoExplainOnOpen: false,
  reviewThreshold: 1,
  incidentThreshold: 50,
  aiModel: "gemini-3.1-flash-lite",
  excludedEmployeeIds: [],
  conceptMap: [],
};

function result(uniquePeople: number): AnalysisResult {
  return {
    summary: {
      generatedAt: "2026-07-05T10:00:00.000Z",
      pdfsAnalyzed: 1,
      pdfsFailed: 0,
      uniquePeople,
      peopleWithDifferences: 0,
      totalSalaryDifference: 0,
      totalSalaryComplementDifference: 0,
      totalExtraSalaryDifference: 0,
      totalGlobalDifference: 0,
      matchedPeople: uniquePeople,
      matchedTotalDifference: 0,
      conceptsUnmapped: 0,
      internalExcelDifferences: 0,
      groupingDifferences: 0,
      tolerance: 1,
    },
    payrollRecords: [],
    registroEmployees: [],
    people: [],
    normalizedVsReal: [],
    concepts: [],
    unmappedConcepts: [],
    ignoredConcepts: [],
    groupings: [],
    internalExcelChecks: [],
    conceptMap: [],
    excludedEmployeeIdsApplied: [],
    errors: [],
    criteria: [],
  };
}

function analysisRecord(id: string, uniquePeople: number): StoredAnalysis {
  return {
    id,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    createdAt: "2026-07-05T09:00:00.000Z",
    registroFileName: "registro.xlsx",
    pdfCount: 1,
    config: {
      tolerance: 1,
      enableAI: false,
      aiModel: "gemini-3.1-flash-lite",
      thresholds: { reviewThreshold: 1, incidentThreshold: 50 },
      conceptMap: [],
      excludedEmployeeIds: [],
    },
    result: result(uniquePeople),
  };
}

let latestState: ReturnType<typeof useAppState> | undefined;

function Probe() {
  latestState = useAppState();
  return null;
}

describe("AppStateProvider refresh flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("indexedDB", undefined);
    window.localStorage.clear();
    latestState = undefined;
  });

  test("updates data by replacing the active history entry and showing the exact toast", async () => {
    await saveAnalysis(analysisRecord("analysis-1", 1));
    saveActiveAnalysisId("analysis-1");

    const refreshed = result(3);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai/status") {
        return new Response(JSON.stringify({ configured: false, enabled: false, model: "gemini-3.1-flash-lite" }), { status: 200 });
      }
      if (url === "/api/analyze") {
        return new Response(JSON.stringify(refreshed), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    );

    await waitFor(() => expect(latestState?.hydrating).toBe(false));
    await act(async () => {
      latestState?.setRegistroFile(new File(["registro"], "registro.xlsx"));
      latestState?.setPdfFiles([new File(["pdf"], "recibo.pdf")]);
    });

    const conceptMap: readonly ConceptMappingRule[] = [];
    await act(async () => {
      await latestState?.saveConceptMapAndRefresh(conceptMap);
    });

    expect(latestState?.activeAnalysis?.id).toBe("analysis-1");
    expect(latestState?.activeAnalysis?.result.summary.uniquePeople).toBe(3);
    expect(await listAnalyses()).toHaveLength(1);
    expect((await getAnalysis("analysis-1"))?.result.summary.uniquePeople).toBe(3);
    expect(latestState?.toasts.at(-1)?.title).toBe("Análisis actualizado.");
  });
});
