// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NormalizedConceptsManager } from "@/components/settings/normalized-concepts/NormalizedConceptsManager";
import type { NormalizedConcept } from "@/lib/types";

const sampleConcept: NormalizedConcept = {
  id: "normalized-1",
  year: 2026,
  name: "Dietas",
  amount: 10.5,
  comments: "Comidas y desplazamientos",
  active: true,
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const appState = vi.hoisted(() => ({
  value: {
    settings: { normalizedConcepts: [] as NormalizedConcept[] },
    updateSettings: vi.fn(),
    pushToast: vi.fn(),
  },
}));

vi.mock("@/components/app/AppState", () => ({
  useAppState: () => appState.value,
}));

describe("NormalizedConceptsManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    appState.value.settings.normalizedConcepts = [];
    appState.value.updateSettings.mockClear();
    appState.value.pushToast.mockClear();
  });

  test("renders the lightweight empty view and creates a concept with Spanish money", () => {
    render(<NormalizedConceptsManager />);

    expect(screen.getByRole("heading", { name: "Conceptos normalizados" })).toBeTruthy();
    const normalizedLayout = screen.getByRole("heading", { name: "Conceptos normalizados" }).closest('[data-slot="card"]');
    expect(normalizedLayout?.getAttribute("data-surface")).toBe("normalized-concepts-layout");
    expect(normalizedLayout?.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(normalizedLayout?.querySelector('[data-surface="normalized-concepts-table"]')).toBeTruthy();
    expect(screen.getByText("Gestiona los conceptos y valores configurados para cada año.")).toBeTruthy();
    expect(screen.getByText("Estos conceptos se guardan como parametrización. Todavía no se aplican a los cálculos del análisis.")).toBeTruthy();
    expect(screen.getByText("No hay conceptos normalizados creados.")).toBeTruthy();
    expect(screen.getByText("Crea el primer concepto para comenzar la parametrización.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Crear concepto" }));
    expect(screen.getByRole("dialog", { name: "Crear concepto" })).toBeTruthy();
    expect((screen.getByLabelText("Año") as HTMLInputElement).value).toBe("2026");
    expect(screen.getByRole("switch", { name: "Activo" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(screen.getByLabelText("Nombre del concepto"), { target: { value: " Dietas " } });
    fireEvent.change(screen.getByLabelText("Valor (€)"), { target: { value: "10,50" } });
    fireEvent.change(screen.getByLabelText("Comentarios"), { target: { value: " Comidas " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar concepto" }));

    expect(appState.value.updateSettings).toHaveBeenLastCalledWith({
      normalizedConcepts: [
        expect.objectContaining({ year: 2026, name: "Dietas", amount: 10.5, comments: "Comidas", active: true }),
      ],
    });
    expect(screen.getByText("Dietas")).toBeTruthy();
    expect(screen.getByText("10,50 EUR")).toBeTruthy();
    expect(appState.value.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Concepto normalizado creado." }));
  });

  test("validates fields and rejects a normalized duplicate in the same year", () => {
    appState.value.settings.normalizedConcepts = [sampleConcept];
    render(<NormalizedConceptsManager />);

    fireEvent.click(screen.getByRole("button", { name: "Crear concepto" }));
    fireEvent.change(screen.getByLabelText("Año"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Nombre del concepto"), { target: { value: "  DIÉTAS  " } });
    fireEvent.change(screen.getByLabelText("Valor (€)"), { target: { value: "1.234" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar concepto" }));
    expect(screen.getByText("Introduce un valor válido.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Valor (€)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar concepto" }));
    expect(screen.getByText("Ya existe un concepto con ese nombre para el año seleccionado.")).toBeTruthy();
    expect(appState.value.updateSettings).not.toHaveBeenCalled();
  });

  test("edits, toggles and deletes without changing identity or creation date", () => {
    appState.value.settings.normalizedConcepts = [sampleConcept];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NormalizedConceptsManager />);

    const editButton = screen.getByRole("button", { name: "Editar concepto Dietas" });
    expect(editButton.getAttribute("title")).toBe("Editar concepto");
    fireEvent.click(editButton);
    fireEvent.change(screen.getByLabelText("Nombre del concepto"), { target: { value: "Dietas actualizadas" } });
    fireEvent.change(screen.getByLabelText("Valor (€)"), { target: { value: "20.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar concepto" }));

    const edited = appState.value.updateSettings.mock.calls.at(-1)?.[0].normalizedConcepts[0] as NormalizedConcept;
    expect(edited).toMatchObject({ id: sampleConcept.id, createdAt: sampleConcept.createdAt, name: "Dietas actualizadas", amount: 20.5 });
    expect(edited.updatedAt).toBe("2026-07-10T12:00:00.000Z");

    fireEvent.click(screen.getByRole("button", { name: "Desactivar concepto Dietas actualizadas" }));
    const toggled = appState.value.updateSettings.mock.calls.at(-1)?.[0].normalizedConcepts[0] as NormalizedConcept;
    expect(toggled).toEqual({ ...edited, active: false });

    fireEvent.click(screen.getByRole("button", { name: "Eliminar concepto Dietas actualizadas" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(appState.value.updateSettings).toHaveBeenLastCalledWith({ normalizedConcepts: [] });
    expect(appState.value.pushToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Concepto normalizado eliminado." }));
  });

  test("filters by year, usage and normalized concept or comment search", () => {
    appState.value.settings.normalizedConcepts = [
      sampleConcept,
      { ...sampleConcept, id: "plus-2025", year: 2025, name: "Plus transporte", comments: "Kilometraje", active: false },
      { ...sampleConcept, id: "abono-2026", name: "Abono", comments: "Teletrabajo" },
    ];
    render(<NormalizedConceptsManager />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["Abono", "Dietas", "Plus transporte"]);

    fireEvent.change(screen.getByLabelText("Filtro Año"), { target: { value: "2025" } });
    expect(screen.getByText("Plus transporte")).toBeTruthy();
    expect(screen.queryByText("Dietas")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtro Año"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByLabelText("Filtro Uso"), { target: { value: "Activos" } });
    expect(screen.queryByText("Plus transporte")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtro Uso"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByPlaceholderText("Buscar concepto o comentario"), { target: { value: "TELETRÁBAJO" } });
    expect(screen.getByText("Abono")).toBeTruthy();
    expect(screen.queryByText("Dietas")).toBeNull();
  });
});
