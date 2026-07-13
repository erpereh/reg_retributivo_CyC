"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { convertConversationToAnalysis, sanitizeChatContent, type AssistantSettings, type ChatEvent, type ChatMessage, type Conversation, type ModelProfile, type SourceReference } from "@/lib/assistant/domain";
import { createEphemeralKeyVault, type EphemeralKeyScope } from "@/lib/assistant/providers/ephemeralKeyVault";
import { FakeAssistantAdapter, GENERAL_RETRIBUTIVO_PROMPT } from "@/lib/assistant/providers/fakeAdapter";
import { DEFAULT_ASSISTANT_SETTINGS, assistantSettingsSchema, modelProfileSchema } from "@/lib/assistant/schemas";
import { IncrementalNdjsonDecoder } from "@/lib/assistant/streamProtocol";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { executeAssistantToolRequest } from "@/lib/assistant/tools/personTools";
import type { StoredAnalysis } from "@/lib/types";

const FAKE_MODEL_ID = "fake-retributivo-v1";
const now = () => new Date().toISOString();
const createId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const withoutUndefined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

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
  conversation?: Conversation;
  messages: ChatMessage[];
  sources: SourceReference[];
  streaming: boolean;
  notice?: string;
  error?: string;
  createGeneralConversation(): Promise<void>;
  send(rawText: string): Promise<void>;
  convertToActiveAnalysis(): Promise<void>;
  associatePerson(personId: string): Promise<void>;
  requestPersonProfile(): Promise<void>;
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

export function AssistantProvider({ children, activeAnalysis, factory, dbName, adapter }: Readonly<{
  children: ReactNode; activeAnalysis?: StoredAnalysis; factory?: IDBFactory; dbName?: string; adapter?: AssistantAdapter;
}>) {
  const repositoriesRef = useRef<AssistantRepositories | undefined>(undefined);
  const adapterRef = useRef<AssistantAdapter>(adapter ?? new FakeAssistantAdapter());
  const vaultRef = useRef(createEphemeralKeyVault());
  const assistantSettingsRef = useRef<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);
  const modelProfilesRef = useRef<ModelProfile[]>([]);
  const configurationMutationRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>(DEFAULT_ASSISTANT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    void (async () => {
      let repositories: AssistantRepositories | undefined;
      try {
        repositories = await createIndexedDbRepositories({ factory, dbName });
        if (cancelled) { repositories.close(); return; }
        repositoriesRef.current = repositories;
        const restoredProfiles = (await repositories.modelProfiles.listAll()).flatMap((profile) => {
          const parsed = modelProfileSchema.safeParse(profile);
          return parsed.success ? [parsed.data] : [];
        });
        if (cancelled) return;
        const storedSettings = await repositories.assistantSettings.get(DEFAULT_ASSISTANT_SETTINGS.id);
        if (cancelled) return;
        const parsedSettings = assistantSettingsSchema.safeParse({ ...DEFAULT_ASSISTANT_SETTINGS, ...storedSettings });
        const repairedSettings = repairAssistantSettings(parsedSettings.success ? parsedSettings.data : DEFAULT_ASSISTANT_SETTINGS, restoredProfiles);
        modelProfilesRef.current = restoredProfiles;
        assistantSettingsRef.current = repairedSettings;
        setModelProfiles(restoredProfiles);
        setAssistantSettings(repairedSettings);
        const conversationPage = await repositories.conversations.list({ limit: 1 });
        if (cancelled) return;
        const restored = conversationPage.items[0];
        if (restored) {
          const messagePage = await repositories.messages.listByConversation(restored.id, { limit: 100 });
          if (cancelled) return;
          const restoredSources = await Promise.all(messagePage.items.flatMap((item) => item.sourceRefIds).map((id) => repositories!.sources.get(id)));
          if (cancelled) return;
          setConversation(restored);
          setMessages(messagePage.items);
          setSources(restoredSources.filter((item): item is SourceReference => Boolean(item)));
        }
        setReady(true);
      } catch {
        repositories?.close();
        if (!cancelled) setError("No se pudo abrir el almacenamiento local del Asistente.");
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      repositoriesRef.current?.close();
      repositoriesRef.current = undefined;
      vaultRef.current.clearKey();
    };
  }, [dbName, factory]);

  const serializeConfigurationMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = configurationMutationRef.current.then(operation);
    configurationMutationRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const saveModelProfile = useCallback((profile: ModelProfile) => serializeConfigurationMutation(async () => {
    const safe = withoutUndefined(modelProfileSchema.parse(profile));
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    const nextProfiles = [...modelProfilesRef.current.filter((item) => item.id !== safe.id), safe];
    const nextSettings = repairAssistantSettings(assistantSettingsRef.current, nextProfiles);
    await repositories.writeModelConfiguration({ profile: safe, settings: withoutUndefined(nextSettings) });
    modelProfilesRef.current = nextProfiles;
    assistantSettingsRef.current = nextSettings;
    if (mountedRef.current) {
      setModelProfiles(nextProfiles);
      setAssistantSettings(nextSettings);
    }
  }), [serializeConfigurationMutation]);

  const duplicateModelProfile = useCallback((id: string) => serializeConfigurationMutation(async () => {
    const original = modelProfilesRef.current.find((profile) => profile.id === id);
    if (!original) return;
    const { verifiedAt: _verifiedAt, lastVerificationError: _lastVerificationError, ...copyable } = original;
    const duplicate = { ...copyable, id: createId("model-profile"), name: `${original.name} (copia)` };
    const safe = withoutUndefined(modelProfileSchema.parse(duplicate));
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    const nextProfiles = [...modelProfilesRef.current, safe];
    await repositories.writeModelConfiguration({ profile: safe, settings: withoutUndefined(assistantSettingsRef.current) });
    modelProfilesRef.current = nextProfiles;
    if (mountedRef.current) setModelProfiles(nextProfiles);
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
    modelProfilesRef.current = nextProfiles;
    assistantSettingsRef.current = nextSettings;
    if (mountedRef.current) {
      setModelProfiles(nextProfiles);
      setAssistantSettings(nextSettings);
    }
  }), [serializeConfigurationMutation]);

  const updateAssistantSettings = useCallback((patch: Partial<Omit<AssistantSettings, "id">>) => serializeConfigurationMutation(async () => {
    const parsed = assistantSettingsSchema.parse({ ...assistantSettingsRef.current, ...patch, id: DEFAULT_ASSISTANT_SETTINGS.id });
    const next = repairAssistantSettings(parsed, modelProfilesRef.current);
    const repositories = repositoriesRef.current;
    if (!repositories) throw new Error("El almacenamiento local no está disponible.");
    await repositories.assistantSettings.put(withoutUndefined(next));
    assistantSettingsRef.current = next;
    if (mountedRef.current) setAssistantSettings(next);
  }), [serializeConfigurationMutation]);

  const clearAssistantContent = useCallback(async () => {
    await repositoriesRef.current!.clearAssistantContent();
    if (mountedRef.current) {
      setConversation(undefined);
      setMessages([]);
      setSources([]);
    }
  }, []);

  const createGeneralConversation = useCallback(async () => {
    const createdAt = now();
    const created: Conversation = {
      id: createId("conversation"), type: "general", title: "Consulta general", associatedPersonIds: [], modelProfileId: FAKE_MODEL_ID,
      responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt, updatedAt: createdAt,
    };
    await repositoriesRef.current!.conversations.put(created);
    setConversation(created);
    setMessages([]);
    setSources([]);
  }, []);

  const persistRound = useCallback(async (nextConversation: Conversation, nextMessages: ChatMessage[], nextSources: SourceReference[], events: ChatEvent[] = []) => {
    await repositoriesRef.current!.writeConversationBlock({ conversation: nextConversation, messages: nextMessages, sources: nextSources, events });
    setConversation(nextConversation);
    setMessages(nextMessages);
    setSources(nextSources);
  }, []);

  const send = useCallback(async (rawText: string) => {
    if (!conversation || !rawText.trim() || streaming) return;
    setError(undefined);
    let content: string;
    try {
      const knownPeople = conversation.type === "analysis" && activeAnalysis && activeAnalysis.id === conversation.analysisId
        ? activeAnalysis.result.people : [];
      content = sanitizeChatContent(rawText, knownPeople, conversation.type);
    } catch {
      setError("No se puede guardar la pregunta porque contiene una referencia personal no identificada.");
      return;
    }
    const createdAt = now();
    const userMessage: ChatMessage = {
      id: createId("message"), conversationId: conversation.id, role: "user", content, status: "completed",
      contextOrigin: conversation.type, modelProfileId: conversation.modelProfileId, responseMode: conversation.responseMode,
      contextStrategy: conversation.contextStrategy, ...(conversation.analysisVersion ? { analysisVersion: conversation.analysisVersion } : {}), sourceRefIds: [], actionIds: [], createdAt,
    };
    const assistantMessage: ChatMessage = {
      ...userMessage, id: createId("message"), role: "assistant", content: "", status: "streaming", createdAt: now(),
    };
    setStreaming(true);
    try {
      let accumulated = "";
      const decoder = new IncrementalNdjsonDecoder();
      for await (const chunk of adapterRef.current.streamGeneral({ systemPrompt: GENERAL_RETRIBUTIVO_PROMPT, question: content, messageId: assistantMessage.id })) {
        for (const event of decoder.push(chunk)) if (event.type === "text_delta") accumulated += event.delta;
      }
      decoder.finish();
      const completed = { ...assistantMessage, content: accumulated, status: "completed" as const };
      const updated = { ...conversation, updatedAt: now() };
      await persistRound(updated, [...messages, userMessage, completed], sources);
    } catch {
      setError("No se pudo completar la respuesta del Asistente.");
    } finally {
      setStreaming(false);
    }
  }, [activeAnalysis, conversation, messages, persistRound, sources, streaming]);

  const convertToActiveAnalysis = useCallback(async () => {
    if (!conversation || !activeAnalysis || conversation.type !== "general") return;
    const converted = convertConversationToAnalysis(conversation, messages, activeAnalysis.id, activeAnalysis.createdAt);
    await persistRound(converted.conversation, converted.messages, sources, [converted.event]);
    setNotice("Análisis activo asociado");
  }, [activeAnalysis, conversation, messages, persistRound, sources]);

  const associatePerson = useCallback(async (personId: string) => {
    if (!conversation || conversation.type !== "analysis") return;
    const updated = { ...conversation, associatedPersonIds: [personId], primaryPersonId: personId, updatedAt: now() };
    await repositoriesRef.current!.conversations.put(updated);
    setConversation(updated);
  }, [conversation]);

  const requestPersonProfile = useCallback(async () => {
    if (!conversation?.analysisId || !conversation.primaryPersonId || !activeAnalysis) return;
    const profile = executeAssistantToolRequest({ tool: "getPersonProfile", args: { analysisId: conversation.analysisId, personId: conversation.primaryPersonId } }, activeAnalysis, conversation.id);
    const assistantMessage: ChatMessage = {
      id: createId("message"), conversationId: conversation.id, role: "assistant", content: "", status: "streaming", contextOrigin: "analysis",
      modelProfileId: conversation.modelProfileId, responseMode: conversation.responseMode, contextStrategy: conversation.contextStrategy,
      ...(conversation.analysisVersion ? { analysisVersion: conversation.analysisVersion } : {}), sourceRefIds: [profile.source.id], actionIds: [], createdAt: now(),
    };
    setStreaming(true);
    try {
      let accumulated = "";
      const decoder = new IncrementalNdjsonDecoder();
      for await (const chunk of adapterRef.current.streamPersonProfile({ messageId: assistantMessage.id, totals: profile.totals, source: profile.source })) {
        for (const event of decoder.push(chunk)) if (event.type === "text_delta") accumulated += event.delta;
      }
      decoder.finish();
      const completed = { ...assistantMessage, content: accumulated, status: "completed" as const };
      await persistRound({ ...conversation, updatedAt: now() }, [...messages, completed], [...sources, profile.source]);
    } catch {
      setError("No se pudo completar la respuesta del Asistente.");
    } finally {
      setStreaming(false);
    }
  }, [activeAnalysis, conversation, messages, persistRound, sources]);

  const value = useMemo<AssistantContextValue>(() => ({
    ready, conversation, messages, sources, streaming, notice, error, createGeneralConversation, send, convertToActiveAnalysis,
    associatePerson, requestPersonProfile, availablePersonIds: conversation?.type === "analysis" && activeAnalysis && activeAnalysis.id === conversation.analysisId
      ? activeAnalysis.result.people.map((person) => person.employeeNumber) : [],
    modelProfiles, assistantSettings, saveModelProfile, duplicateModelProfile, deleteModelProfile, updateAssistantSettings, clearAssistantContent,
    setKey: vaultRef.current.setKey, clearKey: vaultRef.current.clearKey, withKey: vaultRef.current.withKey,
  }), [activeAnalysis, assistantSettings, associatePerson, clearAssistantContent, conversation, convertToActiveAnalysis, createGeneralConversation, deleteModelProfile, duplicateModelProfile, error, messages, modelProfiles, notice, ready, requestPersonProfile, saveModelProfile, send, sources, streaming, updateAssistantSettings]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant debe usarse dentro de AssistantProvider");
  return value;
}
