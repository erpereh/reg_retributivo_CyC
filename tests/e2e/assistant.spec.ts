import { expect, test, type Page } from "@playwright/test";

const LOCAL_WARNING = "Las API keys se leen solo desde variables de entorno del servidor. Conversaciones y contexto sanitizado permanecen en IndexedDB.";

async function openAssistant(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByTestId("assistant-shell")).toBeVisible();
}

async function waitForE2EHarness(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__assistantE2E))).toBe(true);
}

async function openSameOriginSeedPage(page: Page) {
  await page.route("**/assistant-e2e-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>E2E seed</title>" }));
  await page.goto("/assistant-e2e-seed");
}

async function seedAnalysis(page: Page, analysisId = "analysis-e2e") {
  await page.evaluate(async (id) => {
    const createdAt = "2026-07-13T10:00:00.000Z";
    const person = (employeeNumber: string, personName: string, difference: number) => ({
      employeeNumber, person: personName, workplace: "Centro", position: "Técnico", category: "A1",
      salaryRegistro: 1000, salaryPdf: 990, salaryDifference: 10, salaryComplementRegistro: 100, salaryComplementPdf: 100,
      salaryComplementDifference: 0, extraSalaryRegistro: 50, extraSalaryPdf: 50, extraSalaryDifference: 0,
      registroTotal: 1150, pdfTotal: 1140, totalDifference: difference, pdfControlTotalDevengado: 1140, payrollCount: 1,
      unmappedConceptsCount: 0, status: "Diferencia", detail: "Diferencia sanitizada", periods: ["2026-01"], files: [],
    });
    const record = {
      id, schemaVersion: 2, createdAt, registroFileName: "registro-sanitizado.xlsx", pdfCount: 2,
      config: { tolerance: 1, enableAI: false, aiModel: "e2e-model", thresholds: { reviewThreshold: 1, incidentThreshold: 50 } },
      result: {
        summary: { generatedAt: createdAt, pdfsAnalyzed: 2, pdfsFailed: 0, uniquePeople: 2, peopleWithDifferences: 2,
          totalSalaryDifference: 20, totalSalaryComplementDifference: 0, totalExtraSalaryDifference: 0, totalGlobalDifference: 20,
          conceptsUnmapped: 0, internalExcelDifferences: 0, groupingDifferences: 0, tolerance: 1 },
        payrollRecords: [], registroEmployees: [], people: [person("10048", "Persona Uno", 10), person("10049", "Persona Dos", 10)],
        normalizedVsReal: [], concepts: [], unmappedConcepts: [], ignoredConcepts: [], groupings: [], internalExcelChecks: [],
        conceptMap: [], errors: [], criteria: [], excludedEmployeeIdsApplied: [],
      },
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("retributivo-analysis-v1", 1);
      request.onupgradeneeded = () => { const store = request.result.createObjectStore("analyses", { keyPath: "id" }); store.createIndex("createdAt", "createdAt"); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("analyses", "readwrite"); transaction.objectStore("analyses").put(record);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close(); localStorage.setItem("retributivo.activeAnalysisId.v1", id);
  }, analysisId);
}

async function seedAssistantAnalysisConversation(page: Page, analysisId: string, id = `conversation-${analysisId}`) {
  await page.evaluate(async ({ analysisId: scopedAnalysisId, conversationId }) => {
    const createdAt = "2026-07-13T10:01:00.000Z";
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("retributivo-assistant-v1");
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(["conversations", "messages", "sources"], "readwrite");
    transaction.objectStore("conversations").put({ id: conversationId, type: "analysis", analysisId: scopedAnalysisId,
      title: `Análisis ${scopedAnalysisId}`, associatedPersonIds: ["10048"], primaryPersonId: "10048", modelProfileId: "fake-retributivo-v1",
      responseMode: "strict", contextStrategy: "automatic", analysisVersion: "safe-version", status: "active", createdAt, updatedAt: createdAt });
    transaction.objectStore("messages").put({ id: `message-${conversationId}`, conversationId, role: "assistant", content: "Evidencia sanitizada.",
      status: "completed", contextOrigin: "analysis", modelProfileId: "fake-retributivo-v1", modelId: "fake-retributivo-v1",
      responseMode: "strict", contextStrategy: "automatic", analysisVersion: "safe-version", sourceRefIds: [`source-${conversationId}`], actionIds: [], createdAt });
    transaction.objectStore("sources").put({ id: `source-${conversationId}`, conversationId, messageId: `message-${conversationId}`,
      analysisId: scopedAnalysisId, sourceType: "analysis", sanitizedSourceLabel: "Registro Retributivo · hoja Empleados",
      availability: "available", conceptIds: [], excerpt: "Evidencia sanitizada.", sanitizedHash: "safe-source-hash" });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, { analysisId, conversationId: id });
}

async function seedStructuredPersonSource(page: Page, analysisId: string, conversationId: string) {
  await page.evaluate(async ({ analysisId: scopedAnalysisId, conversationId: scopedConversationId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction("sources", "readwrite");
    const evidence = {
      personId: "10050", laborContext: { workplace: "Bilbao", position: "Delegado/a de Compras", category: "Oficial de Primera" },
      totals: { registro: 44760.16, payroll: 44968.16, difference: 208 },
      blocks: { salary: { registro: 25325.28, payroll: 25325.28, difference: 0 }, salaryComplement: { registro: 14694, payroll: 14694, difference: 0 }, extraSalary: { registro: 4740.88, payroll: 4948.88, difference: 208 } },
      status: "Diferencia", periods: ["2025-01"],
      registro: { concepts: [{ block: "Extrasalarial", blockKey: "extraSalary", code: "CSP_I_COMP_TELETR_COVID", amount: 0 }] },
      payroll: { periods: [{ period: "2025-01", concepts: [{ name: "Abono teletrabajo", amount: 208, type: "devengo" }], totals: { totalDevengado: 3700 }, bases: { irpfBaseAccumulated: 3700 } }] },
      comparisons: [{ block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CSP_I_COMP_TELETR_COVID", pdfConcept: "Abono teletrabajo", registroAmount: 0, payrollAmount: 208, difference: 208, status: "Diferencia", detail: "Comparación", cause: { label: "Teletrabajo", description: "El recibo identifica expresamente el abono.", review: "Revisar su inclusión.", confidence: "alta", facts: ["Registro 0; recibos 208."], missingEvidence: ["Confirmar documentalmente el criterio aplicado."] }, cohorts: [] }],
      cuadre: {}, completeness: { registroConcepts: 1, payrollPeriods: 1, payrollConcepts: 1, comparisons: 1, mismatches: 1 },
    };
    transaction.objectStore("sources").put({ id: `source-${scopedConversationId}`, conversationId: scopedConversationId, messageId: `message-${scopedConversationId}`, analysisId: scopedAnalysisId, personId: "10050", sourceType: "person_analysis", sanitizedSourceLabel: "Evidencia retributiva · matrícula 10050", availability: "available", conceptIds: ["CSP_I_COMP_TELETR_COVID"], excerpt: "Matrícula 10050: diferencia 208 EUR.", sanitizedHash: "structured-source-hash", presentation: { kind: "person_analysis", personId: "10050", evidence } });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
  }, { analysisId, conversationId });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    if (!sessionStorage.getItem("assistant-e2e-initialized")) {
      indexedDB.deleteDatabase("retributivo-assistant-v1");
      indexedDB.deleteDatabase("retributivo-analysis-v1");
      sessionStorage.setItem("assistant-e2e-initialized", "1");
    }
  });
});

test("persists a general conversation, streams and regenerates after reload", async ({ page }) => {
  let chatPosts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assistant/chat") chatPosts += 1; });
  await openAssistant(page);
  await page.getByRole("button", { name: "Crear conversación general" }).click();
  await page.getByLabel("Pregunta").fill("¿Qué es Cuadre Reg.?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Retributivo compara");
  await expect(page.getByRole("button", { name: "Regenerar respuesta" })).toBeVisible();
  await page.getByRole("button", { name: "Regenerar respuesta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Respuesta regenerada" })).toBeAttached();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toHaveCount(1);

  await page.reload();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" }).last()).toContainText("Retributivo compara");
  expect(chatPosts).toBeGreaterThanOrEqual(2);
});

test("stops a partial stream and retries it in a fresh run", async ({ page }) => {
  await openAssistant(page);
  await page.getByRole("button", { name: "Crear conversación general" }).click();
  await page.getByLabel("Pregunta").fill("¿Qué es Retributivo?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Respuesta parcial sanitizada");
  await page.getByRole("button", { name: "Detener respuesta" }).click();
  await expect(page.getByRole("button", { name: "Reintentar respuesta" })).toBeVisible();
  await page.getByRole("button", { name: "Reintentar respuesta" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Retributivo compara");
  await expect(page.getByRole("button", { name: "Regenerar respuesta" })).toBeVisible();
});

test("bounds transient retries in Chromium and preserves the partial producer", async ({ page }) => {
  const chatRounds: Array<{ phase?: string; modelId?: string }> = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/assistant/chat") return;
    chatRounds.push(request.postDataJSON() as { phase?: string; modelId?: string });
  });
  await openSameOriginSeedPage(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("retributivo-assistant-v1", 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("conversations", { keyPath: "id" });
        request.result.createObjectStore("modelProfiles", { keyPath: "id" });
        request.result.createObjectStore("assistantSettings", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const createdAt = "2026-07-13T10:00:00.000Z";
    const profile = (id: string, modelId: string) => ({ id, name: id, provider: "manual", baseUrl: "https://e2e.invalid/v1", modelId,
      enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true,
      supportsStructuredOutput: true, detectedContextWindow: 32768, maxOutputTokens: 2048, capabilitiesSource: "detected" });
    const transaction = db.transaction(["conversations", "modelProfiles", "assistantSettings"], "readwrite");
    transaction.objectStore("modelProfiles").put(profile("e2e-current", "e2e-current-model"));
    transaction.objectStore("modelProfiles").put(profile("e2e-default", "e2e-default-model"));
    transaction.objectStore("assistantSettings").put({ id: "assistant-settings", defaultGeneralModelProfileId: "e2e-default",
      defaultAnalysisModelProfileId: "e2e-default", responseMode: "strict", contextStrategy: "automatic",
      safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85 });
    transaction.objectStore("conversations").put({ id: "fallback-conversation", type: "general", title: "Fallback visible",
      associatedPersonIds: [], modelProfileId: "e2e-current", responseMode: "strict", contextStrategy: "automatic",
      status: "active", createdAt, updatedAt: createdAt });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  });
  await page.unroute("**/assistant-e2e-seed");
  await openAssistant(page);
  await page.getByLabel("Pregunta").fill("¿Qué compara el Registro Retributivo con los Recibos?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Primera parte sanitizada.");
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Fallida · e2e-current-model");
  await expect(page.getByRole("alert").filter({ hasText: "temporalmente" })).toContainText("temporalmente");
  await page.reload();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toHaveCount(1);
  expect(chatRounds.map(({ phase, modelId }) => ({ phase, modelId }))).toEqual([
    { phase: "plan", modelId: "e2e-current-model" },
    { phase: "continue", modelId: "e2e-current-model" },
  ]);
});

test("converts general context, associates multiple people and reuses it from Persona without auto-send", async ({ page }) => {
  await page.goto("/");
  await seedAnalysis(page);
  await page.reload();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await page.getByRole("button", { name: "Crear conversación general" }).click();
  await page.getByRole("button", { name: "Añadir contexto" }).click();
  await expect(page.getByText("Contexto del análisis añadido")).toBeVisible();
  await page.getByRole("button", { name: "Gestionar personas asociadas" }).click();
  await page.getByRole("checkbox", { name: "Matrícula 10048" }).click();
  await page.getByRole("checkbox", { name: "Matrícula 10049" }).click();
  await expect(page.getByRole("checkbox", { name: "Matrícula 10049" })).toBeChecked();
  await expect(page.getByLabel("Personas asociadas resumidas")).toContainText("10048");
  await expect(page.getByLabel("Personas asociadas resumidas")).toContainText("10049");

  await page.getByRole("tab", { name: "Personas" }).click();
  await page.getByRole("row", { name: /Abrir detalle de Persona Dos/u }).click();
  await page.getByRole("button", { name: "Continuar en Asistente" }).click();
  await expect(page.getByRole("tab", { name: "Asistente" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Principal: matrícula 10049/u)).toBeVisible();
  await expect(page.getByLabel("Tu pregunta")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toHaveCount(0);
});

test("preserves conversations as historical evidence when deleting an analysis", async ({ page }) => {
  await page.goto("/");
  await seedAnalysis(page, "analysis-preserve");
  await seedAssistantAnalysisConversation(page, "analysis-preserve");
  await page.reload();
  await page.getByRole("tab", { name: "Historial" }).click();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar análisis conservando conversaciones" }).click();
  await expect(page.getByText("No hay análisis guardados todavía")).toBeVisible();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByText("Histórica no disponible")).toBeVisible();
  await expect(page.getByLabel("Pregunta")).toBeDisabled();
});

test("renders complete person evidence as responsive cards and tables without technical JSON", async ({ page }) => {
  await page.goto("/");
  await seedAnalysis(page, "analysis-person-source");
  await seedAssistantAnalysisConversation(page, "analysis-person-source", "conversation-person-source");
  await seedStructuredPersonSource(page, "analysis-person-source", "conversation-person-source");
  await page.reload();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await page.getByRole("button", { name: "Abrir fuente Evidencia retributiva · matrícula 10050" }).click();
  const panel = page.getByRole("complementary", { name: "Detalle de la fuente" });
  await expect(panel.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Conceptos descuadrados" })).toBeVisible();
  await expect(panel.getByText("Abono teletrabajo").first()).toBeVisible();
  await expect(panel.getByText("Confianza alta").first()).toBeVisible();
  await expect(panel.getByText("Registro Retributivo", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Recibos por periodo")).toBeVisible();
  await expect(panel).not.toContainText("getPersonProfile");
  await expect(panel).not.toContainText('"comparisons"');
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("deletes assistant records totally and resumes a pending cleanup job after reload", async ({ page }) => {
  await page.goto("/");
  await seedAnalysis(page, "analysis-delete");
  await seedAssistantAnalysisConversation(page, "analysis-delete");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Comparativa Recibos vs Registro Retributivo" })).toBeVisible();
  await page.getByRole("tab", { name: "Historial" }).click();
  await expect(page.getByRole("heading", { name: "Historial de análisis" })).toBeVisible();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await page.getByRole("button", { name: "Eliminar análisis y conversaciones" }).click();
  await expect(page.getByText("No hay análisis guardados todavía")).toBeVisible();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByText("Consulta el análisis con privacidad local")).toBeVisible();

  await seedAnalysis(page, "analysis-resume");
  await seedAssistantAnalysisConversation(page, "analysis-resume");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction("cleanupJobs", "readwrite");
    transaction.objectStore("cleanupJobs").put({ id: "cleanup-analysis-resume-delete_all", analysisId: "analysis-resume",
      scope: { type: "analysis", analysisId: "analysis-resume" }, policy: "delete_all", stage: "pending", status: "pending",
      documentIds: [], attempts: 0, createdAt: "2026-07-13T10:02:00.000Z", updatedAt: "2026-07-13T10:02:00.000Z" });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
  });
  await page.reload();
  await page.getByRole("tab", { name: "Historial" }).click();
  await expect(page.getByText("No hay análisis guardados todavía")).toBeVisible();
});

test("keeps general documents isolated and copies only explicit sanitized context", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const stores = ["conversations", "messages", "actions", "documents", "chunks", "searchTerms", "indexJobs"];
    const transaction = db.transaction(stores, "readwrite");
    const base = { type: "general", associatedPersonIds: [], modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-07-13T10:00:00.000Z" };
    transaction.objectStore("conversations").put({ ...base, id: "copy-source", title: "Origen explícito", updatedAt: "2026-07-13T10:03:00.000Z" });
    transaction.objectStore("conversations").put({ ...base, id: "copy-target", title: "Destino explícito", updatedAt: "2026-07-13T10:02:00.000Z" });
    transaction.objectStore("conversations").put({ ...base, id: "other-source", title: "Otro contexto", updatedAt: "2026-07-13T10:01:00.000Z" });
    transaction.objectStore("messages").put({ id: "copy-message", conversationId: "copy-source", role: "assistant", content: "Propone una copia segura.", status: "completed", contextOrigin: "general", modelProfileId: "fake-retributivo-v1", modelId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", sourceRefIds: [], actionIds: ["copy-action"], createdAt: "2026-07-13T10:03:00.000Z" });
    transaction.objectStore("actions").put({ id: "copy-action", conversationId: "copy-source", messageId: "copy-message", label: "Copiar contexto", description: "Copiar documento sanitizado al destino explícito", action: { type: "copy_document_context", sourceConversationId: "copy-source", targetConversationId: "copy-target", documentIds: ["document-source"] }, status: "pending", createdAt: "2026-07-13T10:03:00.000Z" });
    for (const [documentId, conversationId, content] of [["document-source", "copy-source", "texto sanitizado origen"], ["document-other", "other-source", "texto sanitizado separado"]]) {
      transaction.objectStore("documents").put({ id: documentId, sanitizedSourceLabel: `Documento ${documentId}`, scope: { type: "conversation", conversationId }, mediaType: "txt", status: "ready", createdAt: "2026-07-13T10:00:00.000Z", updatedAt: "2026-07-13T10:00:00.000Z" });
      transaction.objectStore("chunks").put({ id: `${documentId}-chunk`, documentId, sequence: 0, content, snippet: content, sanitizedHash: `safe-${documentId}`, terms: ["texto", "sanitizado"] });
      transaction.objectStore("searchTerms").put({ id: `${documentId}-term`, documentId, chunkId: `${documentId}-chunk`, term: "texto", positions: [0] });
      transaction.objectStore("indexJobs").put({ id: `${documentId}-job`, documentId, status: "ready", indexedChunkIds: [`${documentId}-chunk`] });
    }
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
  });
  await page.reload();
  await page.getByRole("tab", { name: "Asistente" }).click();
  await page.getByRole("button", { name: "Aceptar Copiar contexto" }).click();
  const copied = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction("documents", "readonly"); const all = await new Promise<any[]>((resolve, reject) => { const request = transaction.objectStore("documents").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close();
    return all.filter((document) => document.scope?.conversationId === "copy-target").map((document) => document.id);
  });
  expect(copied).toEqual(["document-source-copy-copy-target"]);
});

test("mobile drawers restore focus, close with Escape and honor reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAssistant(page);
  const trigger = page.getByRole("button", { name: "Abrir conversaciones" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Conversaciones" })).toBeVisible();
  const reducedDuration = await page.getByTestId("assistant-drawer-panel").evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0);
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Conversaciones" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keeps the responsive shell within every approved viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openAssistant(page);
  await page.getByRole("button", { name: "Crear conversación general" }).click();
  await page.getByLabel("Pregunta").fill("¿Qué es Cuadre Reg.?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("article", { name: "Respuesta del Asistente" })).toContainText("Retributivo compara");
  const longModelId = "m".repeat(256);
  await page.evaluate(async (modelId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction("messages", "readwrite"); const store = transaction.objectStore("messages");
    const messages = await new Promise<any[]>((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    for (const message of messages.filter((item) => item.role === "assistant")) store.put({ ...message, modelId });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
  }, longModelId);
  await page.reload(); await page.getByRole("tab", { name: "Asistente" }).click();
  await expect(page.getByTitle(longModelId)).toBeVisible();
  for (const width of [1600, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId("assistant-shell")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("keyboard navigation and the local non-encrypted storage warning remain accessible", async ({ page }) => {
  await page.goto("/");
  const dashboard = page.getByRole("tab", { name: "Dashboard" });
  await dashboard.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Ajustes" })).toBeFocused();
  await page.getByRole("tab", { name: "Ajustes" }).click();
  await page.getByRole("tab", { name: "IA", exact: true }).click();
  await expect(page.getByText(LOCAL_WARNING)).toBeVisible();
});

test("provider settings never expose or persist API key values", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Parámetros de análisis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inteligencia Artificial" })).toHaveCount(0);
  await page.getByRole("tab", { name: "IA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Borrar caché de explicaciones" })).toBeVisible();
  await page.getByLabel("Tipo de proveedor").selectOption("openai-compatible");
  await page.getByRole("button", { name: "Añadir proveedor" }).click();
  await expect(page.getByLabel("Variable de entorno")).toHaveValue("OPENAI_COMPATIBLE_MY_PROVIDER_API_KEY");
  await expect(page.getByLabel(/clave|api key/i)).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Ajustes" }).click();
  await page.getByRole("tab", { name: "IA", exact: true }).click();
  await expect(page.getByText("OPENAI_API_KEY", { exact: false })).toBeVisible();
  await expect(page.getByLabel(/clave|api key/i)).toHaveCount(0);
});

test("migration v4 renders preserved evidence as historical and read-only", async ({ page }) => {
  await openSameOriginSeedPage(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("retributivo-assistant-v1", 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("conversations", { keyPath: "id" });
        request.result.createObjectStore("messages", { keyPath: "id" });
        request.result.createObjectStore("sources", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(["conversations", "messages", "sources"], "readwrite");
    const createdAt = "2026-07-13T10:00:00.000Z";
    transaction.objectStore("conversations").put({
      id: "historical-conversation", type: "analysis", analysisId: "analysis-deleted", title: "Evidencia histórica",
      associatedPersonIds: ["10048"], primaryPersonId: "10048", modelProfileId: "fake-local-model", responseMode: "strict",
      contextStrategy: "automatic", analysisVersion: "safe-version", status: "archived_analysis_deleted", createdAt, updatedAt: createdAt,
    });
    transaction.objectStore("messages").put({
      id: "historical-message", conversationId: "historical-conversation", role: "assistant", content: "Resultado histórico sanitizado.",
      status: "completed", contextOrigin: "analysis", modelProfileId: "fake-local-model", modelId: "fake-local-model", responseMode: "strict",
      contextStrategy: "automatic", analysisVersion: "safe-version", sourceRefIds: ["available-source", "historical-source", "deleted-source"], actionIds: [], createdAt,
    });
    transaction.objectStore("sources").put({
      id: "available-source", conversationId: "historical-conversation", messageId: "historical-message", analysisId: "analysis-deleted",
      sourceType: "person_profile", sanitizedSourceLabel: "Fuente disponible", availability: "available",
      conceptIds: [], excerpt: "Importes disponibles sanitizados.", sanitizedHash: "safe-available-hash",
    });
    transaction.objectStore("sources").put({
      id: "historical-source", conversationId: "historical-conversation", messageId: "historical-message", analysisId: "analysis-deleted",
      sourceType: "person_profile", sanitizedSourceLabel: "Recibo matrícula 10048 · enero", availability: "historical_unavailable",
      conceptIds: [], excerpt: "Importes históricos sanitizados.", sanitizedHash: "safe-historical-hash",
    });
    transaction.objectStore("sources").put({
      id: "deleted-source", conversationId: "historical-conversation", messageId: "historical-message", analysisId: "analysis-deleted",
      sourceType: "person_profile", sanitizedSourceLabel: "Fuente eliminada", availability: "deleted",
      conceptIds: [], excerpt: "", sanitizedHash: "safe-deleted-hash",
    });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  });
  await page.unroute("**/assistant-e2e-seed");
  await openAssistant(page);
  const migratedVersion = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("retributivo-assistant-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
    const version = db.version; db.close(); return version;
  });
  expect(migratedVersion).toBe(5);
  await expect(page.getByRole("heading", { name: "Evidencia histórica" })).toBeVisible();
  await expect(page.getByText("Histórica no disponible")).toBeVisible();
  await expect(page.getByText("Disponible", { exact: true })).toBeVisible();
  await expect(page.getByText("Eliminada", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fuente histórica no disponible" })).toBeDisabled();
  await expect(page.getByLabel("Pregunta")).toBeDisabled();
});

test("direct indexing benchmark uses 5,200 sanitized chunks, a warm-up and five runs", async ({ page }, testInfo) => {
  await page.goto("/");
  await waitForE2EHarness(page);
  const metric = await page.evaluate(async () => window.__assistantE2E!.measureDirectIndex());
  expect(metric.runs).toBe(5);
  expect(metric.measurements).toHaveLength(5);
  expect(metric.medianMs).toBeGreaterThanOrEqual(0);
  expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.medianMs ?? 0);
  expect(metric.longTaskDurations.filter((duration) => duration > 50)).toHaveLength(0);
  expect(metric.workerRequired).toBe(false);
  await testInfo.attach("direct-index-metrics.json", { body: JSON.stringify(metric, null, 2), contentType: "application/json" });
  console.log(`INDEX_METRICS ${JSON.stringify(metric)}`);
});
