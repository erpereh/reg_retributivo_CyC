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
      whileHover={interactive ? { y: -2 } : undefined}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "min-w-0 overflow-hidden rounded-[22px] border bg-white/95 text-ink shadow-card backdrop-blur-sm",
        tone === "blue" ? "border-primary/20 bg-gradient-to-br from-white via-white to-indigo-50/70" : "border-line/80",
        interactive && "transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-card-hover",
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
