import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...rest }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-10 w-full rounded-md border border-soya-ink/15 bg-white/70 px-3 text-sm tracking-tight text-soya-ink placeholder:text-soya-ink/40 focus:border-soya-accent focus:outline-none focus:ring-2 focus:ring-soya-accent/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...rest}
  />
));
Input.displayName = "Input";
