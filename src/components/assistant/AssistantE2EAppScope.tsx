"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantE2EHarness } from "@/components/assistant/AssistantE2EHarness";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { catalogKey, type ModelCatalogEntry, type ProviderConfig } from "@/lib/assistant/catalog/domain";

const provider: ProviderConfig = { id: "e2e-provider", providerType: "openai", displayName: "E2E", baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY", enabled: true, connectionStatus: "connected", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const model = (modelId: string): ModelCatalogEntry => ({ id: catalogKey(provider.id, modelId), providerId: provider.id, canonicalModelId: modelId, apiModelId: modelId, generationModelId: modelId, displayName: modelId, contextWindow: 32_768, maxOutputTokens: 2_048, capabilities: { chat: true, tools: true, streaming: true, vision: false, documents: false }, availability: "available", metadataSource: "adapter", detectedAt: "2026-01-01T00:00:00.000Z" });

export function AssistantE2EAppScope({ children }: Readonly<{ children: ReactNode }>) {
  const { activeAnalysis, navigateAssistantIntent } = useAppState();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repositories = await createIndexedDbRepositories();
      await repositories.providerConfigs.put(provider);
      const entries = [model("e2e-current-model"), model("e2e-default-model")];
      await repositories.replaceProviderCatalog(provider.id, entries);
      await repositories.saveModelPreferences({ id: "model-preferences", favoriteCatalogEntryIds: [], recentCatalogEntryIds: [entries[0]!.id], lastCatalogEntryId: entries[0]!.id, updatedAt: new Date().toISOString() });
      repositories.close();
      if (!cancelled) setSeeded(true);
    })();
    return () => { cancelled = true; };
  }, []);
  if (!seeded) return null;
  return <AssistantProvider activeAnalysis={activeAnalysis} onNavigate={navigateAssistantIntent}>
    <AssistantE2EHarness />
    {children}
  </AssistantProvider>;
}
