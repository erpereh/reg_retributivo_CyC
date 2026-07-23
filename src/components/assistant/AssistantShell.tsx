"use client";

import { MessageSquareText, PanelRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantDrawer } from "@/components/assistant/AssistantDrawer";
import { ContextSidebar } from "@/components/assistant/ContextSidebar";
import { ConversationSidebar } from "@/components/assistant/ConversationSidebar";
import { ConversationTimeline } from "@/components/assistant/ConversationTimeline";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";
import { SourcePanel } from "@/components/assistant/SourcePanel";
import type { SourceReference } from "@/lib/assistant/domain";

export function AssistantShell({ assistant }: Readonly<{ assistant: AssistantContextValue }>) {
  const [drawer, setDrawer] = useState<"conversations" | "context">();
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const [contextUsageOpen, setContextUsageOpen] = useState(false);
  const [openSource, setOpenSource] = useState<SourceReference>();
  const conversationsTrigger = useRef<HTMLButtonElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  const chatFallback = useRef<HTMLElement>(null);
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;

  const closeDrawer = useCallback(() => {
    const previous = drawerRef.current;
    setPeoplePickerOpen(false);
    setContextUsageOpen(false);
    setDrawer(undefined);
    if (previous) (previous === "conversations" ? conversationsTrigger : contextTrigger).current?.focus();
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const wide = window.matchMedia("(min-width: 1280px)");
    const medium = window.matchMedia("(min-width: 1024px)");
    const closeForBreakpoint = () => {
      const current = drawerRef.current;
      if ((wide.matches && current) || (medium.matches && current === "context")) {
        setDrawer(undefined);
        chatFallback.current?.focus();
      }
    };
    wide.addEventListener?.("change", closeForBreakpoint);
    medium.addEventListener?.("change", closeForBreakpoint);
    closeForBreakpoint();
    return () => {
      wide.removeEventListener?.("change", closeForBreakpoint);
      medium.removeEventListener?.("change", closeForBreakpoint);
    };
  }, []);

  const conversationPanel = (
    <ConversationSidebar
      conversations={assistant.conversations}
      selectedId={assistant.conversation?.id}
      hasMore={assistant.hasMoreConversations}
      transitionPending={assistant.conversationTransitionPending}
      onLoadMore={() => void assistant.loadMoreConversations()}
      onSelect={(id) => { closeDrawer(); void assistant.selectConversation(id); }}
      onCreate={() => { closeDrawer(); void assistant.createGeneralConversation(); }}
      onRename={(title) => void assistant.renameConversation(title)}
      onDelete={() => void assistant.deleteConversation()}
    />
  );

  const contextPanel = (showPeoplePicker: boolean, showContextUsage: boolean) => (
    <ContextSidebar
      assistant={assistant}
      peoplePickerOpen={showPeoplePicker ? peoplePickerOpen : false}
      onPeoplePickerOpenChange={setPeoplePickerOpen}
      contextUsageOpen={showContextUsage ? contextUsageOpen : false}
      onContextUsageOpenChange={setContextUsageOpen}
    />
  );

  const showContextUsage = () => {
    if (window.matchMedia?.("(min-width: 1024px)").matches) {
      setContextUsageOpen(true);
      return;
    }
    setDrawer("context");
    setContextUsageOpen(true);
  };

  return (
    <section ref={chatFallback} tabIndex={-1} aria-label="Área de conversación" data-testid="assistant-shell" className="assistant-workbench">
      <div className="assistant-workbench__mobilebar xl:hidden">
        <button ref={conversationsTrigger} type="button" aria-label="Abrir conversaciones" aria-expanded={drawer === "conversations"} onClick={() => setDrawer("conversations")}>
          <MessageSquareText aria-hidden="true" className="size-4" /><span>Conversaciones</span>
        </button>
        <button ref={contextTrigger} type="button" className="lg:hidden" aria-label="Abrir contexto" aria-expanded={drawer === "context"} onClick={() => setDrawer("context")}>
          <PanelRight aria-hidden="true" className="size-4" /><span>Contexto</span>
        </button>
      </div>

      <div className="assistant-workbench__grid">
        <div className="assistant-workbench__conversations hidden xl:block">{conversationPanel}</div>
        <ConversationTimeline assistant={assistant} onShowContextUsage={showContextUsage} onOpenSource={setOpenSource} />
        <div className="assistant-workbench__context hidden lg:block">{contextPanel(drawer !== "context", drawer !== "context")}</div>
      </div>

      <AssistantDrawer open={drawer === "conversations"} title="Conversaciones" side="left" onClose={closeDrawer}>{conversationPanel}</AssistantDrawer>
      <AssistantDrawer open={drawer === "context"} title="Contexto" side="right" onClose={closeDrawer}>{contextPanel(drawer === "context", drawer === "context")}</AssistantDrawer>
      {openSource ? <SourcePanel source={openSource} onClose={() => setOpenSource(undefined)} /> : null}
    </section>
  );
}
