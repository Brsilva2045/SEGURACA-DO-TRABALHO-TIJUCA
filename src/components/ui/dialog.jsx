import React, { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const DialogContext = createContext(null);

function Dialog({ open, onOpenChange, children }) {
  return (
    <DialogContext.Provider value={{ open: Boolean(open), onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({ children }) {
  const context = useContext(DialogContext);
  const child = React.Children.only(children);

  return React.cloneElement(child, {
    onClick: (event) => {
      child.props?.onClick?.(event);
      context?.onOpenChange?.(true);
    },
  });
}

function DialogContent({ className, children }) {
  const context = useContext(DialogContext);
  if (!context?.open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
      <div
        className={cn(
          "relative w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-soft",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          onClick={() => context.onOpenChange?.(false)}
        >
          Fechar
        </button>
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ className, ...props }) {
  return <div className={cn("mb-4 flex flex-col space-y-1.5", className)} {...props} />;
}

function DialogTitle({ className, ...props }) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger };
