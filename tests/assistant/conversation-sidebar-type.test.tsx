// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ConversationSidebar } from "@/components/assistant/ConversationSidebar";

test("labels general and analysis conversations distinctly", () => {
  render(<ConversationSidebar
    conversations={[
      { id: "general", type: "general", title: "Consulta general", associatedPersonIds: [], responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-07-15", updatedAt: "2026-07-15" },
      { id: "analysis", type: "analysis", title: "Análisis activo", analysisId: "a1", analysisVersion: "v1", associatedPersonIds: [], responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-07-15", updatedAt: "2026-07-15" },
    ]}
    selectedId="general"
    hasMore={false}
    transitionPending={false}
    onLoadMore={vi.fn()}
    onSelect={vi.fn()}
    onCreate={vi.fn()}
    onRename={vi.fn()}
    onDelete={vi.fn()}
  />);

  expect(screen.getByText("General")).toBeVisible();
  expect(screen.getByText("Análisis")).toBeVisible();
});
