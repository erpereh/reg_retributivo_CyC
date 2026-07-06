// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AI_EXPLANATION_CACHE_KEY } from "@/lib/ai/explainCache";
import { SettingsView } from "@/components/settings/SettingsView";

const appState = vi.hoisted(() => ({
  value: {
    settings: {
      defaultTolerance: 1,
      enableAIByDefault: false,
      autoExplainOnOpen: false,
      reviewThreshold: 1,
      incidentThreshold: 50,
      aiModel: "gemini-3.1-flash-lite",
      conceptMap: [],
    },
    updateSettings: vi.fn(),
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
    aiTesting: false,
    aiTestMessage: undefined,
    refreshAiStatus: vi.fn(),
    testAiConnection: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("SettingsView AI explanations", () => {
  beforeEach(() => {
    window.localStorage.clear();
    appState.value.updateSettings.mockClear();
  });

  test("renders auto explain disabled by default and clears only AI explanation cache", () => {
    window.localStorage.setItem(AI_EXPLANATION_CACHE_KEY, JSON.stringify({ cached: true }));
    window.localStorage.setItem("retributivo.history.v1", "history");

    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(
      screen.getByText("Configura tolerancias, preferencias de IA, caché de explicaciones y opciones de visualización de la comparativa."),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Abrir explicación IA automáticamente/i }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Borrar caché de explicaciones/i }));

    expect(window.localStorage.getItem(AI_EXPLANATION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem("retributivo.history.v1")).toBe("history");
    expect(screen.getByText(/Caché de explicaciones IA borrada/i)).toBeTruthy();
  });
});
