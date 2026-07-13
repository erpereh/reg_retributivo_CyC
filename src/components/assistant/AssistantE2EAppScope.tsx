"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantE2EHarness } from "@/components/assistant/AssistantE2EHarness";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { ModelProfile } from "@/lib/assistant/domain";

const profile = (id: string, modelId: string): ModelProfile => ({
  id, name: id, provider: "openai", baseUrl: "https://api.openai.com/v1", modelId,
  enabled: true, generalChatCompatible: true, analysisCompatible: true,
  supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true,
  detectedContextWindow: 32_768, maxOutputTokens: 2_048, capabilitiesSource: "detected",
});

export function AssistantE2EAppScope({ children }: Readonly<{ children: ReactNode }>) {
  const { activeAnalysis, navigateAssistantIntent } = useAppState();
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repositories = await createIndexedDbRepositories();
      const settings = { id: "assistant-settings" as const, defaultGeneralModelProfileId: "e2e-default", defaultAnalysisModelProfileId: "e2e-default", responseMode: "strict" as const, contextStrategy: "automatic" as const, safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85 };
      await repositories.writeModelConfiguration({ profile: profile("e2e-current", "e2e-current-model"), settings });
      await repositories.writeModelConfiguration({
        profile: profile("e2e-default", "e2e-default-model"),
        settings,
      });
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
