import type { AnalysisConfig, ConceptMappingRule, StoredAnalysis } from "@/lib/types";
import { normalizeEmployeeId } from "@/lib/utils/normalize";

const DB_NAME = "retributivo-analysis-v1";
const STORE_NAME = "analyses";
const FALLBACK_HISTORY_KEY = "retributivo.history.v1";
const ACTIVE_ANALYSIS_KEY = "retributivo.activeAnalysisId.v1";
const SETTINGS_KEY = "retributivo.settings.v1";

export const STORAGE_SCHEMA_VERSION = 2;

export interface AppSettings {
  readonly defaultTolerance: number;
  readonly enableAIByDefault: boolean;
  readonly autoExplainOnOpen: boolean;
  readonly reviewThreshold: number;
  readonly incidentThreshold: number;
  readonly aiModel: string;
  readonly excludedEmployeeIds: readonly string[];
  readonly conceptMap: readonly ConceptMappingRule[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultTolerance: 1,
  enableAIByDefault: true,
  autoExplainOnOpen: false,
  reviewThreshold: 1,
  incidentThreshold: 50,
  aiModel: "gemini-3.1-flash-lite",
  excludedEmployeeIds: [],
  conceptMap: [],
};

export function configFromSettings(settings: AppSettings): AnalysisConfig {
  return {
    tolerance: settings.defaultTolerance,
    enableAI: false,
    aiModel: settings.aiModel,
    conceptMap: settings.conceptMap,
    excludedEmployeeIds: settings.excludedEmployeeIds,
    thresholds: {
      reviewThreshold: settings.reviewThreshold,
      incidentThreshold: settings.incidentThreshold,
    },
  };
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEmployeeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(normalizeEmployeeId).filter(Boolean))];
}

function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  return {
    defaultTolerance: normalizeNumber(value?.defaultTolerance, DEFAULT_SETTINGS.defaultTolerance),
    enableAIByDefault: typeof value?.enableAIByDefault === "boolean" ? value.enableAIByDefault : DEFAULT_SETTINGS.enableAIByDefault,
    autoExplainOnOpen: typeof value?.autoExplainOnOpen === "boolean" ? value.autoExplainOnOpen : DEFAULT_SETTINGS.autoExplainOnOpen,
    reviewThreshold: normalizeNumber(value?.reviewThreshold, DEFAULT_SETTINGS.reviewThreshold),
    incidentThreshold: normalizeNumber(value?.incidentThreshold, DEFAULT_SETTINGS.incidentThreshold),
    aiModel: value?.aiModel || DEFAULT_SETTINGS.aiModel,
    excludedEmployeeIds: normalizeEmployeeIdList(value?.excludedEmployeeIds),
    conceptMap: Array.isArray(value?.conceptMap) ? value.conceptMap : DEFAULT_SETTINGS.conceptMap,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCompatibleAnalysis(record: unknown): record is StoredAnalysis {
  if (!isObject(record) || !isObject(record.result) || !isObject(record.result.summary)) {
    return false;
  }

  const result = record.result as Record<string, unknown>;
  const summary = result.summary as Record<string, unknown>;
  return (
    Array.isArray(result.people) &&
    Array.isArray(result.normalizedVsReal) &&
    Array.isArray(result.concepts) &&
    Array.isArray(result.unmappedConcepts) &&
    Array.isArray(result.internalExcelChecks) &&
    Array.isArray(result.payrollRecords) &&
    Array.isArray(result.registroEmployees) &&
    isFiniteNumber(summary.pdfsAnalyzed) &&
    isFiniteNumber(summary.uniquePeople) &&
    isFiniteNumber(summary.peopleWithDifferences) &&
    isFiniteNumber(summary.totalSalaryDifference) &&
    isFiniteNumber(summary.totalSalaryComplementDifference) &&
    isFiniteNumber(summary.totalExtraSalaryDifference) &&
    isFiniteNumber(summary.totalGlobalDifference) &&
    isFiniteNumber(summary.conceptsUnmapped)
  );
}

function normalizeStoredAnalysis(record: unknown): StoredAnalysis | undefined {
  if (!isCompatibleAnalysis(record)) {
    return undefined;
  }

  return {
    ...record,
    result: {
      ...record.result,
      excludedEmployeeIdsApplied: normalizeEmployeeIdList((record.result as unknown as Record<string, unknown>).excludedEmployeeIdsApplied),
    },
    schemaVersion: STORAGE_SCHEMA_VERSION,
  };
}

function filterCompatibleAnalyses(records: readonly unknown[]): StoredAnalysis[] {
  return records.map(normalizeStoredAnalysis).filter((item): item is StoredAnalysis => Boolean(item));
}

function countIncompatible(records: readonly unknown[]): number {
  return records.length - filterCompatibleAnalyses(records).length;
}

export function loadSettings(): AppSettings {
  if (!hasLocalStorage()) {
    return DEFAULT_SETTINGS;
  }

  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AppSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function loadActiveAnalysisId(): string | undefined {
  if (!hasLocalStorage()) {
    return undefined;
  }

  return window.localStorage.getItem(ACTIVE_ANALYSIS_KEY) || undefined;
}

export function saveActiveAnalysisId(id: string | undefined): void {
  if (!hasLocalStorage()) {
    return;
  }

  if (id) {
    window.localStorage.setItem(ACTIVE_ANALYSIS_KEY, id);
  } else {
    window.localStorage.removeItem(ACTIVE_ANALYSIS_KEY);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);

    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function readFallbackHistory(): StoredAnalysis[] {
  if (!hasLocalStorage()) {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(FALLBACK_HISTORY_KEY) || "[]") as StoredAnalysis[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFallbackHistory(records: readonly StoredAnalysis[]): void {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.setItem(FALLBACK_HISTORY_KEY, JSON.stringify(records));
}

export async function saveAnalysis(record: StoredAnalysis): Promise<void> {
  const normalized = { ...record, schemaVersion: STORAGE_SCHEMA_VERSION };
  if (hasIndexedDb()) {
    await withStore("readwrite", (store) => store.put(normalized));
    return;
  }

  const records = readFallbackHistory().filter((item) => item.id !== normalized.id);
  writeFallbackHistory([normalized, ...records]);
}

export async function listAnalyses(): Promise<StoredAnalysis[]> {
  const activeId = loadActiveAnalysisId();
  if (!hasIndexedDb()) {
    const compatible = filterCompatibleAnalyses(readFallbackHistory()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (activeId && !compatible.some((item) => item.id === activeId)) {
      saveActiveAnalysisId(undefined);
    }
    return compatible;
  }

  const records = await withStore<unknown[]>("readonly", (store) => store.getAll());
  const compatible = filterCompatibleAnalyses(records ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (activeId && !compatible.some((item) => item.id === activeId)) {
    saveActiveAnalysisId(undefined);
  }
  return compatible;
}

export async function countIncompatibleAnalyses(): Promise<number> {
  if (!hasIndexedDb()) {
    return countIncompatible(readFallbackHistory());
  }

  const records = await withStore<unknown[]>("readonly", (store) => store.getAll());
  return countIncompatible(records ?? []);
}

export async function getAnalysis(id: string): Promise<StoredAnalysis | undefined> {
  let record: unknown;
  if (!hasIndexedDb()) {
    record = readFallbackHistory().find((item) => item.id === id);
  } else {
    record = await withStore<unknown>("readonly", (store) => store.get(id));
  }

  const compatible = normalizeStoredAnalysis(record);
  if (!compatible && loadActiveAnalysisId() === id) {
    saveActiveAnalysisId(undefined);
  }
  return compatible;
}

export async function deleteAnalysis(id: string): Promise<void> {
  if (hasIndexedDb()) {
    await withStore("readwrite", (store) => store.delete(id));
  } else {
    writeFallbackHistory(readFallbackHistory().filter((item) => item.id !== id));
  }

  if (loadActiveAnalysisId() === id) {
    saveActiveAnalysisId(undefined);
  }
}

export async function clearAnalyses(): Promise<void> {
  if (hasIndexedDb()) {
    await withStore("readwrite", (store) => store.clear());
  } else {
    writeFallbackHistory([]);
  }

  saveActiveAnalysisId(undefined);
}
