"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  resolveChatContent, type AssistantSettings, type ChatAction, type ChatEvent, type ChatMessage,
  type ContextStrategy, type Conversation, type ModelPreferences, type PersistedDocumentMetadata, type ResponseMode, type SourceReference,
} from "@/lib/assistant/domain";
import { applyCompleteCatalogRefresh, catalogKey, providerRuntimeDescriptor, type ModelCatalogEntry, type ProviderConfig } from "@/lib/assistant/catalog/domain";
import { generalModelCompatibility, modelCompatibility } from "@/lib/assistant/catalog/compatibility";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import { GENERAL_RETRIBUTIVO_PROMPT, type FakeAssistantAdapter } from "@/lib/assistant/providers/fakeAdapter";
import { DEFAULT_ASSISTANT_SETTINGS, assistantSettingsSchema } from "@/lib/assistant/schemas";
import { localIterableResponse } from "@/lib/assistant/providers/localNdjsonTransport";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories, AssistantStoredRecord, ContextSnapshot } from "@/lib/assistant/storage/repositories";
import { executeAssistantToolRequest } from "@/lib/assistant/tools/personTools";
import type { StoredAnalysis } from "@/lib/types";
import { continuePersonInAssistant as continuePerson } from "@/lib/assistant/integrations/personIntegration";
import { createAnalysisVersionSnapshot, syncAnalysisVersion } from "@/lib/assistant/integrations/analysisVersion";
import { executeChatAction, rejectChatAction, type AppNavigationIntent } from "@/lib/assistant/integrations/actions";
import { registerAnalysisCleanupListener } from "@/lib/assistant/integrations/analysisCleanupCoordinator";
import { AssistantRunStoppedError, createRepositoryBoundAssistantOrchestrator, type AssistantOrchestrator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { ANALYSIS_TOOL_NAMES, createAnalysisToolRegistry, type AnalysisToolName, type AnalysisToolRegistry } from "@/lib/assistant/tools/registry";
import { createScopeSnapshot, type ScopeSnapshot } from "@/lib/assistant/execution/scopeSnapshot";

const TEST_MODEL_ID = "injected-test-model";
const TEST_SYSTEM_PROMPT = GENERAL_RETRIBUTIVO_PROMPT;
const CONVERSATION_PAGE_SIZE = 10;
const MESSAGE_PAGE_SIZE = 40;
const STREAM_BATCH_MS = 160;
const now = () => new Date().toISOString();
const createId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const withoutUndefined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const newestConversations = (items: readonly Conversation[]) => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));

function asModelPreferences(value: AssistantStoredRecord | undefined): ModelPreferences | undefined {
  if (!value || value.id !== "model-preferences" || !Array.isArray(value.favoriteCatalogEntryIds) || !value.favoriteCatalogEntryIds.every((id) => typeof id === "string")
    || !Array.isArray(value.recentCatalogEntryIds) || !value.recentCatalogEntryIds.every((id) => typeof id === "string") || typeof value.updatedAt !== "string") return undefined;
  if (value.lastCatalogEntryId !== undefined && typeof value.lastCatalogEntryId !== "string") return undefined;
  return value as unknown as ModelPreferences;
}

function isAnalysisEvent(event: ChatEvent): boolean {
  return ["context_added", "context_removed", "person_added", "person_removed", "analysis_updated", "indexing_completed"].includes(event.event.type);
}

function isAnalysisAction(action: ChatAction): boolean {
  return "analysisId" in action.action;
}

export interface AssistantContextValue {
  ready: boolean;
  conversations: Conversation[];
  hasMoreConversations: boolean;
  conversation?: Conversation;
  messages: ChatMessage[];
  repeatableMessageIds: readonly string[];
  hasMoreMessages: boolean;
  sources: SourceReference[];
  revealedSourceIds: readonly string[];
  events: ChatEvent[];
  actions: ChatAction[];
  actionOutputs: Readonly<Record<string, unknown>>;
  resolvingActionIds: readonly string[];
  snapshots: ContextSnapshot[];
  documents: PersistedDocumentMetadata[];
  indexJobs: AssistantStoredRecord[];
  streaming: boolean;
  selectionLoading: boolean;
  conversationTransitionPending: boolean;
  announcement: string;
  notice?: string;
  error?: string;
  createGeneralConversation(): Promise<void>;
  loadMoreConversations(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  renameConversation(title: string): Promise<void>;
  archiveConversation(): Promise<void>;
  deleteConversation(): Promise<void>;
  loadMoreMessages(): Promise<void>;
  send(rawText: string): Promise<void>;
  stop(): void;
  retryResponse(messageId: string): Promise<void>;
  regenerateResponse(messageId: string): Promise<void>;
  copyResponse(messageId: string): Promise<void>;
  acceptAction(actionId: string): Promise<void>;
  rejectAction(actionId: string): Promise<void>;
  convertToActiveAnalysis(): Promise<void>;
  associatePerson(personId: string): Promise<void>;
  continuePersonInAssistant(personId: string): Promise<void>;
  addPerson(personId: string): Promise<void>;
  removePerson(personId: string): Promise<void>;
  setPrimaryPerson(personId: string): Promise<void>;
  requestPersonProfile(): Promise<void>;
  openModelSettings(): void;
  updateConversationPreferences(patch: { responseMode?: ResponseMode; contextStrategy?: ContextStrategy }): Promise<void>;
  selectConversationModel(providerId: string, modelId: string): Promise<void>;
  availablePersonIds: string[];
  people: readonly { employeeNumber: string; person?: string; workplace?: string; position?: string; category?: string; status?: string; periods?: readonly string[] }[];
  canSend: boolean;
  providerConfigs: ProviderConfig[];
  modelCatalog: ModelCatalogEntry[];
  modelPreferences: ModelPreferences;
  checkingCompatibilityEntryIds: readonly string[];
  activeAnalysisSummary?: { registroFileName: string; pdfCount: number; uniquePeople: number; periods: readonly string[] };
  saveProviderConfig(config: ProviderConfig): Promise<void>;
  deleteProviderConfig(providerId: string): Promise<void>;
  checkProvider(providerId: string): Promise<void>;
  refreshProviderCatalog(providerId: string): Promise<void>;
  checkModelCompatibility(entry: ModelCatalogEntry): Promise<void>;
  toggleModelFavorite(entryId: string): Promise<void>;
  assistantSettings: AssistantSettings;
  updateAssistantSettings(patch: Partial<Omit<AssistantSettings, "id">>): Promise<void>;
  clearAssistantContent(): Promise<void>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

interface AssistantAdapter {
  streamGeneral(request: Parameters<FakeAssistantAdapter["streamGeneral"]>[0]): AsyncIterable<Uint8Array>;
  streamPersonProfile(request: Parameters<FakeAssistantAdapter["streamPersonProfile"]>[0]): AsyncIterable<Uint8Array>;
}
type PendingFakeRequest = { readonly kind: "general"; readonly request: Parameters<AssistantAdapter["streamGeneral"]>[0] } | { readonly kind: "profile"; readonly request: Parameters<AssistantAdapter["streamPersonProfile"]>[0] };
interface RunToken { readonly conversationId: string; readonly generation: number }
interface SelectionIntent { readonly sequence: number }

export function AssistantProvider({ children, activeAnalysis, factory, dbName, adapter, repositoriesFactory, onNavigate }: Readonly<{
  children: ReactNode; activeAnalysis?: StoredAnalysis; factory?: IDBFactory; dbName?: string; adapter?: AssistantAdapter;
  repositoriesFactory?: () => Promise<AssistantRepositories>;
  onNavigate?: (intent: AppNavigationIntent) => void;
}>) {
  const repositoriesRef = useRef<AssistantRepositories | undefined>(undefined);
  const orchestratorRef = useRef<AssistantOrchestrator | undefined>(undefined);
  const adapterRef = useRef<AssistantAdapter | undefined>(adapter);
  const pendingFakeRequestRef = useRef<PendingFakeRequest | undefined>(undefined);
  const repeatableRunsRef = useRef(new Map<string, PendingFakeRequest>());
  const assistantSettingsRef = useRef<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);
  const activeAnalysisRef = useRef(activeAnalysis);
  const configurationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const conversationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const selectedConversationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const selectionIntentSequenceRef = useRef(0);
  const selectionIntentRef = useRef<SelectionIntent | undefined>(undefined);
  const createInFlightRef = useRef<SelectionIntent | undefined>(undefined);
  const contextAdditionInFlightRef = useRef(false);
  const contentGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const conversationPageGenerationRef = useRef(0);
  const conversationPageLoadingRef = useRef(false);
  const runGenerationsRef = useRef(new Map<string, number>());
  const deletedConversationsRef = useRef(new Set<string>());
  const activeRunTokenRef = useRef<RunToken | undefined>(undefined);
  const activeScopeSnapshotRef = useRef<ScopeSnapshot | undefined>(undefined);
  const conversationRef = useRef<Conversation | undefined>(undefined);
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const currentAnalysisVersionRef = useRef<{ analysisId: string; analysisVersion: string } | undefined>(undefined);
  const resolvingActionIdsRef = useRef(new Set<string>());
  const compatibilityControllersRef = useRef(new Map<string, AbortController>());
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string>();
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string>();
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [revealedSourceIds, setRevealedSourceIds] = useState<string[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [actions, setActions] = useState<ChatAction[]>([]);
  const [actionOutputs, setActionOutputs] = useState<Record<string, unknown>>({});
  const [resolvingActionIds, setResolvingActionIds] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<ContextSnapshot[]>([]);
  const [documents, setDocuments] = useState<PersistedDocumentMetadata[]>([]);
  const [indexJobs, setIndexJobs] = useState<AssistantStoredRecord[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [conversationTransitionPending, setConversationTransitionPending] = useState(false);
  const [, setConversationPageLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("Asistente preparado");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  const [modelPreferences, setModelPreferences] = useState<ModelPreferences>({ id: "model-preferences", favoriteCatalogEntryIds: [], recentCatalogEntryIds: [], updatedAt: now() });
  const [checkingCompatibilityEntryIds, setCheckingCompatibilityEntryIds] = useState<string[]>([]);
  const registeredProviderIdsRef = useRef(new Set<string>());

  useEffect(() => { activeAnalysisRef.current = activeAnalysis; }, [activeAnalysis]);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const repositories = repositoriesRef.current;
    if (!ready || !repositories || !activeAnalysis) return;
    let cancelled = false;
    const operation = conversationMutationRef.current.then(() => syncAnalysisVersion(repositories, activeAnalysis.id, activeAnalysis, now()));
    conversationMutationRef.current = operation.then(() => undefined, () => undefined);
    void operation.then(({ snapshot, changed }) => {
      if (cancelled) return;
      currentAnalysisVersionRef.current = { analysisId: activeAnalysis.id, analysisVersion: snapshot.analysisVersion };
      if (!changed) return;
      setConversations((current) => current.map((item) => item.analysisId === activeAnalysis.id && item.status === "active" ? { ...item, analysisVersion: snapshot.analysisVersion } : item));
      if (conversationRef.current?.analysisId === activeAnalysis.id && conversationRef.current.status === "active") {
        const updated = { ...conversationRef.current, analysisVersion: snapshot.analysisVersion };
        conversationRef.current = updated;
        setConversation(updated);
        setNotice("El análisis ha cambiado. Los mensajes anteriores conservan su versión original.");
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeAnalysis, ready]);

  const ensureActiveAnalysisVersion = useCallback(async (): Promise<string | undefined> => {
    if (!activeAnalysis) return undefined;
    try {
      const snapshot = await createAnalysisVersionSnapshot(activeAnalysis.id, activeAnalysis, now());
      const repositories = repositoriesRef.current;
      if (!repositories) return undefined;
      await repositories.syncAnalysisVersion({ snapshot, analysisId: activeAnalysis.id, updatedAt: now() });
      currentAnalysisVersionRef.current = { analysisId: activeAnalysis.id, analysisVersion: snapshot.analysisVersion };
      return snapshot.analysisVersion;
    } catch {
      return undefined;
    }
  }, [activeAnalysis]);

  const clearSelected = useCallback(() => {
    selectionIntentRef.current = undefined;
    createInFlightRef.current = undefined;
    contextAdditionInFlightRef.current = false;
    loadGenerationRef.current += 1; conversationRef.current = undefined; messagesRef.current = [];
    setConversation(undefined); setMessages([]); setMessageCursor(undefined); setSources([]); setRevealedSourceIds([]); setEvents([]); setActions([]); setActionOutputs({}); setSnapshots([]); setDocuments([]); setIndexJobs([]); setSelectionLoading(false); setConversationTransitionPending(false);
  }, []);

  const removeCachedConversation = useCallback((conversationId: string) => {
    const remaining = conversationsRef.current.filter((item) => item.id !== conversationId);
    conversationsRef.current = remaining;
    setConversations(remaining);
    deletedConversationsRef.current.add(conversationId);
    return remaining;
  }, []);

  const loadConversationData = useCallback(async (requested: Conversation, requestedIntent?: SelectionIntent) => {
    const selectionIntent = requestedIntent ?? { sequence: ++selectionIntentSequenceRef.current };
    if (!requestedIntent) selectionIntentRef.current = selectionIntent;
    const repositories = repositoriesRef.current;
    if (!repositories) {
      if (selectionIntentRef.current === selectionIntent) setSelectionLoading(false);
      return;
    }
    const contentGeneration = contentGenerationRef.current;
    const generation = ++loadGenerationRef.current;
    setSelectionLoading(true);
    try {
      let selected = await repositories.conversations.get(requested.id);
      if (!selected) {
        removeCachedConversation(requested.id);
        if (conversationRef.current?.id === requested.id) clearSelected();
        if (mountedRef.current && selectionIntentRef.current === selectionIntent) setError("La conversación ya no está disponible.");
        return;
      }
      deletedConversationsRef.current.delete(selected.id);
      const [messagePage, selectedEvents, selectedActions, selectedSnapshots, allDocuments, allIndexJobs] = await Promise.all([
        repositories.messages.listByConversation(selected.id, { limit: MESSAGE_PAGE_SIZE }),
        repositories.events.listByConversation(selected.id),
        repositories.actions.listByConversation(selected.id),
        repositories.snapshots.listByConversation(selected.id),
        repositories.documents.listAll(),
        repositories.indexJobs.listAll(),
      ]);
      const confirmed = await repositories.conversations.get(selected.id);
      if (!confirmed) {
        removeCachedConversation(selected.id);
        if (conversationRef.current?.id === selected.id) clearSelected();
        if (mountedRef.current && selectionIntentRef.current === selectionIntent) setError("La conversación ya no está disponible.");
        return;
      }
      selected = confirmed;
      const selectedDocuments = allDocuments.filter((document) => document.scope.type === "conversation" ? document.scope.conversationId === selected.id : selected.type === "analysis" && document.scope.analysisId === selected.analysisId);
      const selectedDocumentIds = new Set(selectedDocuments.map((document) => document.id));
      const selectedSources = await Promise.all([...new Set(messagePage.items.flatMap((item) => item.sourceRefIds))].map((id) => repositories.sources.get(id)));
      if (!mountedRef.current || selectionIntentRef.current !== selectionIntent || contentGeneration !== contentGenerationRef.current || generation !== loadGenerationRef.current || deletedConversationsRef.current.has(selected.id)) return;
      const nextConversations = newestConversations(conversationsRef.current.some((item) => item.id === selected.id)
        ? conversationsRef.current.map((item) => item.id === selected.id ? selected : item)
        : [...conversationsRef.current, selected]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      conversationRef.current = selected;
      messagesRef.current = messagePage.items;
      setConversation(selected);
      setMessages(messagePage.items);
      setMessageCursor(messagePage.nextCursor);
      setSources(selectedSources.filter((item): item is SourceReference => Boolean(item)));
      setRevealedSourceIds([]);
      setEvents(selected.type === "analysis" ? selectedEvents : selectedEvents.filter((event) => !isAnalysisEvent(event)));
      setActions(selected.type === "analysis" ? selectedActions : selectedActions.filter((action) => !isAnalysisAction(action)));
      setActionOutputs({});
      setSnapshots(selected.type === "analysis" ? selectedSnapshots.filter((snapshot) => !snapshot.analysisId || snapshot.analysisId === selected.analysisId) : selectedSnapshots.filter((snapshot) => !snapshot.analysisId));
      setDocuments(selectedDocuments);
      setIndexJobs(allIndexJobs.filter((job) => typeof job.documentId === "string" && selectedDocumentIds.has(job.documentId)));
      setNotice(undefined);
      setAnnouncement("Asistente preparado");
      setError(undefined);
    } catch {
      if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current && generation === loadGenerationRef.current) setError("No se pudo cargar la conversación. Puedes volver a intentarlo.");
    } finally {
      if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current && generation === loadGenerationRef.current) setSelectionLoading(false);
    }
  }, [clearSelected, removeCachedConversation]);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    void (async () => {
      let repositories: AssistantRepositories | undefined;
      try {
        repositories = repositoriesFactory ? await repositoriesFactory() : await createIndexedDbRepositories({ factory, dbName });
        if (cancelled) { repositories.close(); return; }
        repositoriesRef.current = repositories;
        let cachedAnalysisRegistry: Readonly<{
          conversation: Conversation;
          analysis: StoredAnalysis;
          scopeSnapshot: typeof activeScopeSnapshotRef.current;
          registry: AnalysisToolRegistry;
        }> | undefined;
        const currentAnalysisRegistry = () => {
          const currentConversation = conversationRef.current;
          const currentAnalysis = activeAnalysisRef.current;
          if (!currentConversation || currentConversation.type !== "analysis" || !currentConversation.analysisId || !currentAnalysis || currentAnalysis.id !== currentConversation.analysisId) throw new ProviderAdapterError("incompatible", "analysis_tools_unavailable");
          const scopeSnapshot = activeScopeSnapshotRef.current;
          if (cachedAnalysisRegistry?.conversation === currentConversation && cachedAnalysisRegistry.analysis === currentAnalysis && cachedAnalysisRegistry.scopeSnapshot === scopeSnapshot) return cachedAnalysisRegistry.registry;
          const registry = createAnalysisToolRegistry({ conversation: currentConversation, analysis: currentAnalysis, chunks: [], searchDocuments: async ({ analysisId, query, limit }) => repositories!.buildSearchIndex({ type: "analysis", analysisId }).then((index) => index.search({ scope: { type: "analysis", analysisId }, query, limit })), ...(scopeSnapshot ? { scopeSnapshot } : {}) });
          cachedAnalysisRegistry = { conversation: currentConversation, analysis: currentAnalysis, scopeSnapshot, registry };
          return registry;
        };
        const registry = {
          get names() { const current = conversationRef.current; const analysis = activeAnalysisRef.current; return !adapterRef.current && current?.type === "analysis" && current.analysisId === analysis?.id ? ANALYSIS_TOOL_NAMES : []; },
          get privacyBlockedTerms() { const current = conversationRef.current; const analysis = activeAnalysisRef.current; return !adapterRef.current && current?.type === "analysis" && current.analysisId === analysis?.id ? currentAnalysisRegistry().privacyBlockedTerms ?? [] : []; },
          execute(name: AnalysisToolName, args: unknown) { return currentAnalysisRegistry().execute(name, args); },
          executeEnvelope(name: AnalysisToolName, args: unknown, requestId?: string) { return currentAnalysisRegistry().executeEnvelope!(name, args, requestId); },
          assertSafeOutput(value: unknown) { const current = conversationRef.current; const analysis = activeAnalysisRef.current; if (!adapterRef.current && current?.type === "analysis" && current.analysisId === analysis?.id) currentAnalysisRegistry().assertSafeOutput?.(value); },
        } as unknown as AnalysisToolRegistry;
        orchestratorRef.current = createRepositoryBoundAssistantOrchestrator({
          transport: async (body, signal) => {
            if (!adapterRef.current) {
              return fetch("/api/assistant/chat", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify(withoutUndefined(body)), signal,
              });
            }
            const pending = pendingFakeRequestRef.current;
            if (!pending) throw new Error("No hay una solicitud local preparada.");
            const stream = pending.kind === "general" ? adapterRef.current.streamGeneral(pending.request) : adapterRef.current.streamPersonProfile(pending.request);
            return localIterableResponse(stream, String(body.roundId), signal);
          },
          registry,
        }, repositories);
        const [storedProviders, storedCatalog, storedPreferences, storedSettings, conversationPage] = await Promise.all([
          repositories.providerConfigs.listAll(),
          repositories.modelCatalog.listAll(),
          repositories.modelPreferences.get("model-preferences").catch(() => undefined),
          repositories.assistantSettings.get(DEFAULT_ASSISTANT_SETTINGS.id),
          repositories.conversations.list({ limit: CONVERSATION_PAGE_SIZE }),
        ]);
        const parsedSettings = assistantSettingsSchema.safeParse({ ...DEFAULT_ASSISTANT_SETTINGS, ...storedSettings });
        const repairedSettings = parsedSettings.success ? parsedSettings.data : DEFAULT_ASSISTANT_SETTINGS;
        const restoredConversations = await Promise.all(conversationPage.items.map(async (item) => item.status === "archived"
          ? (await repositories!.updateActiveConversation(item.id, { status: "active" }, now())) ?? { ...item, status: "active" as const }
          : item));
        if (cancelled) return;
        assistantSettingsRef.current = repairedSettings;
        setProviderConfigs(storedProviders);
        setModelCatalog(storedCatalog);
        const repairedPreferences = asModelPreferences(storedPreferences);
        if (repairedPreferences) setModelPreferences(repairedPreferences);
        setAssistantSettings(repairedSettings);
        setConversations(restoredConversations);
        setConversationCursor(conversationPage.nextCursor);
        if (conversationPage.items[0]) await loadConversationData(conversationPage.items[0]);
        if (!cancelled) setReady(true);
      } catch {
        repositories?.close();
        if (!cancelled) setError("No se pudo abrir el almacenamiento local del Asistente.");
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      orchestratorRef.current?.stop();
      orchestratorRef.current = undefined;
      for (const controller of compatibilityControllersRef.current.values()) controller.abort();
      compatibilityControllersRef.current.clear();
      repositoriesRef.current?.close();
      repositoriesRef.current = undefined;
    };
  }, [adapter, dbName, factory, loadConversationData, repositoriesFactory]);

  const serializeConfigurationMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = configurationMutationRef.current.then(operation);
    configurationMutationRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const providerOperation = useCallback(async (body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const response = await fetch("/api/assistant/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.code === "string" ? payload.code : "provider_error");
    return payload;
  }, []);

  const saveProviderConfig = useCallback((config: ProviderConfig) => serializeConfigurationMutation(async () => {
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("storage_unavailable");
    const result = await providerOperation({ operation: "register", config });
    const status = result.keyStatus === "configured" ? (config.enabled ? "active" : "inactive") : result.keyStatus === "not_configured" ? "missing_key" : "error";
    const saved = { ...config, connectionStatus: status, updatedAt: now() } as ProviderConfig;
    await repositories.providerConfigs.put(saved);
    setProviderConfigs((items) => [...items.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }), [providerOperation, serializeConfigurationMutation]);

  const checkProvider = useCallback(async (providerId: string) => {
    const config = providerConfigs.find((item) => item.id === providerId);
    const repositories = repositoriesRef.current;
    if (!config || !repositories) return;
    const result = await providerOperation({ operation: "status", provider: providerRuntimeDescriptor(config) });
    const checked = { ...config, connectionStatus: result.keyStatus === "configured" ? "connected" : result.keyStatus === "not_configured" ? "missing_key" : "error", lastCheckedAt: now(), updatedAt: now() } as ProviderConfig;
    await repositories.providerConfigs.put(checked);
    setProviderConfigs((items) => items.map((item) => item.id === providerId ? checked : item));
  }, [providerConfigs, providerOperation]);

  const refreshProviderCatalog = useCallback(async (providerId: string) => {
    const config = providerConfigs.find((item) => item.id === providerId);
    const repositories = repositoriesRef.current;
    if (!config || !repositories) return;
    try {
      await providerOperation({ operation: "register", config });
      const payload = await providerOperation({ operation: "catalog", provider: providerRuntimeDescriptor(config) });
      const completion = payload.completion;
      const entries = Array.isArray(payload.models) ? payload.models as ModelCatalogEntry[] : [];
      if (completion !== "complete" && completion !== "valid_empty") throw new Error("catalog_refresh_incomplete");
      const previous = modelCatalog.filter((entry) => entry.providerId === providerId);
      const nextProvider = applyCompleteCatalogRefresh(previous, entries, { completion });
      await repositories.replaceProviderCatalog(providerId, nextProvider);
      const refreshed = { ...config, lastCatalogRefreshAt: now(), lastCatalogErrorCode: undefined, updatedAt: now() } as ProviderConfig;
      await repositories.providerConfigs.put(withoutUndefined(refreshed));
      setModelCatalog((items) => [...items.filter((entry) => entry.providerId !== providerId), ...nextProvider]);
      setProviderConfigs((items) => items.map((item) => item.id === providerId ? refreshed : item));
    } catch {
      const failed = { ...config, lastCatalogErrorCode: "catalog_refresh_failed", updatedAt: now() } as ProviderConfig;
      await repositories.providerConfigs.put(failed);
      setProviderConfigs((items) => items.map((item) => item.id === providerId ? failed : item));
      throw new Error("catalog_refresh_failed");
    }
  }, [modelCatalog, providerConfigs, providerOperation]);

  const deleteProviderConfig = useCallback((providerId: string) => serializeConfigurationMutation(async () => {
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    for (const entry of modelCatalog.filter((item) => item.providerId === providerId)) {
      compatibilityControllersRef.current.get(entry.id)?.abort();
      compatibilityControllersRef.current.delete(entry.id);
    }
    setCheckingCompatibilityEntryIds((items) => items.filter((id) => !modelCatalog.some((entry) => entry.id === id && entry.providerId === providerId)));
    await repositories.deleteProviderConfiguration(providerId);
    setProviderConfigs((items) => items.filter((item) => item.id !== providerId));
    setModelCatalog((items) => items.filter((item) => item.providerId !== providerId));
  }), [modelCatalog, serializeConfigurationMutation]);

  const checkModelCompatibility = useCallback(async (entry: ModelCatalogEntry) => {
    const repositories = repositoriesRef.current;
    const config = providerConfigs.find((item) => item.id === entry.providerId && item.enabled);
    if (!repositories || !config || compatibilityControllersRef.current.has(entry.id)) return;
    const controller = new AbortController();
    compatibilityControllersRef.current.set(entry.id, controller);
    setCheckingCompatibilityEntryIds((items) => [...new Set([...items, entry.id])]);
    setError(undefined);
    try {
      const result = await providerOperation({ operation: "compatibility", provider: providerRuntimeDescriptor(config), modelId: entry.apiModelId }, controller.signal);
      const checked: ModelCatalogEntry = { ...entry, capabilities: { ...entry.capabilities, chat: Boolean(result.connection), streaming: Boolean(result.streaming), tools: Boolean(result.tools) }, metadataSource: "verified", compatibilityCheckedAt: now() };
      await repositories.modelCatalog.put(checked);
      setModelCatalog((items) => items.map((item) => item.id === checked.id ? checked : item));
    } catch {
      if (!controller.signal.aborted) setError("No se pudo comprobar la compatibilidad del modelo. Puedes volver a intentarlo.");
    } finally {
      if (compatibilityControllersRef.current.get(entry.id) === controller) compatibilityControllersRef.current.delete(entry.id);
      if (mountedRef.current) setCheckingCompatibilityEntryIds((items) => items.filter((id) => id !== entry.id));
    }
  }, [providerConfigs, providerOperation]);

  const persistModelPreferences = useCallback(async (next: ModelPreferences) => {
    await repositoriesRef.current?.saveModelPreferences(next);
    setModelPreferences(next);
  }, []);

  const toggleModelFavorite = useCallback(async (entryId: string) => {
    const favorites = new Set(modelPreferences.favoriteCatalogEntryIds);
    if (favorites.has(entryId)) favorites.delete(entryId); else favorites.add(entryId);
    await persistModelPreferences({ ...modelPreferences, favoriteCatalogEntryIds: [...favorites], updatedAt: now() });
  }, [modelPreferences, persistModelPreferences]);

  useEffect(() => {
    if (!ready) return;
    for (const config of providerConfigs) {
      if (registeredProviderIdsRef.current.has(config.id)) continue;
      registeredProviderIdsRef.current.add(config.id);
      void providerOperation({ operation: "register", config }).then(() => {
        const last = config.lastCatalogRefreshAt ? Date.parse(config.lastCatalogRefreshAt) : 0;
        if (config.enabled && Date.now() - last >= 24 * 60 * 60_000) return refreshProviderCatalog(config.id);
      }).catch(() => undefined);
    }
  }, [providerConfigs, providerOperation, ready, refreshProviderCatalog]);

  const invalidateConversationRun = useCallback((conversationId: string) => {
    const activeToken = activeRunTokenRef.current;
    runGenerationsRef.current.set(conversationId, (runGenerationsRef.current.get(conversationId) ?? 0) + 1);
    if (activeToken?.conversationId === conversationId && activeRunTokenRef.current === activeToken) {
      orchestratorRef.current?.stop();
      if (activeRunTokenRef.current === activeToken) activeRunTokenRef.current = undefined;
    }
  }, []);

  const beginConversationRun = useCallback((conversationId: string) => {
    const generation = (runGenerationsRef.current.get(conversationId) ?? 0) + 1;
    runGenerationsRef.current.set(conversationId, generation);
    const token = { conversationId, generation };
    activeRunTokenRef.current = token;
    return token;
  }, []);

  const isConversationRunCurrent = useCallback((token: RunToken) => (
    mountedRef.current && activeRunTokenRef.current === token && !deletedConversationsRef.current.has(token.conversationId)
    && runGenerationsRef.current.get(token.conversationId) === token.generation
    && conversationRef.current?.id === token.conversationId
  ), []);

  const updateAssistantSettings = useCallback((patch: Partial<Omit<AssistantSettings, "id">>) => serializeConfigurationMutation(async () => {
    const parsed = assistantSettingsSchema.parse({ ...assistantSettingsRef.current, ...patch, id: DEFAULT_ASSISTANT_SETTINGS.id });
    const next = parsed;
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    await repositories.assistantSettings.put(withoutUndefined(next));
    assistantSettingsRef.current = next; if (mountedRef.current) setAssistantSettings(next);
  }), [serializeConfigurationMutation]);

  useEffect(() => registerAnalysisCleanupListener({
    before: async (analysisId) => {
      const selected = conversationRef.current;
      const affected = conversationsRef.current.filter((item) => item.analysisId === analysisId);
      for (const item of affected) invalidateConversationRun(item.id);
      if (selected?.analysisId === analysisId) {
        pendingFakeRequestRef.current = undefined;
        setStreaming(false);
      }
      if (affected.length === 0) return;
      await conversationMutationRef.current;
    },
    after: async (analysisId) => {
      const repositories = repositoriesRef.current;
      const selected = conversationRef.current;
      if (!repositories) return;
      const cached = conversationsRef.current;
      const affected = cached.filter((item) => item.analysisId === analysisId);
      if (affected.length === 0) return;
      const authoritativeEntries = await Promise.all(affected.map(async (item) => [item.id, await repositories.conversations.get(item.id)] as const));
      const authoritativeById = new Map(authoritativeEntries);
      for (const [conversationId, authoritative] of authoritativeEntries) {
        if (authoritative) deletedConversationsRef.current.delete(conversationId);
        else deletedConversationsRef.current.add(conversationId);
      }
      const reconciled = newestConversations(cached.flatMap((item) => {
        if (item.analysisId !== analysisId) return [item];
        const authoritative = authoritativeById.get(item.id);
        return authoritative ? [authoritative] : [];
      }));
      conversationsRef.current = reconciled;
      setConversations(reconciled);
      if (selected?.analysisId !== analysisId) return;
      const authoritativeSelected = authoritativeById.get(selected.id);
      if (authoritativeSelected) {
        await loadConversationData(authoritativeSelected);
        return;
      }
      const fallback = reconciled[0];
      if (fallback) await loadConversationData(fallback);
      else clearSelected();
    },
  }), [clearSelected, invalidateConversationRun, loadConversationData]);

  const clearAssistantContent = useCallback(async () => {
    contentGenerationRef.current += 1;
    const knownConversationIds = new Set(conversations.map((item) => item.id));
    if (conversationRef.current) knownConversationIds.add(conversationRef.current.id);
    for (const conversationId of knownConversationIds) {
      deletedConversationsRef.current.add(conversationId);
      invalidateConversationRun(conversationId);
    }
    loadGenerationRef.current += 1;
    conversationPageGenerationRef.current += 1;
    conversationPageLoadingRef.current = false;
    pendingFakeRequestRef.current = undefined;
    repeatableRunsRef.current.clear();
    setStreaming(false);
    setConversationPageLoading(false);
    setConversations([]);
    setConversationCursor(undefined);
    setAnnouncement("");
    setNotice(undefined);
    setError(undefined);
    clearSelected();

    const repositories = repositoriesRef.current;
    if (!repositories) return;
    const clearing = conversationMutationRef.current.then(() => repositories.clearAssistantContent());
    conversationMutationRef.current = clearing.then(() => undefined, () => undefined);
    await clearing;
  }, [clearSelected, conversations, invalidateConversationRun]);

  const createGeneralConversation = useCallback(async () => {
    if (createInFlightRef.current) return;
    const selectionIntent = { sequence: ++selectionIntentSequenceRef.current };
    createInFlightRef.current = selectionIntent;
    selectionIntentRef.current = selectionIntent;
    const contentGeneration = contentGenerationRef.current;
    const previousId = conversationRef.current?.id;
    if (previousId) invalidateConversationRun(previousId);
    pendingFakeRequestRef.current = undefined;
    const interruptedMessages = messagesRef.current.map((message) => message.status === "streaming" ? { ...message, status: "interrupted" as const } : message);
    messagesRef.current = interruptedMessages;
    setMessages(interruptedMessages);
    loadGenerationRef.current += 1;
    setStreaming(false);
    setSelectionLoading(true);
    setConversationTransitionPending(true);
    setNotice(undefined);
    setError(undefined);
    const createdAt = now();
    const enabledProviderIds = new Set(providerConfigs.filter((provider) => provider.enabled).map((provider) => provider.id));
    const lastProviderId = modelCatalog.find((entry) => entry.id === modelPreferences.lastCatalogEntryId)?.providerId;
    const preferredEntry = modelCatalog.find((entry) => entry.id === modelPreferences.lastCatalogEntryId && enabledProviderIds.has(entry.providerId) && generalModelCompatibility(entry).selectable)
      ?? modelCatalog.find((entry) => entry.providerId === lastProviderId && enabledProviderIds.has(entry.providerId) && generalModelCompatibility(entry).selectable);
    const created: Conversation = {
      id: createId("conversation"), type: "general", title: "Consulta general", associatedPersonIds: [], ...(preferredEntry ? { providerId: preferredEntry.providerId, modelId: preferredEntry.canonicalModelId } : {}),
      responseMode: assistantSettingsRef.current.responseMode, contextStrategy: assistantSettingsRef.current.contextStrategy, status: "active", createdAt, updatedAt: createdAt,
    };
    const creation = conversationMutationRef.current.then(async () => {
      const repositories = repositoriesRef.current;
      if (!repositories) throw new Error("storage_unavailable");
      await repositories.conversations.put(created);
    });
    conversationMutationRef.current = creation.then(() => undefined, () => undefined);
    try {
      await creation;
      if (!mountedRef.current || selectionIntentRef.current !== selectionIntent || contentGeneration !== contentGenerationRef.current) return;
      deletedConversationsRef.current.delete(created.id);
      setConversations((current) => newestConversations([created, ...current.filter((item) => item.id !== created.id)]));
      loadGenerationRef.current += 1; conversationRef.current = created; messagesRef.current = [];
      setConversation(created); setMessages([]); setMessageCursor(undefined); setSources([]); setRevealedSourceIds([]); setEvents([]); setActions([]); setActionOutputs({}); setSnapshots([]); setDocuments([]); setIndexJobs([]);
      setAnnouncement("Asistente preparado");
    } catch {
      if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current) {
        setError("No se pudo crear la conversación. Puedes volver a intentarlo.");
        setAnnouncement("No se pudo crear la conversación");
      }
    } finally {
      if (createInFlightRef.current === selectionIntent) {
        createInFlightRef.current = undefined;
        if (mountedRef.current) setConversationTransitionPending(false);
      }
      if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current) setSelectionLoading(false);
    }
  }, [invalidateConversationRun, modelCatalog, modelPreferences.lastCatalogEntryId, providerConfigs]);

  const loadMoreConversations = useCallback(async () => {
    if (!conversationCursor || conversationPageLoadingRef.current) return;
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    const cursor = conversationCursor;
    const generation = conversationPageGenerationRef.current;
    const contentGeneration = contentGenerationRef.current;
    conversationPageLoadingRef.current = true;
    setConversationPageLoading(true);
    try {
      const page = await repositories.conversations.list({ limit: CONVERSATION_PAGE_SIZE, cursor });
      if (!mountedRef.current || contentGeneration !== contentGenerationRef.current || generation !== conversationPageGenerationRef.current) return;
      setConversations((current) => newestConversations([...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]));
      setConversationCursor(page.nextCursor);
      setError(undefined);
    } catch {
      if (mountedRef.current && contentGeneration === contentGenerationRef.current && generation === conversationPageGenerationRef.current) {
        setError("No se pudieron cargar más conversaciones. Puedes volver a intentarlo.");
      }
    } finally {
      if (mountedRef.current && contentGeneration === contentGenerationRef.current && generation === conversationPageGenerationRef.current) {
        conversationPageLoadingRef.current = false;
        setConversationPageLoading(false);
      }
    }
  }, [conversationCursor]);

  const selectConversation = useCallback(async (id: string) => {
    if (createInFlightRef.current) return;
    if (conversationRef.current?.id === id && activeRunTokenRef.current?.conversationId === id) return;
    const selectionIntent = { sequence: ++selectionIntentSequenceRef.current };
    selectionIntentRef.current = selectionIntent;
    const contentGeneration = contentGenerationRef.current;
    setSelectionLoading(true);
    const previousId = conversationRef.current?.id;
    if (previousId && previousId !== id) invalidateConversationRun(previousId);
    pendingFakeRequestRef.current = undefined;
    setStreaming(false);
    try {
      const repositories = repositoriesRef.current;
      const selected = repositories ? await repositories.conversations.get(id) : undefined;
      if (selected && mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current) {
        await loadConversationData(selected, selectionIntent);
      } else if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current) {
        removeCachedConversation(id);
        if (conversationRef.current?.id === id) clearSelected();
        setError("La conversación ya no está disponible.");
        setSelectionLoading(false);
      }
    } catch {
      if (mountedRef.current && selectionIntentRef.current === selectionIntent && contentGeneration === contentGenerationRef.current) {
        setSelectionLoading(false);
        setError("No se pudo cargar la conversación. Puedes volver a intentarlo.");
      }
    }
  }, [clearSelected, invalidateConversationRun, loadConversationData, removeCachedConversation]);

  const updateSelectedConversation = useCallback((patch: Partial<Conversation> | ((current: Conversation) => Partial<Conversation>)): Promise<void> => {
    if (createInFlightRef.current) return Promise.resolve();
    const selectedAtInvocation = conversationRef.current;
    const selectedId = selectedAtInvocation?.id;
    const contentGeneration = contentGenerationRef.current;
    if (!selectedId || selectedAtInvocation.status !== "active" || deletedConversationsRef.current.has(selectedId)) return Promise.resolve();
    const operation = conversationMutationRef.current.then(async () => {
      const repositories = repositoriesRef.current;
      if (!repositories || contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return;
      const current = await repositories.conversations.get(selectedId);
      if (!current || current.status !== "active" || contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return;
      const requestedPatch = withoutUndefined(typeof patch === "function" ? patch(current) : patch);
      if (contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return;
      const updated = await repositories.updateActiveConversation(selectedId, requestedPatch, now());
      if (!updated) return;
      if (!mountedRef.current || contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return;
      setConversations((items) => newestConversations(items.map((item) => item.id === updated.id ? updated : item)));
      if (conversationRef.current?.id === updated.id) { conversationRef.current = updated; setConversation(updated); }
    });
    conversationMutationRef.current = operation.catch(() => undefined);
    selectedConversationMutationRef.current = operation.catch(() => undefined);
    return operation;
  }, []);

  const renameConversation = useCallback(async (title: string) => { if (title.trim()) await updateSelectedConversation({ title: title.trim() }); }, [updateSelectedConversation]);
  const archiveConversation = useCallback(async () => { await updateSelectedConversation({ status: "archived" }); }, [updateSelectedConversation]);
  const deleteConversation = useCallback(async () => {
    if (createInFlightRef.current) return;
    const selected = conversationRef.current;
    const contentGeneration = contentGenerationRef.current;
    if (!selected) return;
    if (!window.confirm(`¿Eliminar la conversación «${selected.title}» y todo su contenido local?`)) return;
    deletedConversationsRef.current.add(selected.id);
    invalidateConversationRun(selected.id);
    loadGenerationRef.current += 1;
    pendingFakeRequestRef.current = undefined;
    setStreaming(false);
    const repositories = repositoriesRef.current!;
    const deletion = conversationMutationRef.current.then(() => repositories.deleteConversation(selected.id));
    conversationMutationRef.current = deletion.catch(() => undefined);
    await deletion;
    if (!mountedRef.current || contentGeneration !== contentGenerationRef.current) return;
    const remaining = newestConversations(conversations.filter((item) => item.id !== selected.id));
    setConversations(remaining);
    if (remaining[0]) await loadConversationData(remaining[0]); else clearSelected();
  }, [clearSelected, conversations, invalidateConversationRun, loadConversationData]);

  const loadMoreMessages = useCallback(async () => {
    if (!conversation || !messageCursor) return;
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    const selectedId = conversation.id;
    const cursor = messageCursor;
    const contentGeneration = contentGenerationRef.current;
    const generation = ++loadGenerationRef.current;
    setSelectionLoading(true);
    try {
      const page = await repositories.messages.listByConversation(selectedId, { limit: MESSAGE_PAGE_SIZE, cursor });
      const newSources = await Promise.all([...new Set(page.items.flatMap((item) => item.sourceRefIds))].map((id) => repositories.sources.get(id)));
      if (!mountedRef.current || contentGeneration !== contentGenerationRef.current || generation !== loadGenerationRef.current || conversationRef.current?.id !== selectedId || deletedConversationsRef.current.has(selectedId)) return;
      const nextMessages = [...page.items.filter((item) => !messagesRef.current.some((existing) => existing.id === item.id)), ...messagesRef.current];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setSources((current) => [...current, ...newSources.filter((item): item is SourceReference => item !== undefined && !current.some((existing) => existing.id === item.id))]);
      setMessageCursor(page.nextCursor);
      setError(undefined);
    } catch {
      if (mountedRef.current && contentGeneration === contentGenerationRef.current && generation === loadGenerationRef.current && conversationRef.current?.id === selectedId) {
        setError("No se pudieron cargar los mensajes anteriores. Puedes volver a intentarlo.");
      }
    } finally {
      if (mountedRef.current && contentGeneration === contentGenerationRef.current && generation === loadGenerationRef.current && conversationRef.current?.id === selectedId) setSelectionLoading(false);
    }
  }, [conversation, messageCursor]);

  const persistRunRound = useCallback(async (conversationId: string, nextMessages: ChatMessage[], nextSources: SourceReference[], guard: () => boolean) => {
    const contentGeneration = contentGenerationRef.current;
    const operation = conversationMutationRef.current.then(async () => {
      const repositories = repositoriesRef.current;
      if (!repositories || contentGeneration !== contentGenerationRef.current || !guard() || deletedConversationsRef.current.has(conversationId)) return false;
      const authoritative = await repositories.conversations.get(conversationId);
      if (!authoritative || authoritative.status !== "active" || contentGeneration !== contentGenerationRef.current || !guard() || deletedConversationsRef.current.has(conversationId)) return false;
      const updatedConversation = { ...authoritative, updatedAt: now() };
      await repositories.writeConversationBlock({ conversation: updatedConversation, messages: nextMessages, sources: nextSources });
      if (contentGeneration !== contentGenerationRef.current || !guard() || deletedConversationsRef.current.has(conversationId) || conversationRef.current?.id !== conversationId) return false;
      conversationRef.current = updatedConversation;
      messagesRef.current = nextMessages;
      setConversation(updatedConversation);
      setMessages(nextMessages);
      setSources(nextSources);
      setConversations((current) => newestConversations(current.map((item) => item.id === conversationId ? updatedConversation : item)));
      return true;
    });
    conversationMutationRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const send = useCallback(async (rawText: string) => {
    if (!conversation || !rawText.trim() || streaming || selectionLoading || deletedConversationsRef.current.has(conversation.id)) return;
    await selectedConversationMutationRef.current;
    if (conversationRef.current?.id !== conversation.id) return;
    const authoritative = await repositoriesRef.current?.conversations.get(conversation.id);
    if (!authoritative || authoritative.status !== "active") {
      if (authoritative) { conversationRef.current = authoritative; setConversation(authoritative); setNotice("Esta conversación es histórica y de solo lectura."); }
      else setError("La conversación ya no está disponible.");
      return;
    }
    setError(undefined); setNotice(undefined);
    let content: string;
    let explicitPersonIds: string[] = [];
    try {
      const knownPeople = authoritative.type === "analysis" && activeAnalysis && activeAnalysis.id === authoritative.analysisId ? activeAnalysis.result.people : [];
      const fullAnalysis = authoritative.contextStrategy === "full_analysis" || authoritative.contextStrategy === "full";
      const allowedPersonIds = authoritative.type === "analysis" ? (fullAnalysis ? knownPeople.map((person) => person.employeeNumber) : authoritative.associatedPersonIds) : undefined;
      const resolved = resolveChatContent(rawText, knownPeople, authoritative.type, allowedPersonIds, authoritative.primaryPersonId);
      content = resolved.content;
      explicitPersonIds = resolved.explicitPersonIds;
    } catch (error) {
      if (error instanceof Error && error.message === "ambiguous_person_mention") setError("Hay varias personas que coinciden. Escribe el nombre completo, indica la matrícula o selecciónala en Personas asociadas.");
      else if (error instanceof Error && error.message === "person_outside_authorized_scope") setError("La persona indicada no está dentro del alcance. Añádela en Personas asociadas o usa Análisis completo.");
      else setError("No se puede guardar la pregunta porque contiene una referencia personal no identificada.");
      return;
    }
    const createdAt = now();
    const selectedCatalogEntry = modelCatalog.find((entry) => entry.providerId === authoritative.providerId && entry.canonicalModelId === authoritative.modelId
      && entry.availability === "available" && entry.capabilities.chat === true && (authoritative.type === "general" || entry.capabilities.tools === true));
    const selectedProviderConfig = selectedCatalogEntry ? providerConfigs.find((provider) => provider.id === selectedCatalogEntry.providerId && provider.enabled) : undefined;
    if ((!selectedCatalogEntry || !selectedProviderConfig) && !adapter) {
      setError("No hay modelos configurados.");
      return;
    }
    const modelProfileId = selectedCatalogEntry?.id ?? TEST_MODEL_ID;
    const modelId = selectedCatalogEntry?.generationModelId ?? TEST_MODEL_ID;
    let analysisContext: Parameters<AssistantOrchestrator["send"]>[0]["analysisContext"];
    if (authoritative.type === "analysis" && authoritative.analysisId && activeAnalysis) {
      activeScopeSnapshotRef.current = await createScopeSnapshot({
        analysisId: authoritative.analysisId,
        analysisVersion: authoritative.analysisVersion ?? "current",
        strategy: authoritative.contextStrategy === "full_analysis" || authoritative.contextStrategy === "full" ? "full_analysis" : "associated_people",
        associatedPersonIds: authoritative.associatedPersonIds,
        ...(authoritative.primaryPersonId ? { primaryPersonId: authoritative.primaryPersonId } : {}),
        explicitPersonIds,
        // Document discovery remains a paginated tool concern. Capturing every
        // document here would turn full_analysis into an eager corpus preload.
        documentIds: [],
        allowedTools: ANALYSIS_TOOL_NAMES,
      });
      const summary = activeAnalysis.result.summary;
      analysisContext = {
        associatedPersonIds: authoritative.associatedPersonIds,
        ...(authoritative.primaryPersonId ? { primaryPersonId: authoritative.primaryPersonId } : {}),
        strategy: authoritative.contextStrategy === "full_analysis" || authoritative.contextStrategy === "full" ? "full_analysis" : "associated_people",
        periods: [...new Set(activeAnalysis.result.people.flatMap((person) => person.periods ?? []))].slice(0, 100),
        sourceTypes: [...new Set(documents.filter((document) => document.scope.type === "analysis" && document.scope.analysisId === authoritative.analysisId).map((document) => document.mediaType))],
        aggregate: { uniquePeople: summary?.uniquePeople ?? activeAnalysis.result.people.length, peopleWithDifferences: summary?.peopleWithDifferences ?? 0, totalGlobalDifference: summary?.totalGlobalDifference ?? 0, conceptsPendingReview: summary?.conceptsPendingReview ?? 0, pdfsAnalyzed: summary?.pdfsAnalyzed ?? 0 },
      };
    } else activeScopeSnapshotRef.current = undefined;
    const userMessage: ChatMessage = {
      id: createId("message"), conversationId: authoritative.id, role: "user", content, status: "completed", contextOrigin: authoritative.type,
      ...(selectedCatalogEntry ? { providerId: selectedCatalogEntry.providerId } : {}), modelProfileId, modelId, responseMode: authoritative.responseMode, contextStrategy: authoritative.contextStrategy,
      ...(authoritative.analysisVersion ? { analysisVersion: authoritative.analysisVersion } : {}), sourceRefIds: [], actionIds: [], createdAt,
    };
    let nextSources = sources;
    let sourceRefIds: string[] = [];
    const personMatch = /matrícula ([\p{L}\p{N}._-]+)/u.exec(content);
    if (adapter && authoritative.type === "analysis" && authoritative.analysisId && activeAnalysis && personMatch) {
      const profile = executeAssistantToolRequest({ tool: "getPersonProfile", args: { analysisId: authoritative.analysisId, personId: personMatch[1] } }, activeAnalysis, authoritative.id);
      pendingFakeRequestRef.current = { kind: "profile", request: { messageId: "pending", totals: profile.totals, source: profile.source } };
      nextSources = [...sources.filter((item) => item.id !== profile.source.id), profile.source];
      sourceRefIds = [profile.source.id];
    } else if (adapter) {
      pendingFakeRequestRef.current = { kind: "general", request: { systemPrompt: TEST_SYSTEM_PROMPT, question: content, messageId: "pending" } };
    }
    const assistantMessage: ChatMessage = {
      ...userMessage, id: createId("message"), role: "assistant", content: "", status: "streaming", sourceRefIds,
      createdAt: new Date(Math.max(Date.parse(now()), Date.parse(createdAt) + 1)).toISOString(),
    };
    const runToken = beginConversationRun(authoritative.id);
    const runIsCurrent = () => isConversationRunCurrent(runToken);
    const baseMessages = messages.filter((message) => message.status !== "streaming");
    setMessages([...baseMessages, userMessage, assistantMessage]);
    messagesRef.current = [...baseMessages, userMessage, assistantMessage];
    setStreaming(true);
    setAnnouncement("Generando respuesta");
    let partialText = "";
    let partialTimer: ReturnType<typeof setTimeout> | undefined;
    let runPending: PendingFakeRequest | undefined;
    const flushPartial = () => {
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = undefined;
      if (!runIsCurrent()) return;
      setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: partialText } : message));
      setAnnouncement(`Respuesta parcial: ${partialText}`);
    };
    const onTextDelta = (delta: string) => {
      if (!runIsCurrent()) return;
      partialText += delta;
      if (!partialTimer) partialTimer = setTimeout(flushPartial, STREAM_BATCH_MS);
    };
    try {
      if (adapter) {
        const pending = pendingFakeRequestRef.current!;
        pendingFakeRequestRef.current = pending.kind === "general"
          ? { kind: "general", request: { ...pending.request, messageId: assistantMessage.id } }
          : { kind: "profile", request: { ...pending.request, messageId: assistantMessage.id } };
        runPending = pendingFakeRequestRef.current;
        repeatableRunsRef.current.set(assistantMessage.id, runPending);
      }
      const result = await orchestratorRef.current!.send({
        conversationId: authoritative.id, ...(authoritative.type === "analysis" ? { analysisId: authoritative.analysisId } : {}), question: content, assistantMessageId: assistantMessage.id,
        ...(analysisContext ? { analysisContext } : {}), ...(selectedCatalogEntry && selectedProviderConfig ? { providerId: selectedCatalogEntry.providerId, provider: providerRuntimeDescriptor(selectedProviderConfig), modelMetadata: { contextWindow: selectedCatalogEntry.contextWindow ?? 8_192, ...(selectedCatalogEntry.maxOutputTokens ? { maxOutputTokens: selectedCatalogEntry.maxOutputTokens } : {}), generationModelId: selectedCatalogEntry.generationModelId } } : {}), modelProfileId, modelId,
        responseMode: authoritative.responseMode, contextStrategy: authoritative.contextStrategy, onTextDelta,
      });
      if (!runIsCurrent()) return;
      nextSources = [...nextSources.filter((source) => !result.sources.some((recovered) => recovered.id === source.id)), ...result.sources];
      sourceRefIds = result.sources.map((source) => source.id);
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = undefined;
      const producedMessages = result.producedMessages.map((produced, index) => ({
        ...assistantMessage,
        id: produced.id,
        content: produced.content,
        status: produced.status,
        modelProfileId: produced.modelProfileId,
        modelId: produced.modelId,
        sourceRefIds,
        createdAt: new Date(Date.parse(assistantMessage.createdAt) + index).toISOString(),
      }));
      const completed = producedMessages.at(-1) ?? { ...assistantMessage, content: result.text, status: "completed" as const };
      const persisted = await persistRunRound(authoritative.id, [...baseMessages, userMessage, ...producedMessages], nextSources, runIsCurrent);
      if (persisted && runIsCurrent()) { setNotice("Respuesta completada"); setAnnouncement(`Respuesta completada: ${completed.content}`); }
    } catch (caught) {
      if (!runIsCurrent()) return;
      flushPartial();
      const stopped = caught instanceof AssistantRunStoppedError;
      const failureMessage = caught instanceof ProviderAdapterError ? caught.publicMessage : "No se pudo completar la respuesta del Asistente.";
      const terminal = { ...assistantMessage, content: stopped ? caught.partialText : partialText || failureMessage, status: stopped ? "stopped" as const : "failed" as const };
      const persisted = await persistRunRound(authoritative.id, [...baseMessages, userMessage, terminal], nextSources, runIsCurrent).catch(() => false);
      if (persisted && runIsCurrent()) {
        if (stopped) { setNotice("Respuesta detenida"); setAnnouncement(`Respuesta detenida: ${terminal.content}`); }
        else { setError(failureMessage); setAnnouncement("La respuesta ha fallado"); }
      } else if (!stopped && runIsCurrent()) {
        setError(failureMessage);
        setAnnouncement("La respuesta ha fallado");
      }
    } finally {
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = undefined;
      if (pendingFakeRequestRef.current === runPending) pendingFakeRequestRef.current = undefined;
      if (runIsCurrent()) setStreaming(false);
      if (activeRunTokenRef.current === runToken) activeRunTokenRef.current = undefined;
      activeScopeSnapshotRef.current = undefined;
    }
  }, [activeAnalysis, beginConversationRun, conversation, documents, isConversationRunCurrent, messages, modelCatalog, persistRunRound, providerConfigs, selectionLoading, sources, streaming]);

  const stop = useCallback(() => {
    const token = activeRunTokenRef.current;
    if (token && isConversationRunCurrent(token) && activeRunTokenRef.current === token) orchestratorRef.current?.stop();
  }, [isConversationRunCurrent]);
  const resolveRepeatTarget = useCallback((messageId: string) => {
    const selected = conversationRef.current;
    const loadedMessages = messagesRef.current;
    const targetIndex = loadedMessages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const target = targetIndex >= 0 ? loadedMessages[targetIndex] : undefined;
    const precedingUser = targetIndex > 0 ? loadedMessages[targetIndex - 1] : undefined;
    if (!selected || selected.status !== "active" || !target || target.conversationId !== selected.id || precedingUser?.role !== "user"
      || precedingUser.conversationId !== selected.id || deletedConversationsRef.current.has(selected.id)) return undefined;

    const pending = repeatableRunsRef.current.get(target.id);
    if (target.modelProfileId === TEST_MODEL_ID) {
      if (!pending) return undefined;
      return { selected, target, precedingUser, modelProfileId: TEST_MODEL_ID, modelId: TEST_MODEL_ID, pending };
    }

    if (adapter) {
      if (!pending && target.modelProfileId === "fake-retributivo-v1") return undefined;
      return { selected, target, precedingUser, modelProfileId: target.modelProfileId ?? TEST_MODEL_ID, modelId: target.modelId ?? TEST_MODEL_ID, providerId: target.providerId, pending };
    }
    const catalogEntry = modelCatalog.find((entry) => entry.id === target.modelProfileId && entry.providerId === target.providerId && entry.availability === "available");
    if (!catalogEntry) return undefined;
    if (catalogEntry) return { selected, target, precedingUser, modelProfileId: catalogEntry.id, modelId: catalogEntry.generationModelId, providerId: catalogEntry.providerId, catalogEntry, pending };
  }, [adapter, modelCatalog]);

  const repeatResponse = useCallback(async (messageId: string, mode: "retry" | "regenerate") => {
    const repeatTarget = resolveRepeatTarget(messageId);
    const orchestrator = orchestratorRef.current;
    if (!repeatTarget || !orchestrator || streaming || selectionLoading) return;
    const authoritative = await repositoriesRef.current?.conversations.get(repeatTarget.selected.id);
    if (!authoritative || authoritative.status !== "active") return;
    const { selected, target, precedingUser, modelProfileId, modelId, catalogEntry } = repeatTarget;
    const providerConfig = catalogEntry ? providerConfigs.find((provider) => provider.id === catalogEntry.providerId && provider.enabled) : undefined;
    if (catalogEntry && !providerConfig) return;
    const pending = repeatTarget.pending;
    let runPending: PendingFakeRequest | undefined;
    if (pending) {
      pendingFakeRequestRef.current = pending.kind === "general"
        ? { kind: "general", request: { ...pending.request, question: precedingUser.content, messageId: target.id } }
        : { kind: "profile", request: { ...pending.request, messageId: target.id } };
      runPending = pendingFakeRequestRef.current;
      repeatableRunsRef.current.set(target.id, runPending);
    }
    let analysisContext: Parameters<AssistantOrchestrator["send"]>[0]["analysisContext"];
    if (authoritative.type === "analysis" && authoritative.analysisId && activeAnalysis?.id === authoritative.analysisId) {
      const fullAnalysis = authoritative.contextStrategy === "full_analysis" || authoritative.contextStrategy === "full";
      const allowedPersonIds = fullAnalysis ? activeAnalysis.result.people.map((person) => person.employeeNumber) : authoritative.associatedPersonIds;
      const resolved = resolveChatContent(precedingUser.content, activeAnalysis.result.people, authoritative.type, allowedPersonIds, authoritative.primaryPersonId);
      activeScopeSnapshotRef.current = await createScopeSnapshot({
        analysisId: authoritative.analysisId,
        analysisVersion: authoritative.analysisVersion ?? "current",
        strategy: fullAnalysis ? "full_analysis" : "associated_people",
        associatedPersonIds: authoritative.associatedPersonIds,
        ...(authoritative.primaryPersonId ? { primaryPersonId: authoritative.primaryPersonId } : {}),
        explicitPersonIds: resolved.explicitPersonIds,
        documentIds: [],
        allowedTools: ANALYSIS_TOOL_NAMES,
      });
      const summary = activeAnalysis.result.summary;
      analysisContext = {
        associatedPersonIds: authoritative.associatedPersonIds,
        ...(authoritative.primaryPersonId ? { primaryPersonId: authoritative.primaryPersonId } : {}),
        strategy: fullAnalysis ? "full_analysis" : "associated_people",
        periods: [...new Set(activeAnalysis.result.people.flatMap((person) => person.periods ?? []))].slice(0, 100),
        sourceTypes: [...new Set(documents.filter((document) => document.scope.type === "analysis" && document.scope.analysisId === authoritative.analysisId).map((document) => document.mediaType))],
        aggregate: { uniquePeople: summary?.uniquePeople ?? activeAnalysis.result.people.length, peopleWithDifferences: summary?.peopleWithDifferences ?? 0, totalGlobalDifference: summary?.totalGlobalDifference ?? 0, conceptsPendingReview: summary?.conceptsPendingReview ?? 0, pdfsAnalyzed: summary?.pdfsAnalyzed ?? 0 },
      };
    } else activeScopeSnapshotRef.current = undefined;
    const canContinue = mode === "retry" && (target.status === "stopped" || target.status === "interrupted")
      && target.content.trim().length > 0 && (modelProfileId !== TEST_MODEL_ID || Boolean(adapter));
    const runToken = beginConversationRun(selected.id);
    const runIsCurrent = () => isConversationRunCurrent(runToken);
    setStreaming(true); setError(undefined); setNotice(undefined);
    setAnnouncement(mode === "retry" ? "Reanudando respuesta" : "Regenerando respuesta");
    let generated = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rendered = () => canContinue ? `${target.content}${generated}` : generated;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!runIsCurrent()) return;
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: rendered(), status: "streaming" } : message));
      setAnnouncement(`Respuesta parcial: ${rendered()}`);
    };
    const onTextDelta = (delta: string) => { if (!runIsCurrent()) return; generated += delta; if (!timer) timer = setTimeout(flush, STREAM_BATCH_MS); };
    try {
      const result = await orchestrator.send({
        conversationId: authoritative.id, ...(authoritative.type === "analysis" ? { analysisId: authoritative.analysisId, analysisContext } : {}), question: precedingUser.content,
        assistantMessageId: target.id, modelProfileId, modelId, ...(catalogEntry && providerConfig ? { providerId: catalogEntry.providerId, provider: providerRuntimeDescriptor(providerConfig), modelMetadata: { contextWindow: catalogEntry.contextWindow ?? 8_192, ...(catalogEntry.maxOutputTokens ? { maxOutputTokens: catalogEntry.maxOutputTokens } : {}), generationModelId: catalogEntry.generationModelId } } : {}),
        responseMode: target.responseMode, contextStrategy: target.contextStrategy,
        ...(canContinue ? { resumeFrom: { messageId: target.id, context: target.content } } : {}), onTextDelta,
      });
      if (!runIsCurrent()) return;
      generated = result.text;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const content = rendered();
      const nextSources = [...sources.filter((source) => !result.sources.some((recovered) => recovered.id === source.id)), ...result.sources];
      const sourceRefIds = result.sources.map((source) => source.id);
      const nextMessages = messagesRef.current.map((message) => message.id === messageId ? { ...message, content, status: "completed" as const, sourceRefIds } : message);
      const persisted = await persistRunRound(selected.id, nextMessages, nextSources, runIsCurrent);
      if (persisted && runIsCurrent()) {
        setNotice(mode === "retry" ? "Respuesta reanudada" : "La respuesta se ha regenerado");
        setAnnouncement(`${mode === "retry" ? "Respuesta reanudada" : "Respuesta regenerada"}: ${content}`);
      }
    } catch (caught) {
      if (!runIsCurrent()) return;
      flush();
      if (caught instanceof AssistantRunStoppedError) {
        const content = canContinue ? `${target.content}${caught.partialText}` : caught.partialText;
        const nextMessages = messagesRef.current.map((message) => message.id === messageId ? { ...message, content, status: "stopped" as const } : message);
        const persisted = await persistRunRound(selected.id, nextMessages, sources, runIsCurrent).catch(() => false);
        if (persisted && runIsCurrent()) { setNotice("Respuesta detenida"); setAnnouncement(`Respuesta detenida: ${content}`); }
      } else {
        const hasNewPartial = generated.length > 0;
        const content = hasNewPartial ? rendered() : target.content;
        const status = hasNewPartial ? "failed" as const : target.status;
        const nextMessages = messagesRef.current.map((message) => message.id === messageId ? { ...message, content, status } : message);
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        await persistRunRound(selected.id, nextMessages, sources, runIsCurrent).catch(() => false);
        const failureMessage = caught instanceof ProviderAdapterError ? caught.publicMessage : "No se pudo completar la respuesta del Asistente.";
        if (runIsCurrent()) { setError(failureMessage); setAnnouncement("La respuesta ha fallado"); }
      }
    } finally {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (pendingFakeRequestRef.current === runPending) pendingFakeRequestRef.current = undefined;
      if (runIsCurrent()) setStreaming(false);
      if (activeRunTokenRef.current === runToken) activeRunTokenRef.current = undefined;
      activeScopeSnapshotRef.current = undefined;
    }
  }, [activeAnalysis, adapter, beginConversationRun, documents, isConversationRunCurrent, persistRunRound, providerConfigs, resolveRepeatTarget, selectionLoading, sources, streaming]);
  const retryResponse = useCallback((messageId: string) => repeatResponse(messageId, "retry"), [repeatResponse]);
  const regenerateResponse = useCallback((messageId: string) => repeatResponse(messageId, "regenerate"), [repeatResponse]);

  const copyResponse = useCallback(async (messageId: string) => {
    const content = messages.find((message) => message.id === messageId)?.content;
    if (!content) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(content);
      setNotice("Respuesta copiada");
      setAnnouncement("Respuesta copiada");
    } catch {
      setNotice("No se pudo copiar la respuesta");
      setAnnouncement("No se pudo copiar la respuesta");
    }
  }, [messages]);

  const acceptAction = useCallback(async (actionId: string) => {
    const repositories = repositoriesRef.current;
    const selected = conversationRef.current;
    const action = actions.find((item) => item.id === actionId);
    if (!repositories || !selected || selected.status !== "active" || !action || action.status !== "pending") return;
    if (resolvingActionIdsRef.current.has(actionId)) return;
    resolvingActionIdsRef.current.add(actionId);
    setResolvingActionIds((current) => current.includes(actionId) ? current : [...current, actionId]);
    try {
      const executed = await executeChatAction({
        action,
        repositories,
        analysis: activeAnalysis ? { id: activeAnalysis.id, result: activeAnalysis.result } : undefined,
        now: now(),
      });
      setActions((current) => current.map((item) => item.id === executed.id ? executed : item));
      if (executed.output !== undefined) setActionOutputs((current) => ({ ...current, [executed.id]: executed.output }));
      const refreshed = await repositories.conversations.get(selected.id);
      if (refreshed && conversationRef.current?.id === refreshed.id) {
        conversationRef.current = refreshed;
        setConversation(refreshed);
        setConversations((current) => newestConversations(current.map((item) => item.id === refreshed.id ? refreshed : item)));
      }
      if (executed.intent?.type === "assistant_conversation") {
        const created = await repositories.conversations.get(executed.intent.conversationId);
        if (created) await loadConversationData(created);
      }
      if (executed.intent?.type === "show_sources") setRevealedSourceIds(executed.intent.sourceIds);
      if (executed.intent) onNavigate?.(executed.intent);
      setAnnouncement(`Acción ${action.label} aceptada`);
    } catch (caught) {
      const stored = await repositories.actions.get(action.id);
      if (stored) setActions((current) => current.map((item) => item.id === stored.id ? stored : item));
      setError(caught instanceof Error ? caught.message : "No se pudo ejecutar la acción.");
    } finally {
      resolvingActionIdsRef.current.delete(actionId);
      setResolvingActionIds((current) => current.filter((id) => id !== actionId));
    }
  }, [actions, activeAnalysis, loadConversationData, onNavigate]);

  const rejectAction = useCallback(async (actionId: string) => {
    const repositories = repositoriesRef.current;
    const selected = conversationRef.current;
    const action = actions.find((item) => item.id === actionId);
    if (!repositories || !selected || selected.status !== "active" || !action || action.status !== "pending") return;
    if (resolvingActionIdsRef.current.has(actionId)) return;
    resolvingActionIdsRef.current.add(actionId);
    setResolvingActionIds((current) => current.includes(actionId) ? current : [...current, actionId]);
    try {
      const rejected = await rejectChatAction({ action, repositories, now: now() });
      setActions((current) => current.map((item) => item.id === rejected.id ? rejected : item));
      setAnnouncement(`Acción ${action.label} rechazada`);
    } catch {
      const stored = await repositories.actions.get(action.id);
      if (stored) setActions((current) => current.map((item) => item.id === stored.id ? stored : item));
      setError("No se pudo rechazar la acción.");
    } finally {
      resolvingActionIdsRef.current.delete(actionId);
      setResolvingActionIds((current) => current.filter((id) => id !== actionId));
    }
  }, [actions]);

  const convertToActiveAnalysis = useCallback(async () => {
    if (createInFlightRef.current || contextAdditionInFlightRef.current) return;
    const selectedId = conversationRef.current?.id;
    if (!selectedId || conversationRef.current?.status !== "active" || !activeAnalysis || deletedConversationsRef.current.has(selectedId)) return;
    const analysis = activeAnalysis;
    contextAdditionInFlightRef.current = true;
    setConversationTransitionPending(true);
    setError(undefined);
    try {
      const analysisVersion = await ensureActiveAnalysisVersion();
      if (!analysisVersion) throw new Error("analysis_version_unavailable");
      const contentGeneration = contentGenerationRef.current;
      const operation = conversationMutationRef.current.then(async () => {
        const repositories = repositoriesRef.current;
        if (!repositories || contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return false;
        const converted = await repositories.convertConversationToAnalysis({
          conversationId: selectedId, analysisId: analysis.id, analysisVersion, convertedAt: now(),
        });
        if (!converted || contentGeneration !== contentGenerationRef.current || deletedConversationsRef.current.has(selectedId)) return false;
        if (mountedRef.current) {
          setConversations((current) => newestConversations(current.map((item) => item.id === selectedId ? converted.conversation : item)));
          if (conversationRef.current?.id === selectedId) {
            const convertedLoadedMessages = messagesRef.current.map((message) => ({ ...message, contextOrigin: "general" as const }));
            conversationRef.current = converted.conversation;
            messagesRef.current = convertedLoadedMessages;
            setConversation(converted.conversation);
            setMessages(convertedLoadedMessages);
            setEvents((current) => current.some((event) => event.id === converted.event.id) ? current : [...current, converted.event]);
            setNotice("Contexto del análisis añadido");
            setAnnouncement("Contexto del análisis añadido");
          }
        }
        return true;
      });
      conversationMutationRef.current = operation.then(() => undefined, () => undefined);
      await operation;
    } catch {
      if (mountedRef.current) setError("No se pudo añadir el contexto del análisis. Vuelve a intentarlo.");
    } finally {
      contextAdditionInFlightRef.current = false;
      if (mountedRef.current) setConversationTransitionPending(false);
    }
  }, [activeAnalysis, ensureActiveAnalysisVersion]);

  const continuePersonInAssistant = useCallback(async (personId: string) => {
    const repositories = repositoriesRef.current;
    if (!ready || !repositories || !activeAnalysis || !activeAnalysis.result.people.some((person) => person.employeeNumber === personId)) {
      const message = "No se puede continuar en el Asistente porque el análisis o la matrícula ya no están disponibles.";
      setError(message); throw new Error(message);
    }
    const analysisVersion = await ensureActiveAnalysisVersion();
    if (!analysisVersion) { const message = "No se puede continuar en el Asistente porque el análisis ya no está disponible."; setError(message); throw new Error(message); }
    const preferred = modelCatalog.find((entry) => entry.id === modelPreferences.lastCatalogEntryId && entry.capabilities.chat === true && entry.capabilities.tools === true && entry.availability === "available");
    const operation = conversationMutationRef.current.then(() => continuePerson({
      repositories, analysisId: activeAnalysis.id, analysisVersion, personId,
      ...(preferred ? { providerId: preferred.providerId, modelId: preferred.canonicalModelId } : {}), now: now(),
    }));
    conversationMutationRef.current = operation.then(() => undefined, () => undefined);
    const selected = await operation;
    setConversations((current) => newestConversations([selected, ...current.filter((item) => item.id !== selected.id)]));
    await loadConversationData(selected);
    setNotice(`Matrícula asociada: ${personId}`);
    setAnnouncement(`Matrícula ${personId} asociada al Asistente`);
  }, [activeAnalysis, ensureActiveAnalysisVersion, loadConversationData, modelCatalog, modelPreferences.lastCatalogEntryId, ready]);

  const addPerson = useCallback(async (personId: string) => {
    await updateSelectedConversation((current) => current.type === "analysis" ? {
      associatedPersonIds: [...new Set([...current.associatedPersonIds, personId])], primaryPersonId: current.primaryPersonId ?? personId,
    } : {});
  }, [updateSelectedConversation]);
  const associatePerson = addPerson;
  const removePerson = useCallback(async (personId: string) => {
    await updateSelectedConversation((current) => {
      if (current.type !== "analysis") return {};
      const associatedPersonIds = current.associatedPersonIds.filter((id) => id !== personId);
      return { associatedPersonIds, primaryPersonId: current.primaryPersonId === personId ? associatedPersonIds[0] : current.primaryPersonId };
    });
  }, [updateSelectedConversation]);
  const setPrimaryPerson = useCallback(async (personId: string) => {
    await updateSelectedConversation((current) => current.type === "analysis" ? { associatedPersonIds: [...new Set([...current.associatedPersonIds, personId])], primaryPersonId: personId } : {});
  }, [updateSelectedConversation]);

  const requestPersonProfile = useCallback(async () => {
    if (!conversation?.analysisId || !conversation.primaryPersonId) return;
    await send(`Consulta la matrícula ${conversation.primaryPersonId}`);
  }, [conversation, send]);

  const updateConversationPreferences = useCallback(async (patch: { responseMode?: ResponseMode; contextStrategy?: ContextStrategy }) => {
    await updateSelectedConversation(patch);
  }, [updateSelectedConversation]);
  const selectConversationModel = useCallback(async (providerId: string, modelId: string) => {
    const entry = modelCatalog.find((item) => item.providerId === providerId && item.canonicalModelId === modelId);
    const selected = conversationRef.current;
    if (!entry || !selected || !providerConfigs.some((provider) => provider.id === providerId && provider.enabled)) return;
    const compatibility = modelCompatibility(entry, selected.type);
    if (!compatibility.selectable) {
      if (selected.type === "analysis" && entry.capabilities.tools === "unknown") await checkModelCompatibility(entry);
      return;
    }
    await updateSelectedConversation({ providerId, modelId });
    const recent = [entry.id, ...modelPreferences.recentCatalogEntryIds.filter((id) => id !== entry.id)].slice(0, 12);
    await persistModelPreferences({ ...modelPreferences, recentCatalogEntryIds: recent, lastCatalogEntryId: entry.id, updatedAt: now() });
  }, [checkModelCompatibility, modelCatalog, modelPreferences, persistModelPreferences, providerConfigs, updateSelectedConversation]);
  const openModelSettings = useCallback(() => onNavigate?.({ type: "settings_ai" }), [onNavigate]);

  const hasActiveAnalysisContext = conversation?.type === "analysis" && activeAnalysis?.id === conversation.analysisId;
  const activeAnalysisResult = activeAnalysis?.result;
  const activeAnalysisPeople = hasActiveAnalysisContext ? activeAnalysisResult?.people : undefined;
  const availablePersonIds = useMemo(() => hasActiveAnalysisContext
    ? (activeAnalysisPeople ?? []).map((person) => person.employeeNumber) : [], [activeAnalysisPeople, hasActiveAnalysisContext]);
  const repeatableMessageIds = useMemo(() => streaming || selectionLoading ? [] : messages.flatMap((message) => (
    message.role === "assistant" && resolveRepeatTarget(message.id) ? [message.id] : []
  )), [conversation, messages, resolveRepeatTarget, selectionLoading, streaming]);

  const value = useMemo<AssistantContextValue>(() => ({
    ready, conversations, hasMoreConversations: Boolean(conversationCursor), conversation, messages, repeatableMessageIds, hasMoreMessages: Boolean(messageCursor), sources, revealedSourceIds, events, actions, actionOutputs, resolvingActionIds, snapshots, documents, indexJobs,
    streaming, selectionLoading, conversationTransitionPending, announcement, notice, error, createGeneralConversation, loadMoreConversations, selectConversation, renameConversation, archiveConversation, deleteConversation,
    loadMoreMessages, send, stop, retryResponse, regenerateResponse, copyResponse, acceptAction, rejectAction, convertToActiveAnalysis, associatePerson, continuePersonInAssistant, addPerson, removePerson, setPrimaryPerson,
    requestPersonProfile, openModelSettings, updateConversationPreferences, selectConversationModel, availablePersonIds, activeAnalysisSummary: activeAnalysis && activeAnalysisResult ? { registroFileName: activeAnalysis.registroFileName, pdfCount: activeAnalysis.pdfCount, uniquePeople: activeAnalysisResult.summary?.uniquePeople ?? (hasActiveAnalysisContext ? activeAnalysisPeople?.length ?? 0 : 0), periods: hasActiveAnalysisContext ? [...new Set((activeAnalysisPeople ?? []).flatMap((person) => person.periods ?? []))].sort() : [] } : undefined, people: hasActiveAnalysisContext ? activeAnalysisPeople ?? [] : [], canSend: Boolean(adapter) || Boolean(conversation && providerConfigs.some((provider) => provider.id === conversation.providerId && provider.enabled) && modelCatalog.some((entry) => entry.providerId === conversation.providerId && entry.canonicalModelId === conversation.modelId && modelCompatibility(entry, conversation.type).selectable)), providerConfigs, modelCatalog, modelPreferences, checkingCompatibilityEntryIds, saveProviderConfig, deleteProviderConfig, checkProvider, refreshProviderCatalog, checkModelCompatibility, toggleModelFavorite, assistantSettings,
    updateAssistantSettings, clearAssistantContent,
  }), [acceptAction, actionOutputs, actions, activeAnalysis, activeAnalysisPeople, activeAnalysisResult, adapter, addPerson, announcement, archiveConversation, assistantSettings, associatePerson, availablePersonIds, hasActiveAnalysisContext, checkModelCompatibility, checkProvider, checkingCompatibilityEntryIds, clearAssistantContent, conversation, conversationCursor, conversations, deleteProviderConfig, documents,
    convertToActiveAnalysis, continuePersonInAssistant, copyResponse, createGeneralConversation, deleteConversation, error, events, loadMoreConversations,
    loadMoreMessages, messageCursor, messages, modelCatalog, modelPreferences, notice, openModelSettings, providerConfigs, refreshProviderCatalog, regenerateResponse, removePerson, renameConversation, repeatableMessageIds, requestPersonProfile, retryResponse,
    conversationTransitionPending, indexJobs, rejectAction, revealedSourceIds, resolvingActionIds, saveProviderConfig, selectConversation, selectConversationModel, selectionLoading, send, setPrimaryPerson, snapshots, sources, stop, streaming, toggleModelFavorite, updateAssistantSettings, updateConversationPreferences]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant debe usarse dentro de AssistantProvider");
  return value;
}

export function useOptionalAssistant(): AssistantContextValue | undefined {
  return useContext(AssistantContext);
}
