import { createAssistantChatRoute } from "@/lib/assistant/server/chatService";

export const runtime = "nodejs";
export const POST = createAssistantChatRoute();
