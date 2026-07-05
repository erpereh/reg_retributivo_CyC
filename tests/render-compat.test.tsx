// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ChartsPanel } from "@/components/dashboard/ChartsPanel";

describe("render compatibility", () => {
  test("charts render an empty state when there is no compatible analysis", () => {
    render(<ChartsPanel result={undefined} />);

    expect(screen.getByText("Sin datos para graficar").textContent).toBe("Sin datos para graficar");
  });
});
