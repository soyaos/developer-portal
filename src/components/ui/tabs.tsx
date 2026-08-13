import * as React from "react";
import { cn } from "./cn";

interface TabsContextValue<T extends string = string> {
  value: T;
  setValue: (next: T) => void;
}

const TabsCtx = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsCtx);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
  return ctx;
}

interface TabsProps<T extends string> {
  value: T;
  onValueChange: (next: T) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs<T extends string>({
  value,
  onValueChange,
  children,
  className,
}: TabsProps<T>) {
  const ctx = React.useMemo<TabsContextValue<T>>(
    () => ({ value, setValue: onValueChange }),
    [value, onValueChange],
  );
  return (
    <TabsCtx.Provider value={ctx as unknown as TabsContextValue}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-soya-ink/10 bg-white/60 p-1",
        className,
      )}
      {...rest}
    />
  );
}

interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  ...rest
}: TabsTriggerProps) {
  const ctx = useTabs();
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium tracking-tight transition focus:outline-none focus-visible:ring-2 focus-visible:ring-soya-accent",
        active
          ? "bg-soya-ink text-soya-paper"
          : "text-soya-ink/70 hover:bg-soya-ink/5 hover:text-soya-ink",
        className,
      )}
      {...rest}
    />
  );
}

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({
  value,
  className,
  ...rest
}: TabsContentProps) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return <div role="tabpanel" className={className} {...rest} />;
}
