// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AppStateProvider, useAppState } from "@/components/app/AppState";
import { saveActiveAnalysisId, saveAnalysis, STORAGE_SCHEMA_VERSION } from "@/lib/storage/analysisStorage";
import type { StoredAnalysis } from "@/lib/types";

let state: ReturnType<typeof useAppState> | undefined;
function Probe() { state = useAppState(); return <output>{state.view}:{state.filters.query}:{state.assistantNavigationIntent?.type ?? "none"}</output>; }

const stored = {
  id: "analysis-1", schemaVersion: STORAGE_SCHEMA_VERSION, createdAt: "2026-07-13T10:00:00.000Z", registroFileName: "registro.xlsx", pdfCount: 1,
  config: { tolerance: 1, enableAI: false, aiModel: "local", thresholds: { reviewThreshold: 1, incidentThreshold: 50 }, conceptMap: [], excludedEmployeeIds: [] },
  result: {
    summary: { generatedAt: "2026-07-13T10:00:00.000Z", pdfsAnalyzed: 1, pdfsFailed: 0, uniquePeople: 0, peopleWithDifferences: 0, totalSalaryDifference: 0, totalSalaryComplementDifference: 0, totalExtraSalaryDifference: 0, totalGlobalDifference: 0, matchedPeople: 0, matchedTotalDifference: 0, conceptsUnmapped: 0, internalExcelDifferences: 0, groupingDifferences: 0, tolerance: 1 },
    payrollRecords: [], registroEmployees: [], people: [], normalizedVsReal: [], concepts: [], unmappedConcepts: [], ignoredConcepts: [], groupings: [], internalExcelChecks: [], conceptMap: [], excludedEmployeeIdsApplied: [], errors: [], criteria: [],
  },
} as unknown as StoredAnalysis;

beforeEach(async () => {
  vi.restoreAllMocks(); vi.stubGlobal("indexedDB", undefined); window.localStorage.clear(); state = undefined;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: false, enabled: false, model: "local" }))));
  await saveAnalysis(stored); saveActiveAnalysisId(stored.id);
});

test("routes every assistant navigation intent through the real AppState", async () => {
  render(<AppStateProvider><Probe /></AppStateProvider>);
  await waitFor(() => expect(state?.activeAnalysis?.id).toBe("analysis-1"));
  act(() => state?.navigateAssistantIntent({ type: "open_person", analysisId: "analysis-1", personId: "001" }));
  expect(state).toMatchObject({ view: "personas", filters: { query: "001" }, assistantNavigationIntent: { type: "open_person" } });
  act(() => state?.navigateAssistantIntent({ type: "open_cuadre", analysisId: "analysis-1", personId: "001", view: "normalized_variables" }));
  expect(state).toMatchObject({ view: "cuadre-excel", assistantNavigationIntent: { type: "open_cuadre", view: "normalized_variables" } });
  act(() => state?.navigateAssistantIntent({ type: "open_grouping", analysisId: "analysis-1", groupingId: "grupo-7" }));
  expect(state).toMatchObject({ view: "agrupaciones", filters: { query: "grupo-7" }, assistantNavigationIntent: { type: "open_grouping" } });
  act(() => state?.navigateAssistantIntent({ type: "show_sources", sourceIds: ["source-1"] }));
  expect(state).toMatchObject({ view: "asistente", assistantNavigationIntent: { type: "show_sources", sourceIds: ["source-1"] } });
});
