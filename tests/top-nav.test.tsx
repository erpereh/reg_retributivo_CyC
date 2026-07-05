// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TopNav } from "@/components/layout/TopNav";

const appState = vi.hoisted(() => ({
  value: {
    view: "dashboard",
    result: undefined,
    activeAnalysis: undefined,
    aiStatus: undefined,
    exporting: false,
    setView: vi.fn(),
    exportActiveAnalysis: vi.fn(),
    resetForNewAnalysis: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("TopNav", () => {
  beforeEach(() => {
    appState.value.view = "dashboard";
    appState.value.result = undefined;
    appState.value.activeAnalysis = undefined;
    appState.value.aiStatus = undefined;
    appState.value.exporting = false;
    appState.value.setView.mockClear();
    appState.value.exportActiveAnalysis.mockClear();
    appState.value.resetForNewAnalysis.mockClear();
  });

  test("renders accessible tabs and changes active view without reload", () => {
    render(<TopNav />);

    expect(screen.getByRole("tab", { name: "Dashboard" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Personas" }));

    expect(appState.value.setView).toHaveBeenCalledWith("personas");
  });

  test("disables export when there is no active analysis", () => {
    render(<TopNav />);

    expect(screen.getByRole("button", { name: /Exportar Excel/i }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo análisis/i }));

    expect(appState.value.resetForNewAnalysis).toHaveBeenCalledTimes(1);
  });

  test("shows compact active analysis date and AI status", () => {
    appState.value.result = {};
    appState.value.activeAnalysis = {
      createdAt: "2026-07-05T18:30:00.000Z",
      config: { enableAI: true },
    };
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-test" };

    render(<TopNav />);

    expect(screen.getByText(/Analisis activo/i)).toBeTruthy();
    expect(screen.getByText(/IA activa/i)).toBeTruthy();
  });
});
