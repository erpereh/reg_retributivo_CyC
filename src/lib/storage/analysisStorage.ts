import type { AnalysisConfig, StoredAnalysis } from "@/lib/types";

const DB_NAME = "retributivo-analysis-v1";
const STORE_NAME = "analyses";
const FALLBACK_HISTORY_KEY = "retributivo.history.v1";
const ACTIVE_ANALYSIS_KEY = "retributivo.activeAnalysisId.v1";
const SETTINGS_KEY = "retributivo.settings.v1";

export interface AppSettings {
  readonly defaultTolerance: number;
  readonly enableAIByDefault: boolean;
  readonly reviewThreshold: number;
  readonly incidentThreshold: number;
  readonly aiModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultTolerance: 1,
  enableAIByDefault: true,
  reviewThreshold: 1,
  incidentThreshold: 50,
  aiModel: "gemini-3.1-flash-lite",
};

export function configFromSettings(settings: AppSettings): AnalysisConfig {
  return {
    tolerance: settings.defaultTolerance,
    enableAI: settings.enableAIByDefault,
    aiModel: settings.aiModel,
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

function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  return {
    defaultTolerance: normalizeNumber(value?.defaultTolerance, DEFAULT_SETTINGS.defaultTolerance),
    enableAIByDefault: typeof value?.enableAIByDefault === "boolean" ? value.enableAIByDefault : DEFAULT_SETTINGS.enableAIByDefault,
    reviewThreshold: normalizeNumber(value?.reviewThreshold, DEFAULT_SETTINGS.reviewThreshold),
    incidentThreshold: normalizeNumber(value?.incidentThreshold, DEFAULT_SETTINGS.incidentThreshold),
    aiModel: value?.aiModel || DEFAULT_SETTINGS.aiModel,
  };
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
  if (hasIndexedDb()) {
    await withStore("readwrite", (store) => store.put(record));
    return;
  }

  const records = readFallbackHistory().filter((item) => item.id !== record.id);
  writeFallbackHistory([record, ...records]);
}

export async function listAnalyses(): Promise<StoredAnalysis[]> {
  if (!hasIndexedDb()) {
    return readFallbackHistory().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const records = await withStore<StoredAnalysis[]>("readonly", (store) => store.getAll());
  return (records ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAnalysis(id: string): Promise<StoredAnalysis | undefined> {
  if (!hasIndexedDb()) {
    return readFallbackHistory().find((item) => item.id === id);
  }

  return withStore<StoredAnalysis | undefined>("readonly", (store) => store.get(id));
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
