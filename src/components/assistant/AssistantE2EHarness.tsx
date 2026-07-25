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
  await pause(100);
  const longTaskEntries: PerformanceEntry[] = [];
  const observer = typeof PerformanceObserver === "undefined" ? undefined : new PerformanceObserver((list) => {
    longTaskEntries.push(...list.getEntries());
  });
  observer?.observe({ entryTypes: ["longtask"] });
  const measurements: number[] = [];
  const measurementWindows: Array<{ readonly start: number; readonly end: number }> = [];
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    executor.execute(chunks);
    const end = performance.now();
    measurements.push(end - start);
    measurementWindows.push({ start, end });
    await pause(0);
  }
  await pause(0);
  longTaskEntries.push(...(observer?.takeRecords() ?? []));
  observer?.disconnect();
  const longTaskDurations = longTaskEntries.filter((entry) => measurementWindows.some(({ start, end }) => (
    entry.startTime < end && entry.startTime + entry.duration > start
  ))).map((entry) => entry.duration);
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
