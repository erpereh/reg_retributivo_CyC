"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/common/Card";
import { cn } from "@/lib/utils/classNames";

interface StatCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
  readonly icon: LucideIcon;
  readonly highlight?: boolean;
  readonly index?: number;
}

export function StatCard({ label, value, detail, icon: Icon, highlight = false, index = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.22), ease: "easeOut" }}
    >
      <Card interactive tone={highlight ? "blue" : "default"} className="min-h-[150px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-sm font-medium", highlight ? "text-blue-50" : "text-muted")}>{label}</p>
            <p className={cn("mt-4 break-words text-3xl font-semibold leading-none", highlight ? "text-white" : "text-ink")}>
              {value}
            </p>
          </div>
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
              highlight ? "bg-white text-primary" : "bg-blue-50 text-primary",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        {detail ? <p className={cn("mt-5 text-sm", highlight ? "text-blue-50" : "text-muted")}>{detail}</p> : null}
      </Card>
    </motion.div>
  );
}
