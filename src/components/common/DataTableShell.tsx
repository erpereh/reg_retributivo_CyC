import type { ReactNode } from "react";
import { Card } from "@/components/common/Card";
import { cn } from "@/lib/utils/classNames";

export function DataTableShell({ toolbar, summary, children, empty, className, viewportClassName = "max-h-[70dvh]" }: Readonly<{ toolbar?: ReactNode; summary?: ReactNode; children: ReactNode; empty?: ReactNode; className?: string; viewportClassName?: string }>) {
  return (
    <Card data-surface="table-shell" className={cn("overflow-hidden rounded-[14px] p-0 shadow-none", className)}>
      {toolbar ? <div data-slot="table-toolbar" className="border-b border-line/80 bg-white/80 px-4 py-4 sm:px-6 sm:py-5">{toolbar}</div> : null}
      {summary ? <div data-slot="table-summary" className="border-b border-line/70 bg-slate-50/70 px-4 py-3 sm:px-6">{summary}</div> : null}
      <div data-slot="table-viewport" className={cn("overflow-auto bg-white/90", viewportClassName)}>
        {children}
        {empty}
      </div>
    </Card>
  );
}
