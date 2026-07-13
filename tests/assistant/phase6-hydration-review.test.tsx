// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const createRepositories = vi.hoisted(() => vi.fn());
vi.mock("@/lib/assistant/storage/indexedDbRepositories", () => ({ createIndexedDbRepositories: createRepositories }));

import { AppStateProvider, useAppState } from "@/components/app/AppState";

let state: ReturnType<typeof useAppState> | undefined;
function Probe() { state = useAppState(); return null; }

beforeEach(() => {
  state = undefined;
  window.localStorage.clear();
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  createRepositories.mockReset().mockRejectedValue(new Error("private IndexedDB failure"));
});

test("ends hydration and exposes a sanitized recoverable state when assistant repository recovery cannot open", async () => {
  render(<AppStateProvider><Probe /></AppStateProvider>);
  await waitFor(() => expect(state?.hydrating).toBe(false));
  expect(state?.error).toMatch(/contenido local|recuperar|volver a intentarlo/i);
  expect(state?.error).not.toContain("private IndexedDB failure");
  expect(state?.status).toBe("Pendiente de archivos");
});
