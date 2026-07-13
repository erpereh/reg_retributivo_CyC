// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { DEFAULT_ASSISTANT_SETTINGS, assistantSettingsSchema, modelProfileSchema } from "@/lib/assistant/schemas";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";

describe("Assistant settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("defines one strict default settings record and key-free model profiles", () => {
    expect(DEFAULT_ASSISTANT_SETTINGS).toEqual({
      id: "assistant-settings", defaultGeneralModelProfileId: undefined, defaultAnalysisModelProfileId: undefined,
      responseMode: "strict", contextStrategy: "automatic", safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85,
    });
    expect(assistantSettingsSchema.parse(DEFAULT_ASSISTANT_SETTINGS)).toEqual(DEFAULT_ASSISTANT_SETTINGS);
    expect(() => assistantSettingsSchema.parse({ ...DEFAULT_ASSISTANT_SETTINGS, apiKey: "secret" })).toThrow();
    expect(() => modelProfileSchema.parse({ id: "x", apiKey: "secret" })).toThrow();
  });

  test("persists profiles/defaults but never a manual key in any store", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ id: "manual-model", displayName: "Manual model" }] })));
    render(<AssistantProvider factory={factory} dbName="settings-ai-test"><AssistantAiSettings /></AssistantProvider>);

    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    expect(screen.getByText("Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador. Cualquier persona con acceso al perfil del navegador podría acceder a estos datos.")).toBeTruthy();
    expect(screen.getByText("Compatibilidad habilitada manualmente y no garantizada.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Añadir proveedor Manual" }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Manual local" } });
    fireEvent.change(screen.getByLabelText("URL base HTTPS"), { target: { value: "https://models.example.test/v1" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "manual-model" } });
    fireEvent.change(screen.getByLabelText("Clave efímera"), { target: { value: "sk-never-store" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "Manual local" });
    expect(screen.getByRole("button", { name: "Probar conexión Manual local" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verificar capacidades Manual local" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Habilitar compatibilidad manual Manual local" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restaurar detectados Manual local" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Duplicar Manual local/i }));
    await screen.findByRole("heading", { level: 3, name: "Manual local (copia)" });
    fireEvent.click(screen.getByRole("button", { name: /Desactivar Manual local$/i }));
    fireEvent.change(screen.getByLabelText("Modelo general predeterminado"), { target: { value: screen.getAllByRole("option", { name: "Manual local (copia)" })[0]?.getAttribute("value") } });
    fireEvent.change(screen.getByLabelText("Modo de respuesta"), { target: { value: "flexible" } });

    await waitFor(async () => {
      const db = await openAssistantDatabase(factory, "settings-ai-test");
      const transaction = db.transaction(["modelProfiles", "assistantSettings"], "readonly");
      const profilesRequest = transaction.objectStore("modelProfiles").getAll();
      const settingsRequest = transaction.objectStore("assistantSettings").getAll();
      const [profiles, settings] = await Promise.all([
        new Promise<unknown[]>((resolve) => { profilesRequest.onsuccess = () => resolve(profilesRequest.result); }),
        new Promise<unknown[]>((resolve) => { settingsRequest.onsuccess = () => resolve(settingsRequest.result); }),
      ]);
      db.close();
      const serialized = JSON.stringify({ profiles, settings });
      expect(profiles).toHaveLength(2);
      expect(settings).toHaveLength(1);
      expect(serialized).not.toContain("sk-never-store");
      expect(serialized).not.toMatch(/apiKey|authorization/i);
    });
  });

  test("persists a sanitized verification failure and always closes the busy state", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream body sk-secret"); }));
    render(<AssistantProvider factory={factory} dbName="settings-ai-failure"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.click(screen.getByRole("button", { name: "Añadir proveedor Manual" }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Manual failure" } });
    fireEvent.change(screen.getByLabelText("URL base HTTPS"), { target: { value: "https://failure.example/v1" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "future" } });
    fireEvent.change(screen.getByLabelText("Clave efímera"), { target: { value: "sk-never-persist" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "Manual failure" });
    const verify = screen.getByRole("button", { name: "Verificar capacidades Manual failure" });
    fireEvent.click(verify);
    expect((await screen.findAllByText("No se pudo verificar el modelo.")).length).toBeGreaterThan(0);
    await waitFor(() => expect(verify.hasAttribute("disabled")).toBe(false));

    const db = await openAssistantDatabase(factory, "settings-ai-failure");
    const transaction = db.transaction("modelProfiles", "readonly");
    const request = transaction.objectStore("modelProfiles").getAll();
    const profiles = await new Promise<Record<string, unknown>[]>((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close();
    expect(profiles[0]).toMatchObject({ lastVerificationError: "No se pudo verificar el modelo." });
    expect(profiles[0]?.verifiedAt).toEqual(expect.any(String));
    expect(JSON.stringify(profiles)).not.toMatch(/private upstream|sk-secret|sk-never-persist/);
  });

  test("repairs defaults when their profile is disabled", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    render(<AssistantProvider factory={factory} dbName="settings-ai-defaults"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.click(screen.getByRole("button", { name: "Añadir proveedor Manual" }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Compatible" } });
    fireEvent.change(screen.getByLabelText("URL base HTTPS"), { target: { value: "https://compatible.example/v1" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "future" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "Compatible" });
    fireEvent.click(screen.getByRole("button", { name: "Habilitar compatibilidad manual Compatible" }));
    const defaultSelect = screen.getByLabelText("Modelo general predeterminado") as HTMLSelectElement;
    const option = (await screen.findAllByRole("option", { name: "Compatible" }))[0]!;
    fireEvent.change(defaultSelect, { target: { value: option.getAttribute("value") } });
    await waitFor(() => expect(defaultSelect.value).not.toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "Desactivar Compatible" }));
    await waitFor(() => expect(defaultSelect.value).toBe(""));
    await waitFor(async () => {
      const db = await openAssistantDatabase(factory, "settings-ai-defaults");
      const transaction = db.transaction("assistantSettings", "readonly");
      const request = transaction.objectStore("assistantSettings").get("assistant-settings");
      const settings = await new Promise<Record<string, unknown> | undefined>((resolve) => { request.onsuccess = () => resolve(request.result); });
      db.close();
      expect(settings?.defaultGeneralModelProfileId).toBeUndefined();
    });
  });

  test("reports IndexedDB initialization failure without updating after an unmount", async () => {
    const factory = { open() { throw new Error("private database failure"); } } as unknown as IDBFactory;
    const rendered = render(<AssistantProvider factory={factory} dbName="settings-ai-open-failure"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByText("No se pudo abrir el almacenamiento local del Asistente.");
    rendered.unmount();
  });

  test("merges a draft opened before a probe without reverting the probe result", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { profile: Record<string, unknown> };
      return new Promise<Response>((resolve) => {
        resolveFetch = () => resolve(Response.json({ profile: {
          ...body.profile,
          generalChatCompatible: true,
          analysisCompatible: false,
          supportsStreaming: true,
          supportsTools: true,
          supportsStructuredOutput: true,
          detectedContextWindow: 16_000,
          maxOutputTokens: 4_096,
          capabilitiesSource: "detected",
          verifiedAt: "2026-07-13T12:00:00.000Z",
          lastVerificationError: "El modelo no supera todas las comprobaciones requeridas.",
        } }));
      });
    }));
    render(<AssistantProvider factory={factory} dbName="settings-ai-in-flight"><AssistantAiSettings /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Proveedores y modelos" });
    fireEvent.click(screen.getByRole("button", { name: "Añadir proveedor Manual" }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "In flight" } });
    fireEvent.change(screen.getByLabelText("URL base HTTPS"), { target: { value: "https://in-flight.example/v1" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "future" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "In flight" });
    fireEvent.click(screen.getByRole("button", { name: "Editar In flight" }));
    fireEvent.change(screen.getByLabelText("Nombre del perfil"), { target: { value: "Stale edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar capacidades In flight" }));

    const edit = screen.getByRole("button", { name: "Editar In flight" });
    const disable = screen.getByRole("button", { name: "Desactivar In flight" });
    const remove = screen.getByRole("button", { name: "Eliminar In flight" });
    const save = screen.getByRole("button", { name: "Guardar perfil" });
    await waitFor(() => expect(edit.hasAttribute("disabled")).toBe(true));
    expect(disable.hasAttribute("disabled")).toBe(true);
    expect(remove.hasAttribute("disabled")).toBe(true);
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    fireEvent.click(disable);
    fireEvent.click(remove);

    resolveFetch?.();
    await screen.findByText("Capacidades verificadas.");
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await screen.findByRole("heading", { level: 3, name: "Stale edit" });
    expect(screen.getByRole("button", { name: "Desactivar Stale edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eliminar Stale edit" })).toBeTruthy();

    const db = await openAssistantDatabase(factory, "settings-ai-in-flight");
    const transaction = db.transaction("modelProfiles", "readonly");
    const request = transaction.objectStore("modelProfiles").getAll();
    const profiles = await new Promise<Record<string, unknown>[]>((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close();
    expect(profiles[0]).toMatchObject({
      name: "Stale edit",
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      detectedContextWindow: 16_000,
      maxOutputTokens: 4_096,
      verifiedAt: "2026-07-13T12:00:00.000Z",
      lastVerificationError: "El modelo no supera todas las comprobaciones requeridas.",
    });
  });
});
