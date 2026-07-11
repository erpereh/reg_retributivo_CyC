// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { ModalShell } from "@/components/common/ModalShell";
import { SectionTabs } from "@/components/common/SectionTabs";

function TabsHarness() {
  const [value, setValue] = useState("general");
  return (
    <SectionTabs
      label="Secciones"
      value={value}
      onValueChange={setValue}
      items={[
        { value: "general", label: "General" },
        { value: "concepts", label: "Conceptos" },
      ]}
    />
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir detalle</button>
      {open ? (
        <ModalShell title="Detalle persona" onClose={() => setOpen(false)}>
          <button type="button">Acción interior</button>
        </ModalShell>
      ) : null}
    </>
  );
}

describe("shared UI primitives", () => {
  test("SectionTabs supports selection and keyboard navigation", () => {
    render(<TabsHarness />);

    const general = screen.getByRole("tab", { name: "General" });
    const concepts = screen.getByRole("tab", { name: "Conceptos" });
    expect(general.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(general, { key: "ArrowRight" });
    expect(concepts.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(concepts);
  });

  test("ModalShell closes safely and restores focus", () => {
    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Abrir detalle" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.mouseDown(screen.getByRole("button", { name: "Acción interior" }));
    expect(screen.getByRole("dialog", { name: "Detalle persona" })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Detalle persona" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Detalle persona" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });
});
