import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const fuentes = path.join(root, "fuentes");
const payrollDir = path.join(fuentes, "RECIBOS_IBER_2025");
const registroFile = path.join(fuentes, "IBER_Registro_Retributivo_(heredado)_20260630100936.xlsx");
const screenshots = path.join(root, "artifacts", "real-fixtures-screenshots");

function payrollFiles(): string[] {
  return readdirSync(payrollDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((fileName) => path.join(payrollDir, fileName));
}

async function capture(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(screenshots, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

async function openPrimaryView(page: Page, label: string): Promise<void> {
  const tab = page.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(150);
}

test("analiza los PDF y el Excel reales, exporta y recorre todas las secciones", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  mkdirSync(screenshots, { recursive: true });

  const pdfFiles = payrollFiles();
  expect(pdfFiles.length).toBeGreaterThan(0);
  expect(statSync(registroFile).size).toBeGreaterThan(0);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByLabel("Seleccionar recibos").setInputFiles(pdfFiles);
  await page.getByLabel("Seleccionar Excel").setInputFiles(registroFile);
  await expect(page.getByText(`${pdfFiles.length} recibos seleccionados`)).toBeVisible();
  await expect(page.getByText(path.basename(registroFile))).toBeVisible();

  await page.getByRole("button", { name: "Analizar", exact: true }).click();
  await expect(page.getByRole("button", { name: /Analizando/ })).toBeDisabled();
  await expect(page.getByText("Personas analizadas", { exact: true })).toBeVisible({ timeout: 12 * 60_000 });
  await expect(page.getByText(`${pdfFiles.length} recibos`, { exact: true })).toBeVisible();
  await expect(page.getByText("Recibo sin Reg. Retrib.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Conceptos pendientes de revisión", { exact: true })).toBeVisible();

  await capture(page, "01-dashboard-real-claro", true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar Excel", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^comparativa_reg_retributivo_\d{4}-\d{2}-\d{2}\.xlsx$/u);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  expect(statSync(downloadedPath!).size).toBeGreaterThan(10_000);

  const primaryViews = [
    ["Personas", "02-personas-real-claro", false],
    ["Conceptos", "03-conceptos-real-claro", false],
    ["Cuadre Reg.", "04-cuadre-real-claro", false],
    ["Agrupaciones", "08-agrupaciones-real-claro", false],
    ["Asistente", "09-asistente-real-claro", false],
    ["Historial", "10-historial-real-claro", true],
    ["Ajustes", "11-ajustes-real-claro", true],
  ] as const;

  for (const [label, fileName, fullPage] of primaryViews) {
    await openPrimaryView(page, label);
    await capture(page, fileName, fullPage);

    if (label === "Personas") {
      await expect(page.getByRole("columnheader", { name: "Matrícula" })).toBeVisible();
      await expect(page.getByText("10048", { exact: true }).first()).toBeVisible();
    }

    if (label === "Conceptos") {
      await expect(page.getByRole("columnheader", { name: "Código Reg. Retrib." })).toBeVisible();
    }

    if (label === "Cuadre Reg.") {
      await expect(page.getByRole("tab", { name: "No norm. / Desglose", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "Normalizados", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Normalizados", exact: true })).toHaveAttribute("aria-selected", "true");
      await capture(page, "05-normalizados-real-claro", false);
      await page.getByRole("tab", { name: "No norm. / Norm. + variables", exact: true }).click();
      await expect(page.getByRole("tab", { name: "No norm. / Norm. + variables", exact: true })).toHaveAttribute("aria-selected", "true");
      await capture(page, "06-variables-real-claro", false);
      await page.getByRole("tab", { name: "No norm. / Desglose", exact: true }).click();
      await capture(page, "07-cuadre-desglose-real-claro", false);
    }

    if (label === "Historial") {
      await expect(page.getByRole("button", { name: "Abrir análisis", exact: true })).toBeVisible();
      await expect(page.getByText(path.basename(registroFile), { exact: true })).toBeVisible();
    }

    if (label === "Ajustes") {
      await page.getByRole("tab", { name: "Apariencia", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Modo de visualización", exact: true })).toBeVisible();
      await capture(page, "12-apariencia-real-claro", true);
    }
  }

  await page.getByRole("button", { name: "Activar modo oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const darkViews = [
    ["Dashboard", "13-dashboard-real-oscuro", true],
    ["Personas", "14-personas-real-oscuro", false],
    ["Conceptos", "15-conceptos-real-oscuro", false],
    ["Cuadre Reg.", "16-cuadre-real-oscuro", false],
    ["Agrupaciones", "17-agrupaciones-real-oscuro", false],
    ["Asistente", "18-asistente-real-oscuro", false],
    ["Historial", "19-historial-real-oscuro", true],
    ["Ajustes", "20-ajustes-real-oscuro", true],
  ] as const;

  for (const [label, fileName, fullPage] of darkViews) {
    await openPrimaryView(page, label);
    await capture(page, fileName, fullPage);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openPrimaryView(page, "Dashboard");
  await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
  await expect(page.getByLabel("Navegación de la aplicación")).toBeVisible();
  await capture(page, "21-navegacion-movil-real-oscuro", false);

  expect(pageErrors, `Errores de página: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(serverErrors, `Respuestas 5xx: ${serverErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Errores de consola: ${consoleErrors.join(" | ")}`).toEqual([]);
});
