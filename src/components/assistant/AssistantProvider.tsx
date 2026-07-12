"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { convertConversationToAnalysis, sanitizeChatContent, type ChatEvent, type ChatMessage, type Conversation, type SourceReference } from "@/lib/assistant/domain";
import { FakeAssistantAdapter, GENERAL_RETRIBUTIVO_PROMPT } from "@/lib/assistant/providers/fakeAdapter";
import { IncrementalNdjsonDecoder } from "@/lib/assistant/streamProtocol";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { executeAssistantToolRequest } from "@/lib/assistant/tools/personTools";
import type { StoredAnalysis } from "@/lib/types";

const FAKE_MODEL_ID = "fake-retributivo-v1";
const now = () => new Date().toISOString();
const createId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

interface AssistantContextValue {
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
  const [ready, setReady] = useState(false);
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void createIndexedDbRepositories({ factory, dbName }).then(async (repositories) => {
      if (cancelled) return repositories.close();
      repositoriesRef.current = repositories;
      const conversationPage = await repositories.conversations.list({ limit: 1 });
      const restored = conversationPage.items[0];
      if (restored) {
        const messagePage = await repositories.messages.listByConversation(restored.id, { limit: 100 });
        setConversation(restored);
        setMessages(messagePage.items);
        const restoredSources = await Promise.all(messagePage.items.flatMap((item) => item.sourceRefIds).map((id) => repositories.sources.get(id)));
        setSources(restoredSources.filter((item): item is SourceReference => Boolean(item)));
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
      repositoriesRef.current?.close();
      repositoriesRef.current = undefined;
    };
  }, [dbName, factory]);

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
      contextStrategy: conversation.contextStrategy, analysisVersion: conversation.analysisVersion, sourceRefIds: [], actionIds: [], createdAt,
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
      analysisVersion: conversation.analysisVersion, sourceRefIds: [profile.source.id], actionIds: [], createdAt: now(),
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
  }), [activeAnalysis, associatePerson, conversation, convertToActiveAnalysis, createGeneralConversation, error, messages, notice, ready, requestPersonProfile, send, sources, streaming]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant debe usarse dentro de AssistantProvider");
  return value;
}
