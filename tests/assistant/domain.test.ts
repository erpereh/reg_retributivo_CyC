import { describe, expect, test } from "vitest";
import { convertConversationToAnalysis, resolveChatContent, sanitizeChatContent } from "@/lib/assistant/domain";
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

  test("allows normal general chat while keeping known-name replacement for analysis", () => {
    expect(sanitizeChatContent("La persona Ana García tiene diferencias", [{ employeeNumber: "10048", person: "Ana García" }], "general"))
      .toBe("La persona Ana García tiene diferencias");
  });

  test("replaces a known name only when explicitly supplied after conversion", () => {
    expect(sanitizeChatContent("Revisa a Ana García", [{ employeeNumber: "10048", person: "Ana García" }], "analysis"))
      .toBe("Revisa a matrícula 10048");
  });

  test("resolves a unicode-equivalent unique person mention once and returns the same explicit id", () => {
    expect(resolveChatContent("Dime todo de JOSE\u0301  PE\u0301REZ", [
      { employeeNumber: "10048", person: "José Pérez" },
      { employeeNumber: "10050", person: "Ana García" },
    ], "analysis", ["10048"])).toEqual({ content: "Dime todo de matrícula 10048", explicitPersonIds: ["10048"] });
  });

  test("rejects an ambiguous person fragment before producing provider content", () => {
    expect(() => resolveChatContent("Revisa a García", [
      { employeeNumber: "10048", person: "Ana García" },
      { employeeNumber: "10050", person: "Marta García" },
    ], "analysis", ["10048", "10050"])).toThrow("ambiguous_person_mention");
  });

  test("does not authorize a named person outside the associated scope", () => {
    expect(() => resolveChatContent("Revisa a Ana García", [
      { employeeNumber: "10048", person: "Ana García" },
    ], "analysis", [])).toThrow("person_outside_authorized_scope");
  });

  test("does not authorize an explicit employee id outside the associated scope", () => {
    expect(() => resolveChatContent("Consulta la matrícula 10048", [
      { employeeNumber: "10048", person: "Ana García" },
    ], "analysis", [])).toThrow("person_outside_authorized_scope");
  });

  test("resolves this worker to the primary person before persistence", () => {
    expect(resolveChatContent("dime todo lo que puedas de este trabajador", [
      { employeeNumber: "10048", person: "José Pérez" },
      { employeeNumber: "10050", person: "José García" },
    ], "analysis", ["10048", "10050"], "10048")).toEqual({ content: "dime todo lo que puedas de matrícula 10048", explicitPersonIds: ["10048"] });
  });

  test("requires clarification for this worker without one primary person", () => {
    expect(() => resolveChatContent("háblame de este trabajador", [
      { employeeNumber: "10048", person: "José Pérez" },
      { employeeNumber: "10050", person: "José García" },
    ], "analysis", ["10048", "10050"])).toThrow("ambiguous_person_mention");
  });

  test.each([
    "Explica Cuadre Reg., Conceptos y Agrupaciones",
    "¿Cómo funciona Retributivo?",
    "Juan Pérez cobra más este mes",
    "Revisa a matrícula 10048",
  ])("allows ordinary general chat: %s", (content) => {
    expect(sanitizeChatContent(content, [], "general")).toBe(content);
  });

  test.each(["Revisa a matrícula 10048", "Consulta la matrícula 10048"])("allows an exact structured analysis template: %s", (content) => {
    expect(sanitizeChatContent(content, [{ employeeNumber: "10048", person: "Ana García" }], "analysis")).toBe(content);
  });
});
