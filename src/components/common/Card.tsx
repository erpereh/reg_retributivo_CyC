"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/classNames";

interface CardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  readonly children: ReactNode;
  readonly interactive?: boolean;
  readonly tone?: "default" | "blue";
}

export function Card({ children, className, interactive = false, tone = "default", ...props }: CardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      whileHover={interactive && !reduceMotion ? { y: -1 } : undefined}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "min-w-0 rounded-[20px] border shadow-soft",
        tone === "blue"
          ? "border-blue-400/30 bg-gradient-to-br from-primary to-[#4f8ff7] text-white"
          : "border-line/80 bg-white text-ink",
        interactive && "transition-shadow hover:shadow-lift",
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
