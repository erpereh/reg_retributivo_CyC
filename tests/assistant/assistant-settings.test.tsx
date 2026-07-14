// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";

describe("Assistant settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("detects models before saving a Manual profile and never persists its key", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [
      { id: "manual-model", displayName: "Manual model", contextWindow: 32_000, maxOutputTokens: 4_096 },
    ] })));
    render(<AssistantProvider factory={factory} dbName="settings-ai-test"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Manual local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://models.example.test/v1" } });
    fireEvent.change(screen.getByLabelText("Clave efímera"), { target: { value: "sk-never-store" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar y detectar modelos" }));

    await screen.findByLabelText("Modelo detectado");
    expect(screen.getByRole("option", { name: /Manual model/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Manual local" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("heading", { level: 3, name: "Manual local" });

    const db = await openAssistantDatabase(factory, "settings-ai-test");
    const request = db.transaction("modelProfiles", "readonly").objectStore("modelProfiles").getAll();
    const profiles = await new Promise<Record<string, unknown>[]>((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ modelId: "manual-model", detectedContextWindow: 32_000 });
    expect(JSON.stringify(profiles)).not.toContain("sk-never-store");
  });

  test("uses one detection action and allows deleting every saved provider", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ id: "gpt-test", displayName: "GPT test" }] })));
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<AssistantProvider factory={factory} dbName="settings-ai-delete"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.change(screen.getByLabelText("Proveedor para añadir"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.click(screen.getByRole("button", { name: "Conectar y detectar modelos" }));
    await screen.findByLabelText("Modelo detectado");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("heading", { level: 3, name: "OpenAI" });

    expect(screen.queryByRole("button", { name: /Verificar capacidades/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restaurar detectados/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Más acciones para OpenAI" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil OpenAI" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "OpenAI" })).toBeNull());
  });
});
