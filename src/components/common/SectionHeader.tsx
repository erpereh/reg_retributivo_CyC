"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/common/PageHeader";

interface SectionHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
}

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} />;
}
