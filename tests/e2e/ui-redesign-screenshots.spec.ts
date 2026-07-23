import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshots = path.join(process.cwd(), "artifacts", "ui-screenshots");

async function capture(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(screenshots, `${name}.png`),
    fullPage: !name.includes("asistente") && !name.includes("movil"),
    animations: "disabled",
  });
}

async function openView(page: Page, label: string) {
  const tab = page.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test("captura todas las vistas del rediseño en claro, oscuro y móvil", async ({ page }) => {
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible();

  const views = [
    ["Dashboard", "01-inicio"],
    ["Personas", "02-personas"],
    ["Conceptos", "03-conceptos"],
    ["Cuadre Reg.", "04-cuadre-registro"],
    ["Agrupaciones", "05-agrupaciones"],
    ["Asistente", "06-asistente"],
    ["Historial", "07-historial"],
    ["Ajustes", "08-ajustes"],
  ] as const;

  for (const [label, filename] of views) {
    await openView(page, label);
    await capture(page, `${filename}-claro`);
    if (label === "Ajustes") {
      await page.getByRole("tab", { name: "Apariencia" }).click();
      await expect(page.getByRole("heading", { name: "Modo de visualización" })).toBeVisible();
      await capture(page, "09-apariencia-claro");
    }
  }

  await page.getByRole("button", { name: "Activar modo oscuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  for (const [label, filename] of views) {
    await openView(page, label);
    await capture(page, `${filename}-oscuro`);
    if (label === "Ajustes") {
      await page.getByRole("tab", { name: "Apariencia" }).click();
      await capture(page, "09-apariencia-oscuro");
    }
  }

  await openView(page, "Dashboard");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await expect(page.getByLabel("Navegación de la aplicación")).toBeVisible();
  await capture(page, "10-navegacion-movil-oscuro");
});
