// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationTimeline } from "@/components/assistant/ConversationTimeline";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";
import type { ChatMessage, Conversation } from "@/lib/assistant/domain";

const createdAt = "2026-07-16T20:00:00.000Z";
const conversation: Conversation = { id: "c1", type: "general", title: "Consulta", associatedPersonIds: [], responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt, updatedAt: createdAt };
function message(id: string, role: "user" | "assistant", content: string): ChatMessage {
  return { id, conversationId: "c1", role, content, status: "completed", contextOrigin: "general", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic", sourceRefIds: [], actionIds: [], createdAt };
}

describe("ConversationTimeline", () => {
  it("renders a legacy user question before its assistant response when timestamps are equal", () => {
    const assistant = {
      conversation,
      messages: [message("assistant-a", "assistant", "Respuesta posterior"), message("user-z", "user", "Pregunta primero")],
      events: [], sources: [], actions: [], actionOutputs: {}, resolvingActionIds: [], repeatableMessageIds: [], revealedSourceIds: [],
      streaming: false, selectionLoading: false, conversationTransitionPending: false, canSend: false, announcement: "", error: undefined,
      hasMoreMessages: false, modelCatalog: [], providerConfigs: [], modelPreferences: { favoriteEntryIds: [], recentEntryIds: [] }, checkingCompatibilityEntryIds: [],
      convertToActiveAnalysis: vi.fn(), createGeneralConversation: vi.fn(), loadMoreMessages: vi.fn(), copyResponse: vi.fn(), retryResponse: vi.fn(), regenerateResponse: vi.fn(), acceptAction: vi.fn(), rejectAction: vi.fn(), send: vi.fn(), stop: vi.fn(), selectConversationModel: vi.fn(), toggleModelFavorite: vi.fn(), checkModelCompatibility: vi.fn(), updateConversationPreferences: vi.fn(), openModelSettings: vi.fn(),
    } as unknown as AssistantContextValue;

    const { container } = render(<ConversationTimeline assistant={assistant} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Pregunta primero")).toBeLessThan(text.indexOf("Respuesta posterior"));
  });
});
