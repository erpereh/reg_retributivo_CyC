import type { ReactNode } from "react";
import { cn } from "@/lib/utils/classNames";

export function Toolbar({ children, className, label }: Readonly<{ children: ReactNode; className?: string; label?: string }>) {
  return <div data-slot="toolbar" role={label ? "group" : undefined} aria-label={label} className={cn("flex flex-wrap items-end gap-3", className)}>{children}</div>;
}
