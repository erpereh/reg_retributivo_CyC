"use client";

import type { ReactNode } from "react";

interface SectionHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
}

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="max-w-4xl text-3xl font-semibold leading-tight text-ink sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-base leading-7 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
