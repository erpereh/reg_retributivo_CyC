import { describe, expect, test } from "vitest";
import { convertConversationToAnalysis, sanitizeChatContent } from "@/lib/assistant/domain";
import {
  chatMessageSchema,
  conversationSchema,
  documentScopeSchema,
  sourceReferenceSchema,
} from "@/lib/assistant/schemas";

const conversation = {
  id: "conversation-1",
  type: "general" as const,
  title: "Consulta general",
  associatedPersonIds: [],
  modelProfileId: "fake-model",
  responseMode: "strict" as const,
  contextStrategy: "automatic" as const,
  status: "active" as const,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
};

describe("assistant domain", () => {
  test("rejects analysis conversations without exactly one analysis id", () => {
    expect(() => conversationSchema.parse({ ...conversation, type: "analysis" })).toThrow();
    expect(() => conversationSchema.parse({ ...conversation, analysisId: "analysis-1" })).toThrow();
    expect(conversationSchema.parse(conversation)).toEqual(conversation);
  });

  test("converts a general conversation once and preserves prior message origins", () => {
    const messages = [
      {
        id: "message-1",
        conversationId: conversation.id,
        role: "user" as const,
        content: "Qué es Cuadre Reg.",
        status: "completed" as const,
        contextOrigin: "general" as const,
        modelProfileId: "fake-model",
        responseMode: "strict" as const,
        contextStrategy: "automatic" as const,
        sourceRefIds: [],
        actionIds: [],
        createdAt: conversation.createdAt,
      },
    ];

    const converted = convertConversationToAnalysis(conversation, messages, "analysis-1", "v1", "2026-07-13T11:00:00.000Z");
    expect(converted.conversation).toMatchObject({ type: "analysis", analysisId: "analysis-1", analysisVersion: "v1" });
    expect(converted.messages[0].contextOrigin).toBe("general");
    expect(converted.event.event).toEqual({ type: "context_added", contextId: "analysis-1", label: "Análisis activo" });
    expect(() => convertConversationToAnalysis(converted.conversation, messages, "analysis-2", "v2")).toThrow(/otra conversación/i);
  });

  test.each(["streaming", "completed", "stopped", "interrupted", "failed"])("accepts the %s message status", (status) => {
    expect(chatMessageSchema.parse({
      id: "message-1",
      conversationId: conversation.id,
      role: "assistant",
      content: "Respuesta",
      status,
      contextOrigin: "general",
      modelProfileId: "fake-model",
      responseMode: "strict",
      contextStrategy: "automatic",
      sourceRefIds: [],
      actionIds: [],
      createdAt: conversation.createdAt,
    }).status).toBe(status);
  });

  test("accepts only analysis or conversation document scopes", () => {
    expect(documentScopeSchema.parse({ type: "analysis", analysisId: "analysis-1" })).toBeTruthy();
    expect(documentScopeSchema.parse({ type: "conversation", conversationId: "conversation-1" })).toBeTruthy();
    expect(() => documentScopeSchema.parse({ type: "analysis", conversationId: "conversation-1" })).toThrow();
  });

  test.each(["available", "historical_unavailable", "deleted"])("accepts the %s source availability", (availability) => {
    expect(sourceReferenceSchema.parse({
      id: "source-1",
      conversationId: conversation.id,
      sourceType: "person_profile",
      sanitizedSourceLabel: "Persona matrícula 10048",
      availability,
      personId: "10048",
      conceptIds: [],
      excerpt: "Totales calculados localmente",
      sanitizedHash: "safe-hash",
    }).availability).toBe(availability);
  });

  test("rejects free text with DNI, email and phone instead of trying to redact it", () => {
    expect(() => sanitizeChatContent("Mi DNI es 12345678Z, correo ana@example.com y teléfono 612 345 678", [], "general"))
      .toThrow("El contenido contiene datos sensibles no permitidos.");
  });

  test("fails closed for an unknown personal name", () => {
    expect(() => sanitizeChatContent("La persona Ana García tiene diferencias", [], "general")).toThrow("El contenido contiene datos sensibles no permitidos.");
  });

  test("replaces a known name only when explicitly supplied after conversion", () => {
    expect(sanitizeChatContent("Revisa a Ana García", [{ employeeNumber: "10048", person: "Ana García" }], "analysis"))
      .toBe("Revisa a matrícula 10048");
  });

  test.each([
    "Revisa a Ana García",
    "Juan Pérez cobra más este mes",
    "La persona Ana tiene diferencias",
    "El nombre Juan aparece en el recibo",
  ])("fails closed for free or simply labelled names: %s", (content) => {
    let error: Error | undefined;
    try { sanitizeChatContent(content, [], "general"); } catch (caught) { error = caught as Error; }
    expect(error?.message).toBe("El contenido contiene datos sensibles no permitidos.");
    expect(error?.message).not.toContain(content);
  });

  test.each([
    "Domicilio: Calle Alcalá 42, Madrid",
    "Dirección Avenida del Puerto 10",
    "Adjunto nomina_ana.pdf",
    String.raw`Ruta C:\Users\ana\nomina.xlsx`,
    String.raw`Ruta c:\vault\ana\secreto`,
    "Ruta /home/ana/nomina.csv",
    "Ruta /private/ana/secreto",
    "Vive en C/ Mayor 10",
    "api_key=sk-supersecret123456",
    "OPENAI_API_KEY=private-value-123",
    "Authorization: Bearer private-token-value",
    "Abre ./docs/nominas.zip",
    "Consulta documentos/nominas.zip",
    "password=hunter2",
    "-----BEGIN PRIVATE KEY-----",
    "xoxb-private-slack-token",
  ])("fails closed for locations, files, paths or secrets without echoing the value: %s", (content) => {
    let error: Error | undefined;
    try { sanitizeChatContent(content, [], "general"); } catch (caught) { error = caught as Error; }
    expect(error?.message).toBe("El contenido contiene datos sensibles no permitidos.");
    expect(error?.message).not.toContain(content);
  });

  test.each([
    "¿Qué es Retributivo?",
    "¿Qué es Cuadre Reg.?",
    "¿Qué compara el Registro Retributivo con los Recibos?",
  ])("allows an exact approved general prompt: %s", (content) => {
    expect(sanitizeChatContent(content, [], "general")).toBe(content);
  });

  test.each([
    "Explica Cuadre Reg., Conceptos y Agrupaciones",
    "¿Cómo funciona Retributivo?",
    "juan pérez cobra más",
    "persona ana tiene diferencias",
    "Revisa a matrícula 10048",
    "Consulta la matrícula 10048",
  ])("rejects every non-approved general prompt: %s", (content) => {
    expect(() => sanitizeChatContent(content, [], "general")).toThrow("El contenido contiene datos sensibles no permitidos.");
  });

  test.each(["Revisa a matrícula 10048", "Consulta la matrícula 10048"])("allows an exact structured analysis template: %s", (content) => {
    expect(sanitizeChatContent(content, [{ employeeNumber: "10048", person: "Ana García" }], "analysis")).toBe(content);
  });
});
