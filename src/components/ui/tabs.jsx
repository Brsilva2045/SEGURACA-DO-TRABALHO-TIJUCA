import React, { createContext, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const TabsContext = createContext(null);

function Tabs({ defaultValue, value, onValueChange, className, children, ...props }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeValue = value ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;

  const contextValue = useMemo(
    () => ({ value: activeValue, setValue }),
    [activeValue, setValue]
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }) {
  return <div role="tablist" className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

function TabsTrigger({ className, value, children, ...props }) {
  const context = useContext(TabsContext);
  const active = context?.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
        className,
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-[0_14px_30px_-18px_rgba(15,23,42,0.9)]"
          : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
      )}
      onClick={() => context?.setValue?.(value)}
      {...props}
    >
      {children}
      {active ? (
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90">
          Ativo
        </span>
      ) : null}
    </button>
  );
}

function TabsContent({ className, value, children, ...props }) {
  const context = useContext(TabsContext);
  if (context?.value !== value) {
    return null;
  }

  return (
    <div role="tabpanel" className={cn("mt-4", className)} {...props}>
      {children}
    </div>
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
