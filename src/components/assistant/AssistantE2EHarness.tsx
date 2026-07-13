"use client";

import { useEffect } from "react";
import { DirectIndexExecutor } from "@/lib/assistant/search/directIndex";
import { createSanitizedPerformanceFixture, summarizeIndexMeasurements, type IndexMeasurementSummary } from "@/lib/assistant/search/performanceFixture";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export interface AssistantE2EHarnessApi {
  measureDirectIndex(): Promise<IndexMeasurementSummary & { readonly measurements: readonly number[]; readonly longTaskDurations: readonly number[] }>;
}

declare global {
  interface Window { __assistantE2E?: AssistantE2EHarnessApi }
}

export async function measureDirectIndexForE2E(): Promise<IndexMeasurementSummary & { readonly measurements: readonly number[]; readonly longTaskDurations: readonly number[] }> {
  const chunks = createSanitizedPerformanceFixture(5_200);
  const executor = new DirectIndexExecutor();
  executor.execute(chunks);
  await pause(0);
  const longTaskDurations: number[] = [];
  const observer = typeof PerformanceObserver === "undefined" ? undefined : new PerformanceObserver((list) => {
    longTaskDurations.push(...list.getEntries().map((entry) => entry.duration));
  });
  observer?.observe({ entryTypes: ["longtask"] });
  const measurements: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    executor.execute(chunks);
    measurements.push(performance.now() - start);
    await pause(0);
  }
  observer?.disconnect();
  const summary = summarizeIndexMeasurements(measurements, longTaskDurations);
  return { ...summary, measurements, longTaskDurations };
}

export function AssistantE2EHarness() {
  useEffect(() => {
    window.__assistantE2E = { measureDirectIndex: measureDirectIndexForE2E };
    return () => { delete window.__assistantE2E; };
  }, []);
  return null;
}
