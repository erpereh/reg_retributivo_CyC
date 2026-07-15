// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";

test("shows an unknown context window instead of inventing one million tokens", () => {
  render(<AssistantComposer
    streaming={false}
    conversation={{ id: "c1", type: "general", title: "Consulta general", associatedPersonIds: [], modelProfileId: "p1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z" }}
    profiles={[{ id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "missing-model", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, capabilitiesSource: "detected", detectedModels: [{ id: "gemini-flash", displayName: "Gemini Flash", contextWindow: 1_048_576, supportedMethods: ["generateContent"] }] }]}
    contextTokens={12}
    onSend={vi.fn(async () => undefined)}
    onStop={vi.fn()}
    onPreferences={vi.fn()}
  />);

  expect(screen.getByRole("button", { name: "Abrir detalle del contexto" })).toHaveTextContent("12 / —");
});
