import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshots = path.join(process.cwd(), "artifacts", "ui-screenshots");

async function capture(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(screenshots, `${name}.png`),
    fullPage: name !== "05-asistente",
    animations: "disabled",
  });
}

test("captura todas las vistas del rediseño", async ({ page }) => {
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible();
  await capture(page, "01-dashboard");

  const views = [
    ["Personas", "02-personas"],
    ["Cuadre Reg.", "03-cuadre-registro"],
    ["Agrupaciones", "04-agrupaciones"],
    ["Asistente", "05-asistente"],
    ["Historial", "06-historial"],
    ["Ajustes", "07-ajustes"],
  ] as const;

  for (const [label, filename] of views) {
    await page.getByRole("tab", { name: label }).click();
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    await capture(page, filename);
  }
});
