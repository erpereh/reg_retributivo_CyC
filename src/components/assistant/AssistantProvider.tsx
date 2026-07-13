"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  sanitizeChatContent, type AssistantSettings, type ChatAction, type ChatEvent, type ChatMessage,
  type ContextStrategy, type Conversation, type ModelProfile, type PersistedDocumentMetadata, type ResponseMode, type SourceReference,
} from "@/lib/assistant/domain";
import { createEphemeralKeyVault, type EphemeralKeyScope } from "@/lib/assistant/providers/ephemeralKeyVault";
import { FakeAssistantAdapter, GENERAL_RETRIBUTIVO_PROMPT } from "@/lib/assistant/providers/fakeAdapter";
import { DEFAULT_ASSISTANT_SETTINGS, assistantSettingsSchema, modelProfileSchema } from "@/lib/assistant/schemas";
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
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";

const FAKE_MODEL_ID = "fake-retributivo-v1";
const CONVERSATION_PAGE_SIZE = 10;
const MESSAGE_PAGE_SIZE = 40;
const STREAM_BATCH_MS = 160;
const now = () => new Date().toISOString();
const createId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const withoutUndefined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const newestConversations = (items: readonly Conversation[]) => [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));

function repairAssistantSettings(settings: AssistantSettings, profiles: readonly ModelProfile[]): AssistantSettings {
  const general = profiles.find((profile) => profile.id === settings.defaultGeneralModelProfileId);
  const analysis = profiles.find((profile) => profile.id === settings.defaultAnalysisModelProfileId);
  return {
    ...settings,
    defaultGeneralModelProfileId: general?.enabled && general.generalChatCompatible ? general.id : undefined,
    defaultAnalysisModelProfileId: analysis?.enabled && analysis.analysisCompatible ? analysis.id : undefined,
  };
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
  updateConversationPreferences(patch: { modelProfileId?: string; responseMode?: ResponseMode; contextStrategy?: ContextStrategy }): Promise<void>;
  availablePersonIds: string[];
  modelProfiles: ModelProfile[];
  assistantSettings: AssistantSettings;
  saveModelProfile(profile: ModelProfile): Promise<void>;
  duplicateModelProfile(id: string): Promise<void>;
  deleteModelProfile(id: string): Promise<void>;
  updateAssistantSettings(patch: Partial<Omit<AssistantSettings, "id">>): Promise<void>;
  clearAssistantContent(): Promise<void>;
  setKey(scope: EphemeralKeyScope, value: string): void;
  clearKey(): void;
  withKey<T>(scope: EphemeralKeyScope, callback: (key: string | undefined) => T | Promise<T>): Promise<T>;
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
  const adapterRef = useRef<AssistantAdapter>(adapter ?? new FakeAssistantAdapter());
  const pendingFakeRequestRef = useRef<PendingFakeRequest | undefined>(undefined);
  const repeatableRunsRef = useRef(new Map<string, PendingFakeRequest>());
  const vaultRef = useRef(createEphemeralKeyVault());
  const assistantSettingsRef = useRef<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);
  const modelProfilesRef = useRef<ModelProfile[]>([]);
  const configurationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const conversationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const selectionIntentSequenceRef = useRef(0);
  const selectionIntentRef = useRef<SelectionIntent | undefined>(undefined);
  const createInFlightRef = useRef<SelectionIntent | undefined>(undefined);
  const contentGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const conversationPageGenerationRef = useRef(0);
  const conversationPageLoadingRef = useRef(false);
  const runGenerationsRef = useRef(new Map<string, number>());
  const deletedConversationsRef = useRef(new Set<string>());
  const activeRunTokenRef = useRef<RunToken | undefined>(undefined);
  const conversationRef = useRef<Conversation | undefined>(undefined);
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const currentAnalysisVersionRef = useRef<{ analysisId: string; analysisVersion: string } | undefined>(undefined);
  const resolvingActionIdsRef = useRef(new Set<string>());
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
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);

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
    const snapshot = await createAnalysisVersionSnapshot(activeAnalysis.id, activeAnalysis, now());
    try {
      const repositories = repositoriesRef.current;
      if (!repositories) return undefined;
      await repositories.syncAnalysisVersion({ snapshot, analysisId: activeAnalysis.id, updatedAt: now() });
    } catch {
      return undefined;
    }
    currentAnalysisVersionRef.current = { analysisId: activeAnalysis.id, analysisVersion: snapshot.analysisVersion };
    return snapshot.analysisVersion;
  }, [activeAnalysis]);

  const clearSelected = useCallback(() => {
    selectionIntentRef.current = undefined;
    createInFlightRef.current = undefined;
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
      setEvents(selectedEvents);
      setActions(selectedActions);
      setActionOutputs({});
      setSnapshots(selectedSnapshots);
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
        orchestratorRef.current = createRepositoryBoundAssistantOrchestrator({
          transport: async (body, signal) => {
            if (body.modelProfileId !== FAKE_MODEL_ID && !adapter) {
              const profile = body.profile as ModelProfile | undefined;
              const scope = { profileId: String(body.modelProfileId), endpoint: profile?.baseUrl ?? "" };
              return vaultRef.current.withKey(scope, (apiKey) => fetch("/api/assistant/chat", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify(withoutUndefined({ ...body, ...(apiKey ? { apiKey } : {}) })), signal,
              }));
            }
            const pending = pendingFakeRequestRef.current;
            if (!pending) throw new Error("No hay una solicitud local preparada.");
            const stream = pending.kind === "general" ? adapterRef.current.streamGeneral(pending.request) : adapterRef.current.streamPersonProfile(pending.request);
            return localIterableResponse(stream, String(body.roundId), signal);
          },
          registry: { names: [], execute: async () => { throw new Error("Herramienta no disponible."); } } as unknown as AnalysisToolRegistry,
        }, repositories);
        const [storedProfiles, storedSettings, conversationPage] = await Promise.all([
          repositories.modelProfiles.listAll(),
          repositories.assistantSettings.get(DEFAULT_ASSISTANT_SETTINGS.id),
          repositories.conversations.list({ limit: CONVERSATION_PAGE_SIZE }),
        ]);
        const restoredProfiles = storedProfiles.flatMap((profile) => {
          const parsed = modelProfileSchema.safeParse(profile);
          return parsed.success ? [parsed.data] : [];
        });
        const parsedSettings = assistantSettingsSchema.safeParse({ ...DEFAULT_ASSISTANT_SETTINGS, ...storedSettings });
        const repairedSettings = repairAssistantSettings(parsedSettings.success ? parsedSettings.data : DEFAULT_ASSISTANT_SETTINGS, restoredProfiles);
        if (cancelled) return;
        modelProfilesRef.current = restoredProfiles;
        assistantSettingsRef.current = repairedSettings;
        setModelProfiles(restoredProfiles);
        setAssistantSettings(repairedSettings);
        setConversations(conversationPage.items);
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
      repositoriesRef.current?.close();
      repositoriesRef.current = undefined;
      vaultRef.current.clearKey();
    };
  }, [adapter, dbName, factory, loadConversationData, repositoriesFactory]);

  const serializeConfigurationMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = configurationMutationRef.current.then(operation);
    configurationMutationRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

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

  const saveModelProfile = useCallback((profile: ModelProfile) => serializeConfigurationMutation(async () => {
    const safe = withoutUndefined(modelProfileSchema.parse(profile));
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    const nextProfiles = [...modelProfilesRef.current.filter((item) => item.id !== safe.id), safe];
    const nextSettings = repairAssistantSettings(assistantSettingsRef.current, nextProfiles);
    await repositories.writeModelConfiguration({ profile: safe, settings: withoutUndefined(nextSettings) });
    modelProfilesRef.current = nextProfiles; assistantSettingsRef.current = nextSettings;
    if (mountedRef.current) { setModelProfiles(nextProfiles); setAssistantSettings(nextSettings); }
  }), [serializeConfigurationMutation]);

  const duplicateModelProfile = useCallback((id: string) => serializeConfigurationMutation(async () => {
    const original = modelProfilesRef.current.find((profile) => profile.id === id);
    if (!original) return;
    const { verifiedAt: _verifiedAt, lastVerificationError: _lastVerificationError, ...copyable } = original;
    const safe = withoutUndefined(modelProfileSchema.parse({ ...copyable, id: createId("model-profile"), name: `${original.name} (copia)` }));
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    const nextProfiles = [...modelProfilesRef.current, safe];
    await repositories.writeModelConfiguration({ profile: safe, settings: withoutUndefined(assistantSettingsRef.current) });
    modelProfilesRef.current = nextProfiles; if (mountedRef.current) setModelProfiles(nextProfiles);
  }), [serializeConfigurationMutation]);

  const deleteModelProfile = useCallback((id: string) => serializeConfigurationMutation(async () => {
    const profile = modelProfilesRef.current.find((item) => item.id === id);
    if (!profile) return;
    if (profile.provider !== "manual") throw new Error("Solo se pueden eliminar perfiles Manual.");
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    const nextProfiles = modelProfilesRef.current.filter((item) => item.id !== id);
    const nextSettings = repairAssistantSettings(assistantSettingsRef.current, nextProfiles);
    await repositories.writeModelConfiguration({ deleteProfileId: id, settings: withoutUndefined(nextSettings) });
    modelProfilesRef.current = nextProfiles; assistantSettingsRef.current = nextSettings;
    if (mountedRef.current) { setModelProfiles(nextProfiles); setAssistantSettings(nextSettings); }
  }), [serializeConfigurationMutation]);

  const updateAssistantSettings = useCallback((patch: Partial<Omit<AssistantSettings, "id">>) => serializeConfigurationMutation(async () => {
    const parsed = assistantSettingsSchema.parse({ ...assistantSettingsRef.current, ...patch, id: DEFAULT_ASSISTANT_SETTINGS.id });
    const next = repairAssistantSettings(parsed, modelProfilesRef.current);
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
    const defaultProfile = modelProfilesRef.current.find((profile) => profile.id === assistantSettingsRef.current.defaultGeneralModelProfileId && profile.enabled && profile.generalChatCompatible);
    const created: Conversation = {
      id: createId("conversation"), type: "general", title: "Consulta general", associatedPersonIds: [], modelProfileId: defaultProfile?.id ?? FAKE_MODEL_ID,
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
  }, [invalidateConversationRun]);

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
    const authoritative = await repositoriesRef.current?.conversations.get(conversation.id);
    if (!authoritative || authoritative.status !== "active") {
      if (authoritative) { conversationRef.current = authoritative; setConversation(authoritative); setNotice("Esta conversación es histórica y de solo lectura."); }
      else setError("La conversación ya no está disponible.");
      return;
    }
    setError(undefined); setNotice(undefined);
    let content: string;
    try {
      const knownPeople = conversation.type === "analysis" && activeAnalysis && activeAnalysis.id === conversation.analysisId ? activeAnalysis.result.people : [];
      content = sanitizeChatContent(rawText, knownPeople, conversation.type);
    } catch {
      setError("No se puede guardar la pregunta porque contiene una referencia personal no identificada.");
      return;
    }
    const createdAt = now();
    const selectedProfile = modelProfilesRef.current.find((profile) => profile.id === conversation.modelProfileId && profile.enabled
      && (conversation.type === "analysis" ? profile.analysisCompatible : profile.generalChatCompatible));
    const modelProfileId = selectedProfile?.id ?? FAKE_MODEL_ID;
    const modelId = selectedProfile?.modelId ?? FAKE_MODEL_ID;
    const userMessage: ChatMessage = {
      id: createId("message"), conversationId: conversation.id, role: "user", content, status: "completed", contextOrigin: conversation.type,
      modelProfileId, modelId, responseMode: conversation.responseMode, contextStrategy: conversation.contextStrategy,
      ...(conversation.analysisVersion ? { analysisVersion: conversation.analysisVersion } : {}), sourceRefIds: [], actionIds: [], createdAt,
    };
    let nextSources = sources;
    let sourceRefIds: string[] = [];
    const personMatch = /matrícula ([\p{L}\p{N}._-]+)/u.exec(content);
    if (conversation.type === "analysis" && conversation.analysisId && activeAnalysis && personMatch) {
      const profile = executeAssistantToolRequest({ tool: "getPersonProfile", args: { analysisId: conversation.analysisId, personId: personMatch[1] } }, activeAnalysis, conversation.id);
      pendingFakeRequestRef.current = { kind: "profile", request: { messageId: "pending", totals: profile.totals, source: profile.source } };
      nextSources = [...sources.filter((item) => item.id !== profile.source.id), profile.source];
      sourceRefIds = [profile.source.id];
    } else {
      pendingFakeRequestRef.current = { kind: "general", request: { systemPrompt: GENERAL_RETRIBUTIVO_PROMPT, question: content, messageId: "pending" } };
    }
    const assistantMessage: ChatMessage = {
      ...userMessage, id: createId("message"), role: "assistant", content: "", status: "streaming", sourceRefIds, createdAt: now(),
    };
    const runToken = beginConversationRun(conversation.id);
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
      const pending = pendingFakeRequestRef.current!;
      pendingFakeRequestRef.current = pending.kind === "general"
        ? { kind: "general", request: { ...pending.request, messageId: assistantMessage.id } }
        : { kind: "profile", request: { ...pending.request, messageId: assistantMessage.id } };
      runPending = pendingFakeRequestRef.current;
      repeatableRunsRef.current.set(assistantMessage.id, runPending);
      const compatibleDefaultProfile = modelProfilesRef.current.find((profile) => profile.id === (conversation.type === "analysis" ? assistantSettingsRef.current.defaultAnalysisModelProfileId : assistantSettingsRef.current.defaultGeneralModelProfileId));
      const result = await orchestratorRef.current!.send({
        conversationId: conversation.id, ...(conversation.type === "analysis" ? { analysisId: conversation.analysisId } : {}), question: content, assistantMessageId: assistantMessage.id,
        modelProfileId, modelId, ...(selectedProfile ? { profile: selectedProfile } : {}), ...(compatibleDefaultProfile ? { compatibleDefaultProfile } : {}),
        responseMode: conversation.responseMode, contextStrategy: conversation.contextStrategy, onTextDelta,
      });
      if (!runIsCurrent()) return;
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = undefined;
      const producedMessages = result.producedMessages.map((produced, index) => ({
        ...assistantMessage,
        id: produced.id,
        content: produced.content,
        status: produced.status,
        modelProfileId: produced.modelProfileId,
        modelId: produced.modelId,
        createdAt: new Date(Date.parse(assistantMessage.createdAt) + index).toISOString(),
      }));
      const completed = producedMessages.at(-1) ?? { ...assistantMessage, content: result.text, status: "completed" as const };
      const persisted = await persistRunRound(conversation.id, [...baseMessages, userMessage, ...producedMessages], nextSources, runIsCurrent);
      if (persisted && runIsCurrent()) { setNotice("Respuesta completada"); setAnnouncement(`Respuesta completada: ${completed.content}`); }
    } catch (caught) {
      if (!runIsCurrent()) return;
      flushPartial();
      const stopped = caught instanceof AssistantRunStoppedError;
      const terminal = { ...assistantMessage, content: stopped ? caught.partialText : partialText, status: stopped ? "stopped" as const : "failed" as const };
      const persisted = await persistRunRound(conversation.id, [...baseMessages, userMessage, terminal], nextSources, runIsCurrent).catch(() => false);
      if (persisted && runIsCurrent()) {
        if (stopped) { setNotice("Respuesta detenida"); setAnnouncement(`Respuesta detenida: ${terminal.content}`); }
        else { setError("No se pudo completar la respuesta del Asistente."); setAnnouncement("La respuesta ha fallado"); }
      } else if (!stopped && runIsCurrent()) {
        setError("No se pudo completar la respuesta del Asistente.");
        setAnnouncement("La respuesta ha fallado");
      }
    } finally {
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = undefined;
      if (pendingFakeRequestRef.current === runPending) pendingFakeRequestRef.current = undefined;
      if (runIsCurrent()) setStreaming(false);
      if (activeRunTokenRef.current === runToken) activeRunTokenRef.current = undefined;
    }
  }, [activeAnalysis, beginConversationRun, conversation, isConversationRunCurrent, messages, persistRunRound, selectionLoading, sources, streaming]);

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
    if (target.modelProfileId === FAKE_MODEL_ID) {
      if (!pending) return undefined;
      return { selected, target, precedingUser, modelProfileId: FAKE_MODEL_ID, modelId: FAKE_MODEL_ID, pending };
    }

    const selectedProfile = modelProfilesRef.current.find((profile) => profile.id === target.modelProfileId && profile.enabled
      && (selected.type === "analysis" ? profile.analysisCompatible : profile.generalChatCompatible));
    if (!selectedProfile || (adapter && !pending)) return undefined;
    return { selected, target, precedingUser, modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, selectedProfile, pending };
  }, [adapter]);

  const repeatResponse = useCallback(async (messageId: string, mode: "retry" | "regenerate") => {
    const repeatTarget = resolveRepeatTarget(messageId);
    const orchestrator = orchestratorRef.current;
    if (!repeatTarget || !orchestrator || streaming || selectionLoading) return;
    const authoritative = await repositoriesRef.current?.conversations.get(repeatTarget.selected.id);
    if (!authoritative || authoritative.status !== "active") return;
    const { selected, target, precedingUser, modelProfileId, modelId, selectedProfile } = repeatTarget;
    const pending = repeatTarget.pending;
    let runPending: PendingFakeRequest | undefined;
    if (pending) {
      pendingFakeRequestRef.current = pending.kind === "general"
        ? { kind: "general", request: { ...pending.request, question: precedingUser.content, messageId: target.id } }
        : { kind: "profile", request: { ...pending.request, messageId: target.id } };
      runPending = pendingFakeRequestRef.current;
      repeatableRunsRef.current.set(target.id, runPending);
    }
    const compatibleDefaultProfile = modelProfilesRef.current.find((profile) => profile.id === (selected.type === "analysis" ? assistantSettingsRef.current.defaultAnalysisModelProfileId : assistantSettingsRef.current.defaultGeneralModelProfileId));
    const canContinue = mode === "retry" && (target.status === "stopped" || target.status === "interrupted")
      && target.content.trim().length > 0 && (modelProfileId !== FAKE_MODEL_ID || Boolean(adapter));
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
        conversationId: selected.id, ...(selected.type === "analysis" ? { analysisId: selected.analysisId } : {}), question: precedingUser.content,
        assistantMessageId: target.id, modelProfileId, modelId, ...(selectedProfile ? { profile: selectedProfile } : {}),
        ...(compatibleDefaultProfile ? { compatibleDefaultProfile } : {}), responseMode: target.responseMode, contextStrategy: target.contextStrategy,
        ...(canContinue ? { resumeFrom: { messageId: target.id, context: target.content } } : {}), onTextDelta,
      });
      if (!runIsCurrent()) return;
      generated = result.text;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const content = rendered();
      const nextMessages = messagesRef.current.map((message) => message.id === messageId ? { ...message, content, status: "completed" as const } : message);
      const persisted = await persistRunRound(selected.id, nextMessages, sources, runIsCurrent);
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
        if (runIsCurrent()) { setError("No se pudo completar la respuesta del Asistente."); setAnnouncement("La respuesta ha fallado"); }
      }
    } finally {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (pendingFakeRequestRef.current === runPending) pendingFakeRequestRef.current = undefined;
      if (runIsCurrent()) setStreaming(false);
      if (activeRunTokenRef.current === runToken) activeRunTokenRef.current = undefined;
    }
  }, [adapter, beginConversationRun, isConversationRunCurrent, persistRunRound, resolveRepeatTarget, selectionLoading, sources, streaming]);
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
    if (createInFlightRef.current) return;
    const selectedId = conversationRef.current?.id;
    if (!selectedId || conversationRef.current?.status !== "active" || !activeAnalysis || deletedConversationsRef.current.has(selectedId)) return;
    const analysis = activeAnalysis;
    const analysisVersion = await ensureActiveAnalysisVersion();
    if (!analysisVersion) return;
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
          setNotice("Análisis activo asociado");
          setAnnouncement("Análisis activo asociado");
        }
      }
      return true;
    });
    conversationMutationRef.current = operation.then(() => undefined, () => undefined);
    await operation;
  }, [activeAnalysis, ensureActiveAnalysisVersion]);

  const continuePersonInAssistant = useCallback(async (personId: string) => {
    const repositories = repositoriesRef.current;
    if (!ready || !repositories || !activeAnalysis || !activeAnalysis.result.people.some((person) => person.employeeNumber === personId)) {
      const message = "No se puede continuar en el Asistente porque el análisis o la matrícula ya no están disponibles.";
      setError(message); throw new Error(message);
    }
    const analysisVersion = await ensureActiveAnalysisVersion();
    if (!analysisVersion) { const message = "No se puede continuar en el Asistente porque el análisis ya no está disponible."; setError(message); throw new Error(message); }
    const operation = conversationMutationRef.current.then(() => continuePerson({
      repositories, analysisId: activeAnalysis.id, analysisVersion, personId,
      modelProfileId: assistantSettingsRef.current.defaultAnalysisModelProfileId ?? FAKE_MODEL_ID, now: now(),
    }));
    conversationMutationRef.current = operation.then(() => undefined, () => undefined);
    const selected = await operation;
    setConversations((current) => newestConversations([selected, ...current.filter((item) => item.id !== selected.id)]));
    await loadConversationData(selected);
    setNotice(`Matrícula asociada: ${personId}`);
    setAnnouncement(`Matrícula ${personId} asociada al Asistente`);
  }, [activeAnalysis, ensureActiveAnalysisVersion, loadConversationData, ready]);

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

  const updateConversationPreferences = useCallback(async (patch: { modelProfileId?: string; responseMode?: ResponseMode; contextStrategy?: ContextStrategy }) => {
    await updateSelectedConversation(patch);
  }, [updateSelectedConversation]);

  const availablePersonIds = useMemo(() => conversation?.type === "analysis" && activeAnalysis && activeAnalysis.id === conversation.analysisId
    ? activeAnalysis.result.people.map((person) => person.employeeNumber) : [], [activeAnalysis, conversation]);
  const repeatableMessageIds = useMemo(() => streaming || selectionLoading ? [] : messages.flatMap((message) => (
    message.role === "assistant" && resolveRepeatTarget(message.id) ? [message.id] : []
  )), [conversation, messages, modelProfiles, resolveRepeatTarget, selectionLoading, streaming]);

  const value = useMemo<AssistantContextValue>(() => ({
    ready, conversations, hasMoreConversations: Boolean(conversationCursor), conversation, messages, repeatableMessageIds, hasMoreMessages: Boolean(messageCursor), sources, revealedSourceIds, events, actions, actionOutputs, resolvingActionIds, snapshots, documents, indexJobs,
    streaming, selectionLoading, conversationTransitionPending, announcement, notice, error, createGeneralConversation, loadMoreConversations, selectConversation, renameConversation, archiveConversation, deleteConversation,
    loadMoreMessages, send, stop, retryResponse, regenerateResponse, copyResponse, acceptAction, rejectAction, convertToActiveAnalysis, associatePerson, continuePersonInAssistant, addPerson, removePerson, setPrimaryPerson,
    requestPersonProfile, updateConversationPreferences, availablePersonIds, modelProfiles, assistantSettings, saveModelProfile, duplicateModelProfile,
    deleteModelProfile, updateAssistantSettings, clearAssistantContent, setKey: vaultRef.current.setKey, clearKey: vaultRef.current.clearKey, withKey: vaultRef.current.withKey,
  }), [acceptAction, actionOutputs, actions, addPerson, announcement, archiveConversation, assistantSettings, associatePerson, availablePersonIds, clearAssistantContent, conversation, conversationCursor, conversations, documents,
    convertToActiveAnalysis, continuePersonInAssistant, copyResponse, createGeneralConversation, deleteConversation, deleteModelProfile, duplicateModelProfile, error, events, loadMoreConversations,
    loadMoreMessages, messageCursor, messages, modelProfiles, notice, regenerateResponse, removePerson, renameConversation, repeatableMessageIds, requestPersonProfile, retryResponse,
    conversationTransitionPending, indexJobs, rejectAction, revealedSourceIds, resolvingActionIds, saveModelProfile, selectConversation, selectionLoading, send, setPrimaryPerson, snapshots, sources, stop, streaming, updateAssistantSettings, updateConversationPreferences]);

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
