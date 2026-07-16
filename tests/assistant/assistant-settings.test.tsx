// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";

describe("Assistant provider settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  test("stores only non-sensitive provider configuration and never renders a model selector or key value", async () => {
    const factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ providerId: "provider", keyStatus: "not_configured" })));
    render(<AssistantProvider factory={factory} dbName="settings-provider"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores de IA" });
    expect(screen.queryByLabelText(/clave/i)).toBeNull();
    expect(screen.queryByText(/modelo general predeterminado/i)).toBeNull();
    const add = screen.getByRole("button", { name: /Añadir proveedor/i }); await waitFor(() => expect(add).toBeEnabled()); fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Guardar proveedor" }));
    await screen.findByRole("heading", { level: 3, name: "Gemini" });
    const db = await openAssistantDatabase(factory, "settings-provider");
    const request = db.transaction("providerConfigs", "readonly").objectStore("providerConfigs").getAll();
    const providers = await new Promise<Record<string, unknown>[]>((resolve) => { request.onsuccess = () => resolve(request.result); }); db.close();
    expect(providers[0]).toMatchObject({ providerType: "gemini", envVarName: "GEMINI_API_KEY", connectionStatus: "missing_key" });
    expect(JSON.stringify(providers)).not.toMatch(/sk-|apiKeyValue|secret/i);
  });

  test("refreshes a complete catalog without compatibility probes", async () => {
    const factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { const body = JSON.parse(String(init?.body)); calls.push(body); const providerId = body.provider?.providerId ?? body.config?.id; if (body.operation === "catalog") return Response.json({ completion: "complete", models: [{ id: `${providerId}:model`, providerId, canonicalModelId: "model", apiModelId: "model", generationModelId: "model", displayName: "Model", capabilities: { chat: true, tools: "unknown", streaming: true, vision: false, documents: false }, availability: "available", metadataSource: "official", detectedAt: new Date().toISOString() }] }); return Response.json({ providerId, keyStatus: "configured" }); }));
    render(<AssistantProvider factory={factory} dbName="settings-catalog"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores de IA" });
    const add = screen.getByRole("button", { name: /Añadir proveedor/i }); await waitFor(() => expect(add).toBeEnabled()); fireEvent.click(add); fireEvent.click(screen.getByRole("button", { name: "Guardar proveedor" }));
    const heading = await screen.findByRole("heading", { level: 3, name: "Gemini" }); const card = heading.closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Actualizar modelos" }));
    await screen.findByText("Catálogo actualizado sin probes de inferencia.");
    expect(calls.some((call) => (call as { operation?: string }).operation === "compatibility")).toBe(false);
  });

  test("deletes provider configuration while leaving conversations outside the transaction", async () => {
    const factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keyStatus: "configured" })));
    render(<AssistantProvider factory={factory} dbName="settings-delete"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores de IA" }); const add = screen.getByRole("button", { name: /Añadir proveedor/i }); await waitFor(() => expect(add).toBeEnabled()); fireEvent.click(add); fireEvent.click(screen.getByRole("button", { name: "Guardar proveedor" }));
    const card = (await screen.findByRole("heading", { level: 3, name: "Gemini" })).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "Gemini" })).toBeNull());
  });
});
