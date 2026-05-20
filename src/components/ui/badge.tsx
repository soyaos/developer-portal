import * as React from "react";
import { cn } from "./cn";

type Variant = "default" | "accent" | "muted" | "danger";

const VARIANT: Record<Variant, string> = {
  default: "bg-soya-ink/10 text-soya-ink",
  accent: "bg-soya-accent/15 text-soya-accent",
  muted: "bg-soya-ink/5 text-soya-ink/70",
  danger: "bg-red-100 text-red-700",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}
