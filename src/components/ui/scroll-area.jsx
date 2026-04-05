import React from "react";
import { cn } from "@/lib/utils";

function ScrollArea({ className, ...props }) {
  return <div className={cn("overflow-auto", className)} {...props} />;
}

export { ScrollArea };
