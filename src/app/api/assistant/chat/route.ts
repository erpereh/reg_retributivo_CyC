import { createAssistantChatRoute } from "@/lib/assistant/server/chatService";
import { createE2EChatAdapterResolver, isAssistantE2EMode } from "@/lib/assistant/server/e2eAdapter";

export const runtime = "nodejs";
export const POST = isAssistantE2EMode()
  ? createAssistantChatRoute(createE2EChatAdapterResolver())
  : createAssistantChatRoute();
