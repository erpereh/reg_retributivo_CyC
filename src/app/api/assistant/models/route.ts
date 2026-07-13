import { createModelService } from "@/lib/assistant/server/modelService";
import { createModelsPostHandler } from "@/lib/assistant/server/modelsRoute";

export const runtime = "nodejs";

export const POST = createModelsPostHandler(createModelService());
