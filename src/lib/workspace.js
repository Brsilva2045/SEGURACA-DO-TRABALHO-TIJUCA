const WORKSPACE_UNIT_CATALOG = [
  {
    workspaceUnitId: "tijuca-messejana",
    workspaceUnitName: "Tijuca Messejana",
    aliases: ["Matriz"],
  },
  {
    workspaceUnitId: "tijuca-beberibe",
    workspaceUnitName: "Tijuca Beberibe",
    aliases: [],
  },
  {
    workspaceUnitId: "tijuca-frigorifico",
    workspaceUnitName: "Tijuca Frigorífico",
    aliases: ["Tijuca Frigorifico"],
  },
  {
    workspaceUnitId: "tijuca-incubatorio",
    workspaceUnitName: "Tijuca Incubatório",
    aliases: ["Tijuca Incubatorio"],
  },
];

const DEFAULT_WORKSPACE_UNIT = WORKSPACE_UNIT_CATALOG[0];
const DEFAULT_WORKSPACE_UNIT_NAME = DEFAULT_WORKSPACE_UNIT.workspaceUnitName;
const DEFAULT_WORKSPACE_UNIT_ID = DEFAULT_WORKSPACE_UNIT.workspaceUnitId;
const WORKSPACE_UNIT_STORAGE_KEY = "sst.workspace.unit";

const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normalizeLookupText = (value = "") => normalizeText(value).replace(/[^a-z0-9]+/g, "");

const resolveWorkspaceUnitDefinition = (value = "") => {
  const lookup = normalizeLookupText(value);

  if (!lookup) {
    return DEFAULT_WORKSPACE_UNIT;
  }

  return (
    WORKSPACE_UNIT_CATALOG.find((unit) => {
      const candidates = [unit.workspaceUnitId, unit.workspaceUnitName, ...(unit.aliases || [])];
      return candidates.some((candidate) => normalizeLookupText(candidate) === lookup);
    }) || null
  );
};

export const WORKSPACE_UNIT_OPTIONS = WORKSPACE_UNIT_CATALOG.map(({ workspaceUnitId, workspaceUnitName }) => ({
  value: workspaceUnitId,
  label: workspaceUnitName,
}));

export const normalizeWorkspaceUnitId = (value = "") => {
  const resolved = resolveWorkspaceUnitDefinition(value);
  if (resolved) {
    return resolved.workspaceUnitId;
  }

  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || DEFAULT_WORKSPACE_UNIT_ID;
};

export const normalizeWorkspaceUnitName = (value = "") => {
  const resolved = resolveWorkspaceUnitDefinition(value);
  if (resolved) {
    return resolved.workspaceUnitName;
  }

  return String(value || "").trim() || DEFAULT_WORKSPACE_UNIT_NAME;
};

export const buildWorkspaceUnit = (value = "") => {
  const resolved = resolveWorkspaceUnitDefinition(value);

  if (resolved) {
    return {
      workspaceUnitId: resolved.workspaceUnitId,
      workspaceUnitName: resolved.workspaceUnitName,
    };
  }

  return {
    workspaceUnitId: DEFAULT_WORKSPACE_UNIT_ID,
    workspaceUnitName: DEFAULT_WORKSPACE_UNIT_NAME,
  };
};

export const loadWorkspaceUnit = (fallbackName = DEFAULT_WORKSPACE_UNIT_NAME) => {
  if (typeof window === "undefined") {
    return buildWorkspaceUnit(fallbackName);
  }

  const savedName = window.localStorage.getItem(WORKSPACE_UNIT_STORAGE_KEY);
  return buildWorkspaceUnit(savedName || fallbackName);
};

export const saveWorkspaceUnit = (value = "") => {
  const workspaceUnit = buildWorkspaceUnit(value);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(WORKSPACE_UNIT_STORAGE_KEY, workspaceUnit.workspaceUnitId);
  }

  return workspaceUnit;
};

export const clearWorkspaceUnit = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(WORKSPACE_UNIT_STORAGE_KEY);
  }
};

export {
  DEFAULT_WORKSPACE_UNIT_ID,
  DEFAULT_WORKSPACE_UNIT_NAME,
  WORKSPACE_UNIT_CATALOG,
  WORKSPACE_UNIT_STORAGE_KEY,
};
