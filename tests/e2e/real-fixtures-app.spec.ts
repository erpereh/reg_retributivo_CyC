import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const fuentes = path.join(root, "fuentes");
const payrollDir = path.join(fuentes, "RECIBOS_IBER_2025");
const registroFile = path.join(fuentes, "IBER_Registro_Retributivo_(heredado)_20260630100936.xlsx");
const screenshots = path.join(root, "artifacts", "real-fixtures-screenshots");
const finalScreenshots = path.join(root, "artifacts", "final-screenshots");

function payrollFiles(): string[] {
  return readdirSync(payrollDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((fileName) => path.join(payrollDir, fileName));
}

async function capture(page: Page, directory: string, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

async function captureFinal(page: Page, name: string, fullPage = false): Promise<void> {
  await capture(page, finalScreenshots, name, fullPage);
}

async function openDesktopView(page: Page, label: string): Promise<void> {
  const tab = page.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(180);
}

async function openMobileView(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
  const navigation = page.getByLabel("Navegación de la aplicación");
  await expect(navigation).toBeVisible();
  const tab = navigation.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(navigation).toBeHidden();
  await page.waitForTimeout(180);
}

async function openView(page: Page, label: string): Promise<void> {
  if (page.viewportSize() && page.viewportSize()!.width < 768) await openMobileView(page, label);
  else await openDesktopView(page, label);
}

async function createRealAssistantReview(page: Page): Promise<void> {
  await openDesktopView(page, "Asistente");
  const createConversation = page.getByRole("button", { name: "Crear conversación general", exact: true });
  if (await createConversation.isVisible()) await createConversation.click();
  await expect(page.getByRole("heading", { name: "Consulta general", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Añadir contexto/u }).click();
  await expect(page.getByText("Contexto del análisis añadido", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Gestionar personas asociadas", exact: true }).click();
  const peopleDialog = page.getByRole("dialog", { name: "Asociar personas", exact: true });
  await expect(peopleDialog).toBeVisible();
  await peopleDialog.getByRole("textbox", { name: "Buscar personas asociadas", exact: true }).fill("10048");
  const personCheckbox = peopleDialog.getByRole("checkbox", { name: "Matrícula 10048", exact: true });
  await expect(personCheckbox).toBeVisible();
  if (!(await personCheckbox.isChecked())) await personCheckbox.click();
  await expect(personCheckbox).toBeChecked({ timeout: 15_000 });
  await peopleDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("Principal: matrícula 10048", { exact: true })).toBeVisible();

  const modelButton = page.getByRole("button", { name: /Modelo de conversación:/u });
  await modelButton.click();
  const modelDialog = page.getByRole("dialog", { name: "Catálogo de modelos", exact: true });
  await expect(modelDialog).toBeVisible();
  await modelDialog.getByRole("textbox", { name: "Buscar modelos", exact: true }).fill("e2e");
  const defaultModelButton = modelDialog.getByRole("button").filter({
    has: modelDialog.getByText("e2e-default-model", { exact: true }),
  });
  await expect(defaultModelButton).toBeVisible();
  await captureFinal(page, "07-selector-de-modelos-abierto");
  await defaultModelButton.click();
  await expect(page.getByRole("button", { name: "Modelo de conversación: e2e-default-model", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Pregunta", exact: true }).fill("¿Por qué la matrícula 10048 tiene diferencia y cuáles son los importes exactos?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const answer = page.getByRole("article", { name: "Respuesta del Asistente", exact: true }).last();
  await expect(answer).toContainText("matrícula 10048", { timeout: 60_000 });
  await expect(answer.getByRole("button", { name: "Abrir explicación completa de la persona", exact: true })).toBeVisible();
  await expect(answer.getByRole("region", { name: "Fuentes", exact: true })).toBeVisible();
  await captureFinal(page, "06-asistente");

  await page.getByRole("button", { name: /Ver uso de contexto/u }).click();
  await expect(page.getByText(/tokens de entrada/u)).toBeVisible();
  await expect(page.getByText(/tokens totales/u)).toBeVisible();
  await expect(page.getByRole("button", { name: /fuentes/u }).first()).toBeVisible();
  await captureFinal(page, "08-contexto-usado-y-fuentes");

  await answer.getByRole("button", { name: "Abrir explicación completa de la persona", exact: true }).click();
  const explanation = page.getByRole("dialog", { name: "Explicación de la revisión de persona", exact: true });
  await expect(explanation).toBeVisible();
  await expect(explanation.getByText("10048", { exact: false }).first()).toBeVisible();
  await expect(explanation.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await expect(explanation.getByRole("heading", { name: "Conceptos descuadrados", exact: true })).toBeVisible();
  await captureFinal(page, "09-modal-explicativo-persona");

  await explanation.getByRole("button", { name: "Abrir fuente completa", exact: true }).click();
  const sourcePanel = page.getByRole("complementary", { name: "Detalle de la fuente", exact: true });
  await expect(sourcePanel).toBeVisible();
  await expect(sourcePanel.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await sourcePanel.getByRole("button", { name: "Cerrar fuente", exact: true }).click();

  await page.reload();
  await openDesktopView(page, "Asistente");
  await expect(page.getByRole("article", { name: "Respuesta del Asistente", exact: true }).last()).toContainText("matrícula 10048");
  await expect(page.getByText("Principal: matrícula 10048", { exact: true })).toBeVisible();
}

test("procesa las fuentes reales, valida toda la aplicación y genera las capturas finales", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  mkdirSync(screenshots, { recursive: true });
  mkdirSync(finalScreenshots, { recursive: true });

  const pdfFiles = payrollFiles();
  expect(pdfFiles).toHaveLength(21);
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

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByLabel("Seleccionar recibos").setInputFiles(pdfFiles);
  await page.getByLabel("Seleccionar Excel").setInputFiles(registroFile);
  await expect(page.getByText("21 recibos seleccionados", { exact: true })).toBeVisible();
  await expect(page.getByText(path.basename(registroFile), { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Analizar", exact: true }).click();
  await expect(page.getByRole("button", { name: /Analizando/u })).toBeDisabled();
  await expect(page.getByTestId("primary-kpis").getByText("Personas analizadas", { exact: true })).toBeVisible({ timeout: 12 * 60_000 });
  await expect(page.getByText("21 recibos", { exact: true })).toBeVisible();
  await expect(page.getByText("Recibo sin Reg. Retrib.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Conceptos pendientes de revisión", { exact: true })).toBeVisible();
  await capture(page, screenshots, "dashboard-real", true);
  await captureFinal(page, "01-inicio");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar Excel", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^comparativa_reg_retributivo_\d{4}-\d{2}-\d{2}\.xlsx$/u);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  expect(statSync(downloadedPath!).size).toBeGreaterThan(10_000);

  await openDesktopView(page, "Personas");
  await expect(page.getByRole("columnheader", { name: "Matrícula", exact: true })).toBeVisible();
  await expect(page.getByText("10048", { exact: true }).first()).toBeVisible();
  await captureFinal(page, "02-personas");

  await openDesktopView(page, "Conceptos");
  await expect(page.getByRole("columnheader", { name: "Código Reg. Retrib.", exact: true })).toBeVisible();
  await captureFinal(page, "03-conceptos");

  await openDesktopView(page, "Cuadre Reg.");
  await expect(page.getByRole("tab", { name: "No norm. / Desglose", exact: true })).toHaveAttribute("aria-selected", "true");
  await captureFinal(page, "04-cuadre-del-registro");
  await page.getByRole("tab", { name: "Normalizados", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Normalizados", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "No norm. / Norm. + variables", exact: true }).click();
  await expect(page.getByRole("tab", { name: "No norm. / Norm. + variables", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "No norm. / Desglose", exact: true }).click();

  await openDesktopView(page, "Agrupaciones");
  await captureFinal(page, "05-agrupaciones");

  await createRealAssistantReview(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await openMobileView(page, "Asistente");
  await expect(page.getByRole("article", { name: "Respuesta del Asistente", exact: true }).last()).toContainText("matrícula 10048");
  await captureFinal(page, "12-asistente-movil");

  await openMobileView(page, "Personas");
  await expect(page.getByText("10048", { exact: true }).first()).toBeVisible();
  await captureFinal(page, "13-tabla-movil");

  await page.setViewportSize({ width: 1600, height: 1000 });
  await openDesktopView(page, "Asistente");
  await page.getByRole("button", { name: "Activar modo oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("article", { name: "Respuesta del Asistente", exact: true }).last()).toContainText("matrícula 10048");
  await captureFinal(page, "14-asistente-modo-oscuro");

  await page.getByRole("button", { name: "Activar modo claro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await openDesktopView(page, "Historial");
  await expect(page.getByRole("button", { name: "Abrir análisis", exact: true })).toBeVisible();
  await expect(page.getByText(path.basename(registroFile), { exact: true })).toBeVisible();
  await captureFinal(page, "10-historial");

  await openDesktopView(page, "Ajustes");
  await page.getByRole("tab", { name: "Apariencia", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Modo de visualización", exact: true })).toBeVisible();
  await captureFinal(page, "11-ajustes");

  await openDesktopView(page, "Historial");
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar análisis conservando conversaciones", exact: true }).click();
  await expect(page.getByText("No hay análisis guardados todavía", { exact: true })).toBeVisible();
  await openDesktopView(page, "Asistente");
  await expect(page.getByRole("alert")).toContainText("El análisis original fue eliminado");
  await expect(page.getByText("Histórica no disponible", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Pregunta", exact: true })).toBeDisabled();

  await page.reload();
  await openDesktopView(page, "Asistente");
  await expect(page.getByRole("alert")).toContainText("El análisis original fue eliminado");
  await expect(page.getByRole("textbox", { name: "Pregunta", exact: true })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente", exact: true }).last()).toContainText("matrícula 10048");

  expect(pageErrors, `Errores de página: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(serverErrors, `Respuestas 5xx: ${serverErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Errores de consola: ${consoleErrors.join(" | ")}`).toEqual([]);
});
