// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ToastViewport, type ToastItem } from "@/components/common/ToastViewport";

describe("ToastViewport", () => {
  test("renders stacked bottom-right toasts and closes one manually", () => {
    const onDismiss = vi.fn();
    const toasts: ToastItem[] = [
      { id: "1", kind: "success", title: "Excel exportado", message: "Excel exportado correctamente." },
      { id: "2", kind: "error", title: "Error", message: "No se pudo analizar." },
    ];

    render(<ToastViewport toasts={toasts} onDismiss={onDismiss} />);

    expect(screen.getByRole("status", { name: /Excel exportado/i })).toBeTruthy();
    expect(screen.getByRole("alert", { name: /Error/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cerrar Excel exportado/i }));

    expect(onDismiss).toHaveBeenCalledWith("1");
  });

  test("auto-dismisses toasts after the configured timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <ToastViewport
        toasts={[{ id: "1", kind: "info", title: "Historial cargado", message: "Analisis activo actualizado." }]}
        onDismiss={onDismiss}
        autoDismissMs={4000}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(onDismiss).toHaveBeenCalledWith("1");
    vi.useRealTimers();
  });
});
