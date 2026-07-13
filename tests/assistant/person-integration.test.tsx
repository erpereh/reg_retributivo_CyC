// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { Conversation } from "@/lib/assistant/domain";
import type { StoredAnalysis } from "@/lib/types";

const now = "2026-07-13T10:00:00.000Z";
const activeAnalysis = { id: "a1", createdAt: now, result: { people: [{ employeeNumber: "001" }] } } as unknown as StoredAnalysis;

function Harness() {
  const assistant = useAssistant();
  return <><button disabled={!assistant.ready} onClick={() => void assistant.continuePersonInAssistant("001")}>Continuar</button><output>{assistant.conversation?.id}</output></>;
}

afterEach(() => vi.unstubAllGlobals());

test("selects an off-page same-analysis conversation, associates once and never sends", async () => {
  const factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const repositories = await createIndexedDbRepositories({ factory, dbName: "person-provider" });
  const base = (id: string, analysisId: string): Conversation => ({ id, type: "analysis", analysisId, title: id, associatedPersonIds: [], modelProfileId: "fake-local", responseMode: "strict", contextStrategy: "automatic", analysisVersion: "v", status: "active", createdAt: now, updatedAt: now });
  await repositories.conversations.put(base("same", "a1"));
  for (let index = 0; index < 60; index += 1) await repositories.conversations.put({ ...base(`new-${index}`, "other"), updatedAt: `2026-07-13T11:${String(index).padStart(2, "0")}:00.000Z` });
  repositories.close();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="person-provider"><Harness /></AssistantProvider>);
  const button = await screen.findByRole("button", { name: "Continuar" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByText("same")).toBeTruthy());
  const check = await createIndexedDbRepositories({ factory, dbName: "person-provider" });
  expect(await check.conversations.get("same")).toEqual(expect.objectContaining({ associatedPersonIds: ["001"], primaryPersonId: "001" }));
  expect(fetchSpy).not.toHaveBeenCalled();
  check.close();
});
