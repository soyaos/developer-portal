import * as React from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-soya-ink text-soya-paper hover:bg-soya-ink/85 focus-visible:ring-soya-accent",
  secondary:
    "border border-soya-ink/15 bg-white/60 text-soya-ink hover:border-soya-accent focus-visible:ring-soya-accent",
  ghost:
    "text-soya-ink/70 hover:text-soya-ink hover:bg-soya-ink/5 focus-visible:ring-soya-accent",
  danger:
    "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-300",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
