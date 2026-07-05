"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnalysisConfig, AnalysisResult, AppView, StoredAnalysis } from "@/lib/types";
import {
  clearAnalyses,
  configFromSettings,
  countIncompatibleAnalyses,
  deleteAnalysis,
  DEFAULT_SETTINGS,
  getAnalysis,
  listAnalyses,
  loadActiveAnalysisId,
  loadSettings,
  saveActiveAnalysisId,
  saveAnalysis,
  saveSettings,
  STORAGE_SCHEMA_VERSION,
  type AppSettings,
} from "@/lib/storage/analysisStorage";
import { normalizeComparableText } from "@/lib/utils/normalize";

export interface DashboardFilters {
  readonly query: string;
  readonly center: string;
  readonly group: string;
  readonly status: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  query: "",
  center: "",
  group: "",
  status: "",
};

export interface AiStatus {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly model: string;
}

interface AppStateValue {
  readonly view: AppView;
  readonly pdfFiles: readonly File[];
  readonly registroFile?: File;
  readonly activeAnalysis?: StoredAnalysis;
  readonly result?: AnalysisResult;
  readonly history: readonly StoredAnalysis[];
  readonly settings: AppSettings;
  readonly filters: DashboardFilters;
  readonly status: string;
  readonly error?: string;
  readonly success?: string;
  readonly analyzing: boolean;
  readonly exporting: boolean;
  readonly hydrating: boolean;
  readonly aiStatus?: AiStatus;
  readonly aiTesting: boolean;
  readonly aiTestMessage?: string;
  readonly setView: (view: AppView) => void;
  readonly setPdfFiles: (files: readonly File[]) => void;
  readonly setRegistroFile: (file?: File) => void;
  readonly updateSettings: (settings: Partial<AppSettings>) => void;
  readonly setFilters: (filters: DashboardFilters) => void;
  readonly analyze: () => Promise<void>;
  readonly exportActiveAnalysis: () => Promise<void>;
  readonly exportStoredAnalysis: (analysis: StoredAnalysis) => Promise<void>;
  readonly resetForNewAnalysis: () => void;
  readonly openStoredAnalysis: (id: string) => Promise<void>;
  readonly removeStoredAnalysis: (id: string) => Promise<void>;
  readonly clearStoredHistory: () => Promise<void>;
  readonly refreshAiStatus: () => Promise<void>;
  readonly testAiConnection: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSettingsPatch(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const next = { ...current, ...patch };
  const defaultTolerance = Number.isFinite(Number(next.defaultTolerance)) ? Number(next.defaultTolerance) : DEFAULT_SETTINGS.defaultTolerance;
  const reviewThreshold = Number.isFinite(Number(next.reviewThreshold)) ? Number(next.reviewThreshold) : DEFAULT_SETTINGS.reviewThreshold;
  const incidentThreshold = Number.isFinite(Number(next.incidentThreshold)) ? Number(next.incidentThreshold) : DEFAULT_SETTINGS.incidentThreshold;

  return {
    defaultTolerance: Math.max(0, defaultTolerance),
    enableAIByDefault: next.enableAIByDefault,
    reviewThreshold: Math.max(0, reviewThreshold),
    incidentThreshold: Math.max(Math.max(0, reviewThreshold), incidentThreshold),
    aiModel: next.aiModel || DEFAULT_SETTINGS.aiModel,
    conceptMap: Array.isArray(next.conceptMap) ? next.conceptMap : DEFAULT_SETTINGS.conceptMap,
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildConfig(settings: AppSettings): AnalysisConfig {
  return configFromSettings(settings);
}

async function fetchExport(result: AnalysisResult): Promise<Blob> {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "No se pudo exportar.");
  }

  return response.blob();
}

export function AppStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [view, setView] = useState<AppView>("dashboard");
  const [pdfFiles, setPdfFiles] = useState<readonly File[]>([]);
  const [registroFile, setRegistroFile] = useState<File | undefined>();
  const [activeAnalysis, setActiveAnalysis] = useState<StoredAnalysis | undefined>();
  const [history, setHistory] = useState<readonly StoredAnalysis[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [status, setStatus] = useState("Pendiente de archivos");
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [aiStatus, setAiStatus] = useState<AiStatus | undefined>();
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestMessage, setAiTestMessage] = useState<string | undefined>();

  const refreshHistory = useCallback(async () => {
    setHistory(await listAnalyses());
  }, []);

  const refreshAiStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/status");
      if (response.ok) {
        const payload = (await response.json()) as AiStatus;
        setAiStatus(payload);
        setSettings((current) => normalizeSettingsPatch(current, { aiModel: payload.model }));
      }
    } catch {
      setAiStatus(undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const loadedSettings = loadSettings();
      const activeId = loadActiveAnalysisId();
      const incompatibleCount = await countIncompatibleAnalyses();
      const analyses = await listAnalyses();
      const active = activeId ? (await getAnalysis(activeId)) ?? analyses[0] : analyses[0];

      if (cancelled) {
        return;
      }

      setSettings(loadedSettings);
      setHistory(analyses);
      setActiveAnalysis(active);
      setStatus(active ? "Análisis activo cargado desde el historial" : "Pendiente de archivos");
      setSuccess(
        incompatibleCount
          ? "Se ignoraron análisis guardados con formato anterior. Vuelve a analizar con la nueva lógica retributiva."
          : undefined,
      );
      setHydrating(false);
      void refreshAiStatus();
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [refreshAiStatus]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = normalizeSettingsPatch(current, patch);
      saveSettings(next);
      return next;
    });
  }, []);

  const analyze = useCallback(async () => {
    if (!registroFile || !pdfFiles.length) {
      setError("Selecciona PDFs y Excel Registro antes de analizar.");
      return;
    }

    const config = buildConfig(settings);
    const formData = new FormData();
    formData.append("registro", registroFile);
    formData.append("tolerance", String(config.tolerance));
    formData.append("enableAI", String(config.enableAI));
    formData.append("reviewThreshold", String(config.thresholds.reviewThreshold));
    formData.append("incidentThreshold", String(config.thresholds.incidentThreshold));
    formData.append("conceptMap", JSON.stringify(config.conceptMap ?? []));
    pdfFiles.forEach((file) => formData.append("pdfs", file));

    setAnalyzing(true);
    setError(undefined);
    setSuccess(undefined);
    setStatus("Analizando nóminas...");

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "No se pudo analizar.");
      }

      const result = (await response.json()) as AnalysisResult;
      const record: StoredAnalysis = {
        id: createId(),
        schemaVersion: STORAGE_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        registroFileName: registroFile.name,
        pdfCount: pdfFiles.length,
        result,
        config,
      };

      await saveAnalysis(record);
      saveActiveAnalysisId(record.id);
      setActiveAnalysis(record);
      await refreshHistory();
      setFilters(EMPTY_FILTERS);
      setStatus(`Análisis generado: ${result.summary.uniquePeople} personas`);
      setSuccess("Análisis completado y guardado en el historial.");
      setView("dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
      setStatus("Análisis detenido");
    } finally {
      setAnalyzing(false);
    }
  }, [pdfFiles, refreshHistory, registroFile, settings]);

  const exportAnalysis = useCallback(async (analysis: StoredAnalysis) => {
    setExporting(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      const blob = await fetchExport(analysis.result);
      const date = analysis.createdAt.slice(0, 10);
      downloadBlob(blob, `comparativa_reg_retributivo_${date}.xlsx`);
      setSuccess("Excel exportado correctamente.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setExporting(false);
    }
  }, []);

  const exportActiveAnalysis = useCallback(async () => {
    if (activeAnalysis) {
      await exportAnalysis(activeAnalysis);
    }
  }, [activeAnalysis, exportAnalysis]);

  const resetForNewAnalysis = useCallback(() => {
    setPdfFiles([]);
    setRegistroFile(undefined);
    setActiveAnalysis(undefined);
    saveActiveAnalysisId(undefined);
    setFilters(EMPTY_FILTERS);
    setError(undefined);
    setSuccess(undefined);
    setStatus("Pendiente de archivos");
    setView("dashboard");
  }, []);

  const openStoredAnalysis = useCallback(async (id: string) => {
    const analysis = await getAnalysis(id);
    if (!analysis) {
      setError("No se pudo abrir el análisis guardado.");
      return;
    }

    setActiveAnalysis(analysis);
    saveActiveAnalysisId(id);
    setFilters(EMPTY_FILTERS);
    setStatus("Análisis activo actualizado desde el historial");
    setSuccess("Análisis activo actualizado.");
    setView("dashboard");
  }, []);

  const removeStoredAnalysis = useCallback(
    async (id: string) => {
      await deleteAnalysis(id);
      if (activeAnalysis?.id === id) {
        setActiveAnalysis(undefined);
      }
      await refreshHistory();
      setSuccess("Análisis eliminado del historial.");
    },
    [activeAnalysis?.id, refreshHistory],
  );

  const clearStoredHistory = useCallback(async () => {
    await clearAnalyses();
    setActiveAnalysis(undefined);
    setHistory([]);
    setSuccess("Historial eliminado.");
  }, []);

  const testAiConnection = useCallback(async () => {
    setAiTesting(true);
    setAiTestMessage(undefined);

    try {
      const response = await fetch("/api/ai/test", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string; model?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "No se pudo probar la conexión IA.");
      }

      setAiTestMessage(`Conexión IA correcta con ${payload.model ?? settings.aiModel}.`);
      await refreshAiStatus();
    } catch (caught) {
      setAiTestMessage(caught instanceof Error ? caught.message : "No se pudo probar la conexión IA.");
    } finally {
      setAiTesting(false);
    }
  }, [refreshAiStatus, settings.aiModel]);

  const value = useMemo<AppStateValue>(
    () => ({
      view,
      pdfFiles,
      registroFile,
      activeAnalysis,
      result: activeAnalysis?.result,
      history,
      settings,
      filters,
      status,
      error,
      success,
      analyzing,
      exporting,
      hydrating,
      aiStatus,
      aiTesting,
      aiTestMessage,
      setView,
      setPdfFiles,
      setRegistroFile,
      updateSettings,
      setFilters,
      analyze,
      exportActiveAnalysis,
      exportStoredAnalysis: exportAnalysis,
      resetForNewAnalysis,
      openStoredAnalysis,
      removeStoredAnalysis,
      clearStoredHistory,
      refreshAiStatus,
      testAiConnection,
    }),
    [
      activeAnalysis,
      aiStatus,
      aiTestMessage,
      aiTesting,
      analyze,
      clearStoredHistory,
      error,
      exportActiveAnalysis,
      exportAnalysis,
      exporting,
      filters,
      history,
      hydrating,
      openStoredAnalysis,
      pdfFiles,
      refreshAiStatus,
      registroFile,
      removeStoredAnalysis,
      resetForNewAnalysis,
      settings,
      status,
      success,
      testAiConnection,
      updateSettings,
      view,
      analyzing,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState debe usarse dentro de AppStateProvider.");
  }

  return context;
}

export function matchesQuery(values: readonly (string | undefined)[], query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = normalizeComparableText(query);
  return values.some((value) => normalizeComparableText(value).includes(normalized));
}
