import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/classNames";

export function IconButton({ label, icon: Icon, onClick, disabled = false, variant = "secondary" }: Readonly<{ label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-11 items-center justify-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "border-primary bg-primary text-white hover:bg-primary-dark",
        variant === "secondary" && "border-line bg-white text-ink hover:border-blue-200 hover:bg-blue-50",
        variant === "danger" && "border-red-200 bg-white text-danger hover:bg-red-50",
      )}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
