// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PersonDetail } from "@/components/tables/PersonDetail";
import type { PersonComparisonRow } from "@/lib/types";

test("continues the selected employee without composing or sending a question", () => {
  const onContinue = vi.fn(async () => undefined);
  render(<PersonDetail row={{ employeeNumber: "001" } as PersonComparisonRow} ready busy={false} onContinue={onContinue} />);
  fireEvent.click(screen.getByRole("button", { name: "Continuar en Asistente" }));
  expect(onContinue).toHaveBeenCalledWith("001");
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("disables continuation until the assistant is ready and while opening", () => {
  const onContinue = vi.fn(async () => undefined);
  const view = render(<PersonDetail row={{ employeeNumber: "001" } as PersonComparisonRow} ready={false} busy={false} onContinue={onContinue} />);
  expect(screen.getByRole("button", { name: "Asistente no disponible" })).toBeDisabled();
  view.rerender(<PersonDetail row={{ employeeNumber: "001" } as PersonComparisonRow} ready busy onContinue={onContinue} />);
  expect(screen.getByRole("button", { name: "Abriendo…" })).toBeDisabled();
});
