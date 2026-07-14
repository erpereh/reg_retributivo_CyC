"use client";

import { MessageSquareText, PanelRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantDrawer } from "@/components/assistant/AssistantDrawer";
import { ContextSidebar } from "@/components/assistant/ContextSidebar";
import { ConversationSidebar } from "@/components/assistant/ConversationSidebar";
import { ConversationTimeline } from "@/components/assistant/ConversationTimeline";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";

export function AssistantShell({ assistant }: Readonly<{ assistant: AssistantContextValue }>) {
  const [drawer, setDrawer] = useState<"conversations" | "context">();
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const conversationsTrigger = useRef<HTMLButtonElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  const chatFallback = useRef<HTMLElement>(null);
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  const closeDrawer = useCallback(() => { const previous = drawerRef.current; setPeoplePickerOpen(false); setDrawer(undefined); if (previous) (previous === "conversations" ? conversationsTrigger : contextTrigger).current?.focus(); }, []);
  useEffect(() => {
    if (!window.matchMedia) return;
    const wide = window.matchMedia("(min-width: 1280px)"); const medium = window.matchMedia("(min-width: 1024px)");
    const closeForBreakpoint = () => { const current = drawerRef.current; if ((wide.matches && current) || (medium.matches && current === "context")) { setDrawer(undefined); chatFallback.current?.focus(); } };
    wide.addEventListener?.("change", closeForBreakpoint); medium.addEventListener?.("change", closeForBreakpoint); closeForBreakpoint();
    return () => { wide.removeEventListener?.("change", closeForBreakpoint); medium.removeEventListener?.("change", closeForBreakpoint); };
  }, []);
  const conversationPanel = <ConversationSidebar conversations={assistant.conversations} selectedId={assistant.conversation?.id} hasMore={assistant.hasMoreConversations} transitionPending={assistant.conversationTransitionPending} onLoadMore={() => void assistant.loadMoreConversations()} onSelect={(id) => { closeDrawer(); void assistant.selectConversation(id); }} onCreate={() => { closeDrawer(); void assistant.createGeneralConversation(); }} onRename={(title) => void assistant.renameConversation(title)} onDelete={() => void assistant.deleteConversation()} />;
  const contextPanel = (showPeoplePicker: boolean) => <ContextSidebar assistant={assistant} peoplePickerOpen={showPeoplePicker ? peoplePickerOpen : false} onPeoplePickerOpenChange={setPeoplePickerOpen} />;
  const managePeople = () => { if (assistant.conversation?.type !== "analysis") return; setDrawer((current) => current ?? "context"); setPeoplePickerOpen(true); };
  return <section ref={chatFallback} tabIndex={-1} aria-label="Area de conversacion" data-testid="assistant-shell" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-line/80">
    <div className="flex min-h-14 items-center gap-2 border-b border-line bg-white px-3 xl:hidden"><button ref={conversationsTrigger} type="button" className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-ink hover:bg-slate-100" aria-label="Abrir conversaciones" aria-expanded={drawer === "conversations"} onClick={() => setDrawer("conversations")}><MessageSquareText aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Conversaciones</span></button><button ref={contextTrigger} type="button" className="ms-auto inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-ink hover:bg-slate-100 lg:hidden" aria-label="Abrir contexto" aria-expanded={drawer === "context"} onClick={() => setDrawer("context")}><PanelRight aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Contexto</span></button></div>
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[17rem_minmax(0,1fr)_19rem]"><div className="hidden min-h-0 overflow-hidden border-r border-line xl:block">{conversationPanel}</div><ConversationTimeline assistant={assistant} onManagePeople={managePeople} /><div className="hidden min-h-0 overflow-hidden border-l border-line lg:block">{contextPanel(drawer !== "context")}</div></div>
    <AssistantDrawer open={drawer === "conversations"} title="Conversaciones" side="left" onClose={closeDrawer}>{conversationPanel}</AssistantDrawer><AssistantDrawer open={drawer === "context"} title="Contexto" side="right" onClose={closeDrawer}>{contextPanel(drawer === "context")}</AssistantDrawer>
  </section>;
}
