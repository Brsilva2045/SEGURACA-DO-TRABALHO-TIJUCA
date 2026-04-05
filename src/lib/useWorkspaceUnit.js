"use client";

import { useEffect, useState } from "react";
import { buildWorkspaceUnit, loadWorkspaceUnit, saveWorkspaceUnit } from "@/lib/workspace";

export function useWorkspaceUnit(fallbackName) {
  const [workspaceUnit, setWorkspaceUnitState] = useState(() =>
    buildWorkspaceUnit(fallbackName)
  );
  const [workspaceUnitLoaded, setWorkspaceUnitLoaded] = useState(false);

  useEffect(() => {
    setWorkspaceUnitState(loadWorkspaceUnit(fallbackName));
    setWorkspaceUnitLoaded(true);
  }, [fallbackName]);

  const setWorkspaceUnit = (value) => {
    const nextWorkspaceUnit = saveWorkspaceUnit(value);
    setWorkspaceUnitState(nextWorkspaceUnit);
    return nextWorkspaceUnit;
  };

  return {
    workspaceUnit,
    workspaceUnitLoaded,
    setWorkspaceUnit,
  };
}
