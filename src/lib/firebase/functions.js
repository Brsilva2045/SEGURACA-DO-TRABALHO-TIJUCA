import { httpsCallable } from "firebase/functions";
import { functions } from "./client";

const callable = (name) => httpsCallable(functions, name);

export function callFunction(name, payload) {
  return callable(name)(payload);
}

export function registerAuditLog(payload) {
  return callFunction("registerAuditLog", payload);
}

export function generateDeliveryReceipt(payload) {
  return callFunction("generateDeliveryReceipt", payload);
}

export function loadWorkspaceData(payload) {
  return callFunction("loadWorkspaceData", payload);
}

export function backfillDeliverySignatures(payload) {
  return callFunction("backfillDeliverySignatures", payload);
}

export function syncStockAlert(payload) {
  return callFunction("syncStockAlert", payload);
}

export function mintCollaboratorFaceToken(payload) {
  return callFunction("mintCollaboratorFaceToken", payload);
}

export function syncWorkspaceUnitContext(payload) {
  return callFunction("syncWorkspaceUnitContext", payload);
}

export function finalizeFaceDelivery(payload) {
  return callFunction("finalizeFaceDelivery", payload);
}
