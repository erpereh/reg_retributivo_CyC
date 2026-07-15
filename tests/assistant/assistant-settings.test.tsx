// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";

describe("Assistant settings", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  test("saves a detected Manual profile from one action under StrictMode and persists its model cache", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [
      { id: "manual-model", displayName: "Manual model", contextWindow: 32_000, maxOutputTokens: 4_096 },
    ] })));
    render(<StrictMode><AssistantProvider factory={factory} dbName="settings-ai-test"><AssistantAiSettings /></AssistantProvider></StrictMode>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Manual local" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://models.example.test/v1" } });
    fireEvent.change(screen.getByLabelText("Clave efímera"), { target: { value: "sk-never-store" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect(screen.getByRole("button", { name: "Conectando y guardando…" })).toBeDisabled();
    const modelSearch = await screen.findByRole("combobox", { name: "Buscar modelo detectado" });
    fireEvent.focus(modelSearch);
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Manual model/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "Manual local" });

    const db = await openAssistantDatabase(factory, "settings-ai-test");
    const request = db.transaction("modelProfiles", "readonly").objectStore("modelProfiles").getAll();
    const profiles = await new Promise<Record<string, unknown>[]>((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ modelId: "manual-model", detectedModels: [{ id: "manual-model", displayName: "Manual model", contextWindow: 32_000, maxOutputTokens: 4_096 }] });
    expect(profiles[0]?.verifiedAt).toEqual(expect.any(String));
    expect(JSON.stringify(profiles)).not.toContain("sk-never-store");
  });

  test("keeps the draft open and surfaces the server-side key error without saving", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 400 })));
    render(<AssistantProvider factory={factory} dbName="settings-ai-key-error"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.change(screen.getByLabelText("Proveedor para añadir"), { target: { value: "gemini" } });
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));

    expect(await screen.findByText("No se pudo conectar: GEMINI_API_KEY no está configurada.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre del perfil")).toHaveValue("Gemini");
    expect(screen.queryByRole("heading", { level: 3, name: "Gemini" })).toBeNull();
  });

  test("cancels a pending profile save at the client deadline and restores the form", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    render(<AssistantProvider factory={factory} dbName="settings-ai-timeout"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Manual timeout" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://models.example.test/v1" } });
    fireEvent.change(screen.getByLabelText("Clave efímera"), { target: { value: "key" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    act(() => { vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("La conexión tardó demasiado. Inténtalo de nuevo.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    vi.useRealTimers();
  });

  test("updates detected models through the same save operation and allows deleting every provider", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ id: "gpt-test", displayName: "GPT test" }] })));
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<AssistantProvider factory={factory} dbName="settings-ai-delete"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.change(screen.getByLabelText("Proveedor para añadir"), { target: { value: "openai" } });
    fireEvent.click(screen.getByRole("button", { name: /Añadir perfil/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    const modelSearch = await screen.findByRole("combobox", { name: "Buscar modelo detectado" });
    fireEvent.focus(modelSearch);
    fireEvent.mouseDown(await screen.findByRole("option", { name: /GPT test/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "OpenAI" });

    expect(screen.queryByRole("button", { name: /Verificar capacidades/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restaurar detectados/i })).toBeNull();
    const card = screen.getByRole("heading", { level: 3, name: "OpenAI" }).closest("article");
    if (!card) throw new Error("Missing OpenAI profile card");
    fireEvent.click(within(card).getByRole("button", { name: "Actualizar modelos" }));
    await waitFor(() => expect(screen.getByText(/Conexión correcta/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Más acciones para OpenAI" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar perfil OpenAI" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "OpenAI" })).toBeNull());
  });
});
