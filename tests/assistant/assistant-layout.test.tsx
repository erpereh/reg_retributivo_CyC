// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import type { Conversation } from "@/lib/assistant/domain";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";

function installViewport(width: number, reducedMotion = false) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reducedMotion
      : query.includes("min-width")
        ? width >= Number(query.match(/(\d+)px/)?.[1] ?? 0)
        : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function conversation(index: number): Conversation {
  const timestamp = `2026-07-13T10:${String(index).padStart(2, "0")}:00.000Z`;
  return {
    id: `conversation-${index}`,
    type: "general",
    title: `Conversación ${index}`,
    associatedPersonIds: [],
    modelProfileId: "fake-retributivo-v1",
    responseMode: "strict",
    contextStrategy: "automatic",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function seed(factory: IDBFactory, dbName: string, count = 1) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  for (let index = 1; index <= count; index += 1) await repositories.conversations.put(conversation(index));
  repositories.close();
}

async function renderAssistant(width: number, dbName: string, count = 1, reducedMotion = false) {
  installViewport(width, reducedMotion);
  const factory = new IDBFactory();
  await seed(factory, dbName, count);
  render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
  return screen.findByTestId("assistant-shell");
}

describe("assistant responsive layout", () => {
  beforeEach(() => vi.stubGlobal("IDBKeyRange", IDBKeyRange));
  afterEach(() => vi.unstubAllGlobals());

  test.each([1600, 1440, 1280, 1024, 768, 390] as const)("uses a hydration-stable CSS grid at %ipx", async (width) => {
    const shell = await renderAssistant(width, `layout-${width}`);
    expect(shell).not.toHaveAttribute("data-layout");
    expect(shell).toHaveClass("flex", "min-h-0", "flex-1", "overflow-hidden");
    const grid = shell.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-1", "lg:grid-cols-[minmax(0,1fr)_19rem]", "xl:grid-cols-[17rem_minmax(0,1fr)_19rem]");
    expect(screen.getByRole("button", { name: "Abrir conversaciones" })).toHaveClass("min-h-11", "min-w-11");
    expect(screen.getByRole("button", { name: "Abrir contexto" })).toHaveClass("lg:hidden");
  });

  test("drawers trap focus, close with Escape, hide their content and restore focus", async () => {
    await renderAssistant(768, "drawer-behaviour");
    const trigger = screen.getByRole("button", { name: "Abrir conversaciones" });
    expect(screen.queryByRole("dialog", { name: "Conversaciones" })).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Conversaciones" });
    expect(dialog).not.toHaveAttribute("aria-hidden", "true");
    const close = within(dialog).getByRole("button", { name: "Cerrar conversaciones" });
    expect(close).toHaveClass("min-h-11", "min-w-11");
    await waitFor(() => expect(close).toHaveFocus());
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(focusable.at(-1)).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Conversaciones" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test("closes from the backdrop and selection and restores the matching trigger", async () => {
    await renderAssistant(768, "drawer-close-paths", 2);
    const trigger = screen.getByRole("button", { name: "Abrir conversaciones" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Descartar conversaciones" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Conversaciones" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Conversación 1/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conversaciones" })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  test("paginates a large conversation list and summarizes long chip collections", async () => {
    await renderAssistant(1600, "conversation-pagination", 13);
    const list = screen.getByTestId("conversation-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más conversaciones" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(13));
  });

  test("uses real translated drawer motion with a reduced-motion override", async () => {
    await renderAssistant(768, "motion-regular", 1, true);
    fireEvent.click(screen.getByRole("button", { name: "Abrir conversaciones" }));
    const dialog = screen.getByRole("dialog", { name: "Conversaciones" });
    expect(dialog.querySelector(".transition-transform")).toHaveClass("duration-180", "motion-reduce:transition-none");
  });

  test("hydrates the server loading shell without a markup mismatch", async () => {
    installViewport(1024);
    const factory = new IDBFactory();
    await seed(factory, "hydration-stable");
    const element = <AssistantProvider factory={factory} dbName="hydration-stable"><AssistantView /></AssistantProvider>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = hydrateRoot(container, element);
    await waitFor(() => expect(container.querySelector('[data-testid="assistant-shell"]')).not.toBeNull());
    expect(errorSpy.mock.calls.flat().join(" ")).not.toMatch(/hydration|did not match|server rendered html/i);
    root.unmount();
    container.remove();
    errorSpy.mockRestore();
  });

  test("moves focus to the visible chat fallback when a breakpoint hides the drawer opener", async () => {
    const queries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => {
      const state = { matches: false, listeners: new Set<() => void>() };
      queries.set(query, state);
      return {
        get matches() { return state.matches; }, media: query, onchange: null,
        addEventListener: (_type: string, listener: () => void) => state.listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => state.listeners.delete(listener),
        addListener: (listener: () => void) => state.listeners.add(listener), removeListener: (listener: () => void) => state.listeners.delete(listener), dispatchEvent: vi.fn(),
      };
    }));
    const factory = new IDBFactory();
    await seed(factory, "breakpoint-visible-focus");
    render(<AssistantProvider factory={factory} dbName="breakpoint-visible-focus"><AssistantView /></AssistantProvider>);
    const shell = await screen.findByTestId("assistant-shell");
    fireEvent.click(screen.getByRole("button", { name: "Abrir conversaciones" }));
    expect(screen.getByRole("dialog", { name: "Conversaciones" })).toBeVisible();
    const wide = queries.get("(min-width: 1280px)")!;
    await act(async () => {
      wide.matches = true;
      wide.listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conversaciones" })).toBeNull());
    expect(shell).toHaveFocus();
    expect(screen.getByRole("button", { name: "Abrir conversaciones" })).not.toHaveFocus();
  });
});
