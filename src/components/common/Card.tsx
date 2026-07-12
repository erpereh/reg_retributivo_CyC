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
      className={cn(
        "min-w-0 rounded-[18px] border bg-white text-ink shadow-subtle",
        tone === "blue"
          ? "border-primary/30 border-t-2"
          : "border-line/90",
        interactive && "transition-colors duration-150 hover:border-primary/30",
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
