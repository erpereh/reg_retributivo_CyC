import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, meta }: Readonly<{ title: string; subtitle?: string; actions?: ReactNode; meta?: ReactNode }>) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted sm:text-base">{subtitle}</p> : null}
        {meta ? <div className="mt-3">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
