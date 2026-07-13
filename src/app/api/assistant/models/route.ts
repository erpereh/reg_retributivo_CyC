import { createModelService } from "@/lib/assistant/server/modelService";
import { createModelsPostHandler } from "@/lib/assistant/server/modelsRoute";
import { DeterministicE2EAdapter, isAssistantE2EMode } from "@/lib/assistant/server/e2eAdapter";

export const runtime = "nodejs";

const modelService = isAssistantE2EMode()
  ? createModelService({
      resolveAdapter: () => new DeterministicE2EAdapter(),
      env: {
        GEMINI_API_KEY: "e2e-ephemeral-key",
        OPENAI_API_KEY: "e2e-ephemeral-key",
        OPENROUTER_API_KEY: "e2e-ephemeral-key",
        CEREBRAS_API_KEY: "e2e-ephemeral-key",
        GROQ_API_KEY: "e2e-ephemeral-key",
      },
    })
  : createModelService();

export const POST = createModelsPostHandler(modelService);
