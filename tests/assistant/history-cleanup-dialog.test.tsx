// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { StoredAnalysis } from "@/lib/types";

const removeStoredAnalysis = vi.fn(async () => undefined);
vi.mock("@/components/app/AppState", () => ({ useAppState: () => ({
  history: [{ id: "a1", createdAt: "2026-07-13T10:00:00.000Z", registroFileName: "Registro", pdfCount: 1, result: { summary: {} } } as StoredAnalysis],
  activeAnalysis: undefined, exporting: false, openStoredAnalysis: vi.fn(), removeStoredAnalysis, clearStoredHistory: vi.fn(), exportStoredAnalysis: vi.fn(),
}) }));

import { HistoryView } from "@/components/history/HistoryView";

afterEach(() => { removeStoredAnalysis.mockClear(); });

test("uses an accessible deletion dialog and supports preserving conversations", async () => {
  const confirmSpy = vi.spyOn(window, "confirm");
  render(<HistoryView />);
  fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
  const dialog = screen.getByRole("dialog", { name: /Eliminar análisis/i });
  expect(dialog).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar análisis conservando conversaciones" }));
  await waitFor(() => expect(removeStoredAnalysis).toHaveBeenCalledWith("a1", "preserve_conversations"));
  const history = screen.getByLabelText("Historial de análisis");
  await waitFor(() => expect(history).toHaveFocus());
  expect(history).not.toHaveClass("outline-none");
  expect(confirmSpy).not.toHaveBeenCalled();
});

test("keeps the dialog and retry path visible when deletion fails", async () => {
  removeStoredAnalysis.mockRejectedValueOnce(new Error("No se pudo completar la limpieza coordinada."));
  render(<HistoryView />); fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
  fireEvent.click(screen.getByRole("button", { name: "Eliminar análisis y conversaciones" }));
  await waitFor(() => expect(removeStoredAnalysis).toHaveBeenCalled());
  expect(screen.getByRole("dialog", { name: /Eliminar análisis/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Eliminar análisis y conversaciones" })).toBeEnabled();
});
