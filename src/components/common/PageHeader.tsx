import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, meta }: Readonly<{ title: string; subtitle?: string; actions?: ReactNode; meta?: ReactNode }>) {
  return (
    <div data-slot="page-header" className="page-heading">
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {meta ? <div className="mt-3">{meta}</div> : null}
      </div>
      {actions ? <div className="page-heading__actions">{actions}</div> : null}
    </div>
  );
}
