import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./client";
import { formatDateTimePtBr, isIsoDateTimeString } from "../date";
import { buildWorkspaceUnit } from "../workspace";

export const collectionOrderMap = {
  employees: { field: "name", direction: "asc" },
  epi_items: { field: "name", direction: "asc" },
  occurrences: { field: "createdAt", direction: "desc" },
  deliveries: { field: "createdAt", direction: "desc" },
  stock_movements: { field: "createdAt", direction: "desc" },
  audit_logs: { field: "createdAt", direction: "desc" },
  stock_alerts: { field: "createdAt", direction: "desc" },
  users: { field: "createdAt", direction: "desc" },
  storage_events: { field: "createdAt", direction: "desc" },
};

export const normalizeFirestoreValue = (value) => {
  if (typeof value?.toDate === "function") {
    return formatDateTimePtBr(value.toDate());
  }

  if (isIsoDateTimeString(value)) {
    return formatDateTimePtBr(value);
  }

  return value;
};

const buildCollectionRef = (collectionName, { filters = [], ordered = true } = {}) => {
  const orderConfig = collectionOrderMap[collectionName];
  const collectionRef = collection(db, collectionName);
  const constraints = filters
    .filter((filter) => filter?.field && filter?.op)
    .map((filter) => where(filter.field, filter.op, filter.value));

  if (ordered && orderConfig) {
    constraints.push(orderBy(orderConfig.field, orderConfig.direction));
  }

  return constraints.length ? query(collectionRef, ...constraints) : collectionRef;
};

const normalizeCollectionDocument = (docItem) => {
  const data = docItem.data();

  return {
    id: docItem.id,
    ...data,
    createdAt: normalizeFirestoreValue(data.createdAt),
    updatedAt: normalizeFirestoreValue(data.updatedAt),
  };
};

const timestampToMillis = (value) => {
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
};

const sortWorkspaceDocuments = (collectionName, documents) => {
  const orderConfig = collectionOrderMap[collectionName];
  if (!orderConfig) {
    return documents;
  }

  const { field, direction } = orderConfig;

  return [...documents].sort((left, right) => {
    if (field === "createdAt" || field === "updatedAt") {
      const leftValue = timestampToMillis(left[field]);
      const rightValue = timestampToMillis(right[field]);
      return direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
    }

    const comparison = String(left[field] || "").localeCompare(String(right[field] || ""), "pt-BR");
    return direction === "desc" ? -comparison : comparison;
  });
};

export async function listCollection(collectionName) {
  const snapshot = await getDocs(buildCollectionRef(collectionName));

  return snapshot.docs.map(normalizeCollectionDocument);
}

export async function listWorkspaceCollection(collectionName, workspaceUnit) {
  const resolvedWorkspaceUnit = buildWorkspaceUnit(
    workspaceUnit?.workspaceUnitId || workspaceUnit?.workspaceUnitName || ""
  );
  const queryGroups = [
    [
      { field: "workspaceUnitId", op: "==", value: resolvedWorkspaceUnit.workspaceUnitId },
      { field: "workspaceUnitName", op: "==", value: resolvedWorkspaceUnit.workspaceUnitName },
    ],
  ];

  if (resolvedWorkspaceUnit.workspaceUnitId === "tijuca-messejana") {
    queryGroups.push([{ field: "workspaceUnitId", op: "==", value: "matriz" }]);
    queryGroups.push([{ field: "workspaceUnitName", op: "==", value: "Matriz" }]);
  }

  const snapshots = await Promise.all(
    queryGroups.map((filters) => getDocs(buildCollectionRef(collectionName, { filters, ordered: false })))
  );
  const documentsById = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docItem) => {
      documentsById.set(docItem.id, normalizeCollectionDocument(docItem));
    });
  });

  return sortWorkspaceDocuments(collectionName, [...documentsById.values()]);
}

export async function createDocument(collectionName, payload) {
  const sanitizedPayload = {
    ...payload,
    createdAt: serverTimestamp(),
  };

  delete sanitizedPayload.id;

  const docRef = await addDoc(collection(db, collectionName), sanitizedPayload);
  return { id: docRef.id, ...payload };
}

export async function updateDocument(collectionName, id, payload) {
  await updateDoc(doc(db, collectionName, id), {
    ...payload,
    updatedAt: serverTimestamp(),
  });

  return { id, ...payload };
}

export async function setDocument(collectionName, id, payload) {
  await setDoc(
    doc(db, collectionName, id),
    {
      ...payload,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { id, ...payload };
}

export async function deleteDocument(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
  return { id };
}

export function subscribeCollection(collectionName, onNext = () => {}, onError) {
  return onSnapshot(buildCollectionRef(collectionName), (snapshot) => {
    onNext(
      snapshot.docs.map((docItem) => {
        const data = docItem.data();
        return {
          id: docItem.id,
          ...data,
          createdAt: normalizeFirestoreValue(data.createdAt),
          updatedAt: normalizeFirestoreValue(data.updatedAt),
        };
      })
    );
  }, onError);
}
