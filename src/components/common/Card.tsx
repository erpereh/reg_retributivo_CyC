"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/classNames";

interface CardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  readonly children: ReactNode;
  readonly interactive?: boolean;
  readonly tone?: "default" | "blue";
}

export function Card({ children, className, interactive = false, tone = "default", ...props }: CardProps) {
  return (
    <motion.div
      data-slot="card"
      whileHover={undefined}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "min-w-0 overflow-hidden rounded-[14px] border bg-white text-ink shadow-none",
        tone === "blue" ? "border-primary/15 bg-indigo-50/35" : "border-line",
        interactive && "transition-colors duration-150 hover:border-primary/25",
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
