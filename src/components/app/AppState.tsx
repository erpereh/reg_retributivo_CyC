"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ExportWorkbookMetadata } from "@/lib/export/exportExcel";
import type { AnalysisConfig, AnalysisResult, AppView, ConceptMappingRule, StoredAnalysis } from "@/lib/types";
import type { ToastItem, ToastKind } from "@/components/common/ToastViewport";
import {
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
import { normalizeComparableText, normalizeEmployeeId } from "@/lib/utils/normalize";
import { startAnalysisDocumentIngestion } from "@/lib/assistant/documents/ingestionService";
import { createAnalysisCleanupJob, resumeAnalysisCleanupJobs, runAnalysisCleanupBatch, runAnalysisCleanupJob } from "@/lib/assistant/integrations/analysisCleanup";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { CleanupPolicy } from "@/lib/assistant/storage/repositories";
import type { AppNavigationIntent } from "@/lib/assistant/integrations/actions";

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
  readonly toasts: readonly ToastItem[];
  readonly analyzing: boolean;
  readonly exporting: boolean;
  readonly hydrating: boolean;
  readonly aiStatus?: AiStatus;
  readonly aiTesting: boolean;
  readonly aiTestMessage?: string;
  readonly assistantNavigationIntent?: AppNavigationIntent;
  readonly setView: (view: AppView) => void;
  readonly navigateAssistantIntent: (intent: AppNavigationIntent) => void;
  readonly consumeAssistantNavigationIntent: () => void;
  readonly setPdfFiles: (files: readonly File[]) => void;
  readonly setRegistroFile: (file?: File) => void;
  readonly updateSettings: (settings: Partial<AppSettings>) => void;
  readonly setFilters: (filters: DashboardFilters) => void;
  readonly pushToast: (toast: Omit<ToastItem, "id">) => void;
  readonly dismissToast: (id: string) => void;
  readonly analyze: () => Promise<void>;
  readonly saveConceptMapAndRefresh: (conceptMap: readonly ConceptMappingRule[]) => Promise<void>;
  readonly saveExclusionsAndRefresh: (excludedEmployeeIds: readonly string[]) => Promise<void>;
  readonly exportActiveAnalysis: () => Promise<void>;
  readonly exportStoredAnalysis: (analysis: StoredAnalysis) => Promise<void>;
  readonly resetForNewAnalysis: () => void;
  readonly openStoredAnalysis: (id: string) => Promise<void>;
  readonly removeStoredAnalysis: (id: string, policy: CleanupPolicy) => Promise<void>;
  readonly clearStoredHistory: (policy: CleanupPolicy) => Promise<void>;
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
    autoExplainOnOpen: next.autoExplainOnOpen,
    reviewThreshold: Math.max(0, reviewThreshold),
    incidentThreshold: Math.max(Math.max(0, reviewThreshold), incidentThreshold),
    aiModel: next.aiModel || DEFAULT_SETTINGS.aiModel,
    excludedEmployeeIds: Array.isArray(next.excludedEmployeeIds)
      ? [...new Set(next.excludedEmployeeIds.map(normalizeEmployeeId).filter(Boolean))]
      : DEFAULT_SETTINGS.excludedEmployeeIds,
    conceptMap: Array.isArray(next.conceptMap) ? next.conceptMap : DEFAULT_SETTINGS.conceptMap,
    normalizedConcepts: Array.isArray(next.normalizedConcepts) ? next.normalizedConcepts : DEFAULT_SETTINGS.normalizedConcepts,
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

function buildExportMetadata(analysis: StoredAnalysis, settings: AppSettings, exportOrigin: "active" | "history"): ExportWorkbookMetadata {
  return {
    registroFileName: analysis.registroFileName,
    pdfFileCount: analysis.pdfCount,
    exportedAt: new Date().toISOString(),
    aiEnabled: analysis.config.enableAI,
    aiModel: analysis.config.aiModel,
    schemaVersion: analysis.schemaVersion,
    normalizedConcepts: settings.normalizedConcepts,
    exportOrigin,
  };
}

export function AppStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [view, setView] = useState<AppView>("dashboard");
  const [assistantNavigationIntent, setAssistantNavigationIntent] = useState<AppNavigationIntent>();
  const [pdfFiles, setPdfFiles] = useState<readonly File[]>([]);
  const [registroFile, setRegistroFile] = useState<File | undefined>();
  const [activeAnalysis, setActiveAnalysis] = useState<StoredAnalysis | undefined>();
  const [history, setHistory] = useState<readonly StoredAnalysis[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [status, setStatus] = useState("Pendiente de archivos");
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [aiStatus, setAiStatus] = useState<AiStatus | undefined>();
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestMessage, setAiTestMessage] = useState<string | undefined>();

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    setToasts((current) => [...current, { ...toast, id: createId() }].slice(-5));
  }, []);

  const pushMessageToast = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      pushToast({ kind, title, message });
    },
    [pushToast],
  );

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
      try {
        if (typeof indexedDB !== "undefined") {
          let cleanupRepositories: Awaited<ReturnType<typeof createIndexedDbRepositories>> | undefined;
          try {
            cleanupRepositories = await createIndexedDbRepositories();
            await resumeAnalysisCleanupJobs(cleanupRepositories, deleteAnalysis);
          } catch {
            if (!cancelled) setError("No se pudo recuperar parte del contenido local. Puedes volver a intentarlo.");
          } finally {
            cleanupRepositories?.close();
          }
        }
        const loadedSettings = loadSettings();
        const activeId = loadActiveAnalysisId();
        const incompatibleCount = await countIncompatibleAnalyses();
        const analyses = await listAnalyses();
        const active = activeId ? (await getAnalysis(activeId)) ?? analyses[0] : analyses[0];

        if (cancelled) return;
        setSettings(loadedSettings);
        setHistory(analyses);
        setActiveAnalysis(active);
        setStatus(active ? "Análisis activo cargado desde el historial" : "Pendiente de archivos");
        if (incompatibleCount) {
          const message = "Se ignoraron análisis guardados con formato anterior. Vuelve a analizar con la nueva lógica retributiva.";
          setSuccess(message);
          pushMessageToast("warning", "Historial actualizado", message);
        } else {
          setSuccess(undefined);
        }
        void refreshAiStatus();
      } catch {
        if (!cancelled) setError("No se pudo recuperar el contenido local. Puedes volver a intentarlo.");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [pushMessageToast, refreshAiStatus]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = normalizeSettingsPatch(current, patch);
      saveSettings(next);
      return next;
    });
  }, []);

  const runAnalysis = useCallback(async (settingsForAnalysis: AppSettings, options?: { readonly keepView?: boolean; readonly refreshedMap?: boolean; readonly replaceActive?: boolean }) => {
    if (!registroFile || !pdfFiles.length) {
      const message = "Selecciona recibos y Excel Reg. Retrib. antes de analizar.";
      setError(message);
      pushMessageToast("warning", "Faltan archivos", message);
      return;
    }

    const currentView = view;
    const config = buildConfig(settingsForAnalysis);

    setAnalyzing(true);
    setError(undefined);
    setSuccess(undefined);
    setStatus("Analizando nóminas...");

    try {
      const readJson = async <T,>(response: Response): Promise<T> => {
        const text = await response.text();
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : undefined;
        } catch {
          throw new Error(response.status === 413 ? "Los archivos superan el límite de subida. Se procesarán por partes." : `Respuesta no válida del servidor (${response.status}).`);
        }
        if (!response.ok) {
          throw new Error((payload as { error?: string } | undefined)?.error ?? `No se pudo analizar (${response.status}).`);
        }
        return payload as T;
      };

      setStatus("Procesando Excel...");
      const registroForm = new FormData();
      registroForm.append("registro", registroFile);
      const registroResponse = await fetch("/api/analyze/registro", { method: "POST", body: registroForm });
      const registroParsed = await readJson<Record<string, unknown>>(registroResponse);

      const payrollRecords: unknown[] = [];
      const pdfErrors: unknown[] = [];
      for (let index = 0; index < pdfFiles.length; index += 1) {
        const file = pdfFiles[index];
        setStatus(`Procesando recibo ${index + 1} de ${pdfFiles.length}...`);
        const pdfForm = new FormData();
        pdfForm.append("pdf", file);
        const pdfResponse = await fetch("/api/analyze/pdf", { method: "POST", body: pdfForm });
        const parsed = await readJson<{ records: unknown[]; errors: unknown[] }>(pdfResponse);
        payrollRecords.push(...parsed.records);
        pdfErrors.push(...parsed.errors);
      }

      setStatus("Comparando resultados...");
      const finalizeResponse = await fetch("/api/analyze/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registroParsed, payrollRecords, pdfErrors, config }),
      });
      const result = await readJson<AnalysisResult>(finalizeResponse);
      const replaceActive = Boolean(options?.replaceActive && activeAnalysis);
      const record: StoredAnalysis = {
        id: replaceActive ? activeAnalysis!.id : createId(),
        schemaVersion: STORAGE_SCHEMA_VERSION,
        createdAt: replaceActive ? activeAnalysis!.createdAt : new Date().toISOString(),
        registroFileName: registroFile.name,
        pdfCount: pdfFiles.length,
        result,
        config,
      };

      await saveAnalysis(record);
      void startAnalysisDocumentIngestion({ analysisId: record.id, result, registroFile, pdfFiles }).catch(() => undefined);
      saveActiveAnalysisId(record.id);
      setActiveAnalysis(record);
      await refreshHistory();
      setFilters(EMPTY_FILTERS);
      setStatus(`Análisis generado: ${result.summary.uniquePeople} personas`);
      setSuccess(replaceActive ? "Análisis actualizado." : options?.refreshedMap ? "Mapa guardado y análisis actualizado." : "Análisis completado y guardado en el historial.");
      if (replaceActive) {
        pushMessageToast("success", "Análisis actualizado.");
      } else {
        pushMessageToast(
          "success",
          options?.refreshedMap ? "Mapa actualizado" : "Análisis completado",
          options?.refreshedMap ? "Mapa guardado y análisis actualizado." : `${result.summary.uniquePeople} personas generadas y guardadas en historial.`,
        );
      }
      setView(options?.keepView ? currentView : "dashboard");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error inesperado.";
      setError(message);
      pushMessageToast("error", "Error de análisis", message);
      setStatus("Análisis detenido");
    } finally {
      setAnalyzing(false);
    }
  }, [activeAnalysis, pdfFiles, pushMessageToast, refreshHistory, registroFile, view]);

  const analyze = useCallback(async () => {
    await runAnalysis(settings);
  }, [runAnalysis, settings]);

  const saveConceptMapAndRefresh = useCallback(
    async (conceptMap: readonly ConceptMappingRule[]) => {
      const nextSettings = normalizeSettingsPatch(settings, { conceptMap });
      setSettings(nextSettings);
      saveSettings(nextSettings);

      if (!registroFile || !pdfFiles.length) {
        const message = "Mapa guardado. Vuelve a seleccionar archivos para reanalizar.";
        setSuccess(message);
        pushMessageToast("info", "Mapa guardado", message);
        return;
      }

      await runAnalysis(nextSettings, { keepView: true, refreshedMap: true, replaceActive: true });
    },
    [pdfFiles.length, pushMessageToast, registroFile, runAnalysis, settings],
  );

  const saveExclusionsAndRefresh = useCallback(
    async (excludedEmployeeIds: readonly string[]) => {
      const nextSettings = normalizeSettingsPatch(settings, { excludedEmployeeIds });
      setSettings(nextSettings);
      saveSettings(nextSettings);

      if (!registroFile || !pdfFiles.length) {
        const message = "Exclusiones guardadas. Vuelve a seleccionar archivos para reanalizar.";
        setSuccess(message);
        pushMessageToast("info", "Exclusiones guardadas", message);
        return;
      }

      await runAnalysis(nextSettings, { keepView: true, replaceActive: true });
    },
    [pdfFiles.length, pushMessageToast, registroFile, runAnalysis, settings],
  );

  const exportAnalysis = useCallback(async (analysis: StoredAnalysis, exportOrigin: "active" | "history") => {
    setExporting(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysis: analysis.result, metadata: buildExportMetadata(analysis, settings, exportOrigin) }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "No se pudo exportar.");
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "registro-retributivo.xlsx";
      downloadBlob(await response.blob(), filename);
      setSuccess("Exportación descargada.");
      pushMessageToast("success", "Exportación lista", "Se ha descargado el Excel del análisis.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error inesperado.";
      setError(message);
      pushMessageToast("error", "Error de exportación", message);
    } finally {
      setExporting(false);
    }
  }, [pushMessageToast, settings]);

  const exportActiveAnalysis = useCallback(async () => {
    if (!activeAnalysis) {
      const message = "No hay un análisis activo para exportar.";
      setError(message);
      pushMessageToast("warning", "Sin análisis", message);
      return;
    }
    await exportAnalysis(activeAnalysis, "active");
  }, [activeAnalysis, exportAnalysis, pushMessageToast]);

  const exportStoredAnalysis = useCallback(async (analysis: StoredAnalysis) => {
    await exportAnalysis(analysis, "history");
  }, [exportAnalysis]);

  const resetForNewAnalysis = useCallback(() => {
    setPdfFiles([]);
    setRegistroFile(undefined);
    setError(undefined);
    setSuccess(undefined);
    setStatus("Pendiente de archivos");
    setView("upload");
  }, []);

  const openStoredAnalysis = useCallback(async (id: string) => {
    const analysis = await getAnalysis(id);
    if (!analysis) {
      const message = "No se encontró el análisis seleccionado.";
      setError(message);
      pushMessageToast("error", "Análisis no disponible", message);
      return;
    }
    saveActiveAnalysisId(id);
    setActiveAnalysis(analysis);
    setStatus("Análisis cargado desde historial");
    setView("dashboard");
  }, [pushMessageToast]);

  const removeStoredAnalysis = useCallback(async (id: string, policy: CleanupPolicy) => {
    const repositories = await createIndexedDbRepositories();
    try {
      const job = await createAnalysisCleanupJob(repositories, id, policy);
      if (policy === "delete_conversations") await runAnalysisCleanupJob(repositories, job.id, deleteAnalysis);
      else await runAnalysisCleanupBatch(repositories, job.id);
      await refreshHistory();
      if (activeAnalysis?.id === id) {
        const nextHistory = await listAnalyses();
        const nextActive = nextHistory[0];
        saveActiveAnalysisId(nextActive?.id);
        setActiveAnalysis(nextActive);
      }
      pushMessageToast("success", "Análisis eliminado");
    } finally {
      repositories.close();
    }
  }, [activeAnalysis?.id, pushMessageToast, refreshHistory]);

  const clearStoredHistory = useCallback(async (policy: CleanupPolicy) => {
    for (const analysis of await listAnalyses()) {
      await removeStoredAnalysis(analysis.id, policy);
    }
  }, [removeStoredAnalysis]);

  const testAiConnection = useCallback(async () => {
    setAiTesting(true);
    setAiTestMessage(undefined);
    try {
      const response = await fetch("/api/ai/test", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string; model?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No se pudo comprobar la conexión IA.");
      setAiTestMessage(`Conexión correcta con ${payload.model ?? "Gemini"}.`);
    } catch (caught) {
      setAiTestMessage(caught instanceof Error ? caught.message : "No se pudo comprobar la conexión IA.");
    } finally {
      setAiTesting(false);
    }
  }, []);

  const navigateAssistantIntent = useCallback((intent: AppNavigationIntent) => {
    setAssistantNavigationIntent(intent);
    setView(intent.view);
    if (intent.view === "people") {
      setFilters({ ...EMPTY_FILTERS, query: intent.employeeNumber ?? intent.personName ?? "" });
    } else if (intent.view === "concepts") {
      setFilters({ ...EMPTY_FILTERS, query: intent.conceptCode ?? intent.conceptName ?? "" });
    }
  }, []);

  const consumeAssistantNavigationIntent = useCallback(() => setAssistantNavigationIntent(undefined), []);

  const value = useMemo<AppStateValue>(() => ({
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
    toasts,
    analyzing,
    exporting,
    hydrating,
    aiStatus,
    aiTesting,
    aiTestMessage,
    assistantNavigationIntent,
    setView,
    navigateAssistantIntent,
    consumeAssistantNavigationIntent,
    setPdfFiles,
    setRegistroFile,
    updateSettings,
    setFilters,
    pushToast,
    dismissToast,
    analyze,
    saveConceptMapAndRefresh,
    saveExclusionsAndRefresh,
    exportActiveAnalysis,
    exportStoredAnalysis,
    resetForNewAnalysis,
    openStoredAnalysis,
    removeStoredAnalysis,
    clearStoredHistory,
    refreshAiStatus,
    testAiConnection,
  }), [activeAnalysis, aiStatus, aiTestMessage, aiTesting, analyze, analyzing, assistantNavigationIntent, clearStoredHistory, consumeAssistantNavigationIntent, error, exportActiveAnalysis, exportStoredAnalysis, exporting, filters, history, hydrating, navigateAssistantIntent, openStoredAnalysis, pdfFiles, pushToast, registroFile, removeStoredAnalysis, resetForNewAnalysis, saveConceptMapAndRefresh, saveExclusionsAndRefresh, settings, status, success, testAiConnection, toasts, updateSettings, view, refreshAiStatus]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used inside AppStateProvider");
  return context;
}

export function matchesQuery(values: readonly (string | undefined)[], query: string): boolean {
  if (!query) return true;
  const normalized = normalizeComparableText(query);
  return values.some((value) => normalizeComparableText(value).includes(normalized));
}
