import React from "react";
import { cn } from "@/lib/utils";

function Alert({ className, ...props }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm",
        className
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }) {
  return <h5 className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />;
}

function AlertDescription({ className, ...props }) {
  return <div className={cn("text-sm text-slate-600", className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
