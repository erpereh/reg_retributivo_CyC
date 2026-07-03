"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Card } from "@/components/common/Card";

interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="p-8 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="mx-auto flex max-w-xl flex-col items-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-primary">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </motion.div>
    </Card>
  );
}
