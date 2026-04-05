const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

function safeText(value) {
  return String(value || "").trim();
}

function formatDateTimePtBr(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

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
const WORKSPACE_DATA_COLLECTIONS = new Set([
  "employees",
  "epi_items",
  "occurrences",
  "deliveries",
  "stock_movements",
  "stock_alerts",
]);

function normalizeLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveWorkspaceUnitDefinition(value) {
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
}

function normalizeWorkspaceUnitName(value) {
  const resolved = resolveWorkspaceUnitDefinition(value);
  if (resolved) {
    return resolved.workspaceUnitName;
  }

  return safeText(value) || DEFAULT_WORKSPACE_UNIT.workspaceUnitName;
}

function normalizeWorkspaceUnitId(value) {
  const resolved = resolveWorkspaceUnitDefinition(value);
  if (resolved) {
    return resolved.workspaceUnitId;
  }

  const text = safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || DEFAULT_WORKSPACE_UNIT.workspaceUnitId;
}

function resolveWorkspaceUnitContext(source = {}) {
  const workspaceUnitName = normalizeWorkspaceUnitName(
    source.workspaceUnitName || source.unitName || source.branchName
  );
  const workspaceUnitId = normalizeWorkspaceUnitId(
    source.workspaceUnitId || source.unitId || source.branchId || workspaceUnitName
  );

  return {
    workspaceUnitId,
    workspaceUnitName,
  };
}

function isLegacyMessejanaDoc(data = {}) {
  const workspaceUnitId = normalizeLookupText(data.workspaceUnitId || data.unitId || data.branchId);
  const workspaceUnitName = normalizeLookupText(data.workspaceUnitName || data.unitName || data.branchName);

  return workspaceUnitId === "matriz" || workspaceUnitName === "matriz";
}

function matchesWorkspaceUnit(data = {}, workspaceUnit) {
  const recordWorkspaceUnit = resolveWorkspaceUnitContext(data);
  const targetWorkspaceUnit = resolveWorkspaceUnitContext(workspaceUnit);

  if (
    recordWorkspaceUnit.workspaceUnitId === targetWorkspaceUnit.workspaceUnitId &&
    recordWorkspaceUnit.workspaceUnitName === targetWorkspaceUnit.workspaceUnitName
  ) {
    return true;
  }

  return targetWorkspaceUnit.workspaceUnitId === "tijuca-messejana" && isLegacyMessejanaDoc(data);
}

function serializeFirestoreValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value.toDate === "function") {
    return formatDateTimePtBr(value.toDate());
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeFirestoreValue(item));
  }

  if (typeof value === "object") {
    if (typeof value.latitude === "number" && typeof value.longitude === "number") {
      const result = {
        latitude: value.latitude,
        longitude: value.longitude,
      };

      for (const [key, item] of Object.entries(value)) {
        if (key === "latitude" || key === "longitude") {
          continue;
        }

        result[key] = serializeFirestoreValue(item);
      }

      return result;
    }

    if (typeof value.path === "string" && Object.keys(value).length === 1) {
      return value.path;
    }

    const result = {};

    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeFirestoreValue(item);
    }

    return result;
  }

  return value;
}

function timestampToMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
}

function sortWorkspaceCollectionDocuments(collectionName, documents) {
  if (collectionName === "employees" || collectionName === "epi_items") {
    documents.sort((left, right) => safeText(left.name).localeCompare(safeText(right.name), "pt-BR"));
    return;
  }

  if (
    collectionName === "occurrences" ||
    collectionName === "deliveries" ||
    collectionName === "stock_movements" ||
    collectionName === "stock_alerts" ||
    collectionName === "audit_logs" ||
    collectionName === "storage_events"
  ) {
    documents.sort((left, right) => timestampToMillis(right.createdAt) - timestampToMillis(left.createdAt));
  }
}

async function loadWorkspaceCollection(collectionName, workspaceUnit) {
  const snapshot = await db.collection(collectionName).get();
  const documents = snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }))
    .filter((document) => matchesWorkspaceUnit(document, workspaceUnit));

  sortWorkspaceCollectionDocuments(collectionName, documents);

  return documents.map((document) => serializeFirestoreValue(document));
}

function extractRequestedWorkspaceUnit(data = {}) {
  const requestedText = safeText(
    data.workspaceUnitId ||
      data.workspaceUnitName ||
      data.unitId ||
      data.unitName ||
      data.branchId ||
      data.branchName
  );

  if (!requestedText) {
    return null;
  }

  const resolvedWorkspaceUnit = resolveWorkspaceUnitDefinition(requestedText);
  if (!resolvedWorkspaceUnit) {
    throw new functions.https.HttpsError("invalid-argument", "Unidade inválida.");
  }

  return resolvedWorkspaceUnit;
}

async function resolveWorkspaceUnitForCaller(context, data = {}) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const requestedWorkspaceUnit = extractRequestedWorkspaceUnit(data);
  const tokenWorkspaceUnitText = safeText(context.auth.token?.workspaceUnitId || context.auth.token?.workspaceUnitName);
  const tokenWorkspaceUnit = tokenWorkspaceUnitText ? resolveWorkspaceUnitDefinition(tokenWorkspaceUnitText) : null;

  const userSnapshot = await db.collection("users").doc(context.auth.uid).get();
  const profileWorkspaceUnitText = userSnapshot.exists
    ? safeText(
        userSnapshot.data().workspaceUnitId ||
          userSnapshot.data().workspaceUnitName ||
          userSnapshot.data().unitId ||
          userSnapshot.data().unitName ||
          userSnapshot.data().branchId ||
          userSnapshot.data().branchName
      )
    : "";
  const profileWorkspaceUnit = profileWorkspaceUnitText ? resolveWorkspaceUnitDefinition(profileWorkspaceUnitText) : null;

  const resolvedWorkspaceUnit = tokenWorkspaceUnit || profileWorkspaceUnit || requestedWorkspaceUnit || DEFAULT_WORKSPACE_UNIT;

  if (
    requestedWorkspaceUnit &&
    (tokenWorkspaceUnit || profileWorkspaceUnit) &&
    requestedWorkspaceUnit.workspaceUnitId !== resolvedWorkspaceUnit.workspaceUnitId
  ) {
    throw new functions.https.HttpsError("permission-denied", "Workspace unit mismatch.");
  }

  return resolvedWorkspaceUnit;
}

function extractStoragePath(source) {
  const text = safeText(source);
  if (!text) return "";

  if (text.startsWith("gs://")) {
    const gsPath = text.slice("gs://".length);
    const firstSlash = gsPath.indexOf("/");
    return firstSlash >= 0 ? gsPath.slice(firstSlash + 1) : "";
  }

  const match = text.match(/\/o\/([^?]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return text;
}

function inferMimeType(storagePath, contentType = "") {
  const hint = `${safeText(storagePath)} ${safeText(contentType)}`.toLowerCase();

  if (hint.includes("jpeg") || hint.includes("jpg")) {
    return "image/jpeg";
  }

  return "image/png";
}

function bytesToDataUrl(bytes, storagePath, contentType = "") {
  const mimeType = inferMimeType(storagePath, contentType);
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

exports.syncAuthUserProfile = functions.auth.user().onCreate(async (user) => {
  const userRef = db.collection("users").doc(user.uid);
  const customClaims = user.customClaims || {};

  await userRef.set(
    {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: customClaims.role || null,
      employeeId: customClaims.employeeId || null,
      authMethod: customClaims.authMethod || null,
      workspaceUnitId: customClaims.workspaceUnitId || null,
      workspaceUnitName: customClaims.workspaceUnitName || null,
      providerData: (user.providerData || []).map((provider) => ({
        providerId: provider.providerId || null,
        uid: provider.uid || null,
        email: provider.email || null,
      })),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return null;
});

exports.syncWorkspaceUnitContext = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const resolvedWorkspaceUnit = resolveWorkspaceUnitDefinition(
    data?.workspaceUnitId || data?.workspaceUnitName || data?.unitId || data?.unitName || data?.branchId || data?.branchName
  );

  if (!resolvedWorkspaceUnit) {
    throw new functions.https.HttpsError("invalid-argument", "Unidade inválida.");
  }

  const userRecord = await admin.auth().getUser(context.auth.uid);
  const customClaims = userRecord.customClaims || {};
  const nextClaims = {
    ...customClaims,
    workspaceUnitId: resolvedWorkspaceUnit.workspaceUnitId,
    workspaceUnitName: resolvedWorkspaceUnit.workspaceUnitName,
  };

  await admin.auth().setCustomUserClaims(context.auth.uid, nextClaims);

  const userRef = db.collection("users").doc(context.auth.uid);
  const userSnapshot = await userRef.get();
  const userPayload = {
    uid: context.auth.uid,
    email: userRecord.email || context.auth.token.email || null,
    displayName: userRecord.displayName || context.auth.token.name || null,
    photoURL: userRecord.photoURL || context.auth.token.picture || null,
    role: customClaims.role || null,
    employeeId: customClaims.employeeId || null,
    authMethod: customClaims.authMethod || null,
    workspaceUnitId: resolvedWorkspaceUnit.workspaceUnitId,
    workspaceUnitName: resolvedWorkspaceUnit.workspaceUnitName,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!userSnapshot.exists) {
    userPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await userRef.set(userPayload, { merge: true });

  return {
    workspaceUnitId: resolvedWorkspaceUnit.workspaceUnitId,
    workspaceUnitName: resolvedWorkspaceUnit.workspaceUnitName,
  };
});

exports.loadWorkspaceData = functions.https.onCall(async (data, context) => {
  const workspaceUnit = await resolveWorkspaceUnitForCaller(context, data);
  const requestedCollections = Array.isArray(data?.collections) && data.collections.length
    ? data.collections
    : [
        "employees",
        "epi_items",
        "occurrences",
        "deliveries",
        "stock_movements",
        "stock_alerts",
      ];

  const collectionNames = [...new Set(requestedCollections.map((collectionName) => safeText(collectionName)).filter(Boolean))];

  if (!collectionNames.length) {
    throw new functions.https.HttpsError("invalid-argument", "Nenhuma coleção foi solicitada.");
  }

  const invalidCollections = collectionNames.filter((collectionName) => !WORKSPACE_DATA_COLLECTIONS.has(collectionName));
  if (invalidCollections.length) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Coleção inválida: ${invalidCollections.join(", ")}.`
    );
  }

  const entries = await Promise.all(
    collectionNames.map(async (collectionName) => [
      collectionName,
      await loadWorkspaceCollection(collectionName, workspaceUnit),
    ])
  );

  return {
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    collections: Object.fromEntries(entries),
  };
});

exports.registerAuditLog = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const payload = {
    action: data.action || "unknown_action",
    entityId: data.entityId || null,
    employeeId: data.employeeId || null,
    itemId: data.itemId || null,
    metadata: data.metadata || {},
    actorUid: context.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection("audit_logs").add(payload);
  return {
    id: docRef.id,
    action: payload.action,
    entityId: payload.entityId,
    employeeId: payload.employeeId,
    itemId: payload.itemId,
    metadata: payload.metadata,
    actorUid: payload.actorUid,
  };
});

exports.mintCollaboratorFaceToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const employeeId = safeText(data?.employeeId);

  if (!employeeId) {
    throw new functions.https.HttpsError("invalid-argument", "employeeId is required.");
  }

  const employeeRef = db.collection("employees").doc(employeeId);
  const snapshot = await employeeRef.get();

  if (!snapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Employee not found.");
  }

  const employee = snapshot.data() || {};
  const descriptors = Array.isArray(employee.faceDescriptors)
    ? employee.faceDescriptors
    : Array.isArray(employee.faceDescriptor)
      ? employee.faceDescriptor
      : [];
  const workspaceUnit = resolveWorkspaceUnitContext({ ...(data || {}), ...employee });

  if (!descriptors.length) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Employee does not have an enrolled face descriptor."
    );
  }

  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(employeeId, {
      role: "collaborator",
      employeeId,
      employeeName: employee.name || null,
      employeeRegistration: employee.registration || null,
      employeeLotacao: employee.lotacao || employee.sector || null,
      workspaceUnitId: workspaceUnit.workspaceUnitId,
      workspaceUnitName: workspaceUnit.workspaceUnitName,
      authMethod: "face",
      faceMatchDistance: Number(data?.matchDistance || 0),
    });
  } catch (error) {
    console.error("mintCollaboratorFaceToken createCustomToken failed", error);

    if (error?.code === "auth/insufficient-permission") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O runtime do Firebase Functions precisa do papel Service Account Token Creator para gerar o token facial."
      );
    }

    throw new functions.https.HttpsError(
      "internal",
      "Não foi possível gerar o token facial do colaborador."
    );
  }

  await employeeRef.set(
    {
      faceAuthEnabled: true,
      faceAuthUid: employeeId,
      faceAuthLastIssuedAt: admin.firestore.FieldValue.serverTimestamp(),
      faceAuthLastIssuedBy: context.auth.uid,
    },
    { merge: true }
  );

  return {
    customToken,
    uid: employeeId,
    employeeId,
    employeeName: employee.name || null,
    employeeRegistration: employee.registration || null,
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
  };
});

exports.finalizeFaceDelivery = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const pendingDelivery = data?.pendingDelivery || {};
  const workspaceUnit = await resolveWorkspaceUnitForCaller(context, pendingDelivery);
  const employeeId = safeText(data?.employee?.id || data?.employeeId);
  const itemId = safeText(pendingDelivery.itemId || data?.itemId);
  const quantity = Number(pendingDelivery.quantity || data?.quantity || 0);

  if (!employeeId || !itemId || quantity <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Dados da entrega por face estão incompletos.");
  }

  const employeeRef = db.collection("employees").doc(employeeId);
  const epiRef = db.collection("epi_items").doc(itemId);
  const deliveryRef = db.collection("deliveries").doc();
  const movementRef = db.collection("stock_movements").doc();
  const auditRef = db.collection("audit_logs").doc();

  const [employeeSnapshot, epiSnapshot] = await Promise.all([employeeRef.get(), epiRef.get()]);

  if (!employeeSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Colaborador não encontrado.");
  }

  if (!epiSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "EPI não encontrado.");
  }

  const employee = employeeSnapshot.data() || {};
  const epi = epiSnapshot.data() || {};

  if (!matchesWorkspaceUnit(employee, workspaceUnit) || !matchesWorkspaceUnit(epi, workspaceUnit)) {
    throw new functions.https.HttpsError("permission-denied", "A entrega não pertence à unidade ativa.");
  }

  const currentStock = Number(epi.stock || 0);
  if (currentStock < quantity) {
    throw new functions.https.HttpsError("failed-precondition", "Estoque insuficiente para concluir a entrega.");
  }

  const nextStock = currentStock - quantity;
  const collaboratorUid = safeText(data?.collaboratorUid);
  const deliveredBy =
    safeText(data?.deliveredBy) ||
    safeText(context.auth.token?.name) ||
    safeText(context.auth.token?.email) ||
    context.auth.uid;
  const note = safeText(pendingDelivery.note);
  const itemName = safeText(epi.name || pendingDelivery.itemName);
  const employeeName = safeText(employee.name || data?.employee?.name);
  const employeeRegistration = safeText(employee.registration || data?.employee?.registration);
  const faceMatchDistance = Number(data?.faceMatchDistance || 0);
  const faceBadgeDataUrl = safeText(data?.faceBadgeDataUrl);
  const requestedFaceVerifiedAt = safeText(data?.faceVerifiedAt);
  const geoLocation =
    data?.geoLocation && typeof data.geoLocation === "object" && !Array.isArray(data.geoLocation)
      ? data.geoLocation
      : null;

  if (!geoLocation || safeText(geoLocation.status) !== "captured") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A localizacao GPS e obrigatoria para concluir a entrega por face."
    );
  }

  const hash = `face-${Date.now()}`;
  const verificationDate = requestedFaceVerifiedAt ? new Date(requestedFaceVerifiedAt) : new Date();
  const faceVerifiedAt = Number.isNaN(verificationDate.getTime())
    ? new Date().toISOString()
    : verificationDate.toISOString();
  const createdAtLabel = formatDateTimePtBr(faceVerifiedAt);

  const deliveryRecord = {
    itemId,
    itemName,
    quantity,
    note,
    employeeId,
    employeeName,
    employeeRegistration,
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    signatureStatus: "face_verified",
    verificationMethod: "face",
    faceAuthUid: collaboratorUid || null,
    faceMatchDistance,
    faceVerifiedAt,
    signatureDataUrl: faceBadgeDataUrl,
    signatureImageUrl: "",
    geoLocation,
    deliveredBy,
    hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const movementRecord = {
    type: "saida",
    epiId: itemId,
    epiName: itemName,
    quantity,
    employeeId,
    employeeName,
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    note,
  };

  const auditRecord = {
    action: "delivery_created_face",
    entityId: deliveryRef.id,
    employeeId,
    itemId,
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    actorUid: context.auth.uid,
    metadata: {
      faceMatchDistance,
      faceAuthUid: collaboratorUid || null,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.runTransaction(async (transaction) => {
    transaction.update(epiRef, {
      stock: nextStock,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(deliveryRef, deliveryRecord);
    transaction.set(movementRef, movementRecord);
    transaction.set(auditRef, auditRecord);
  });

  return {
    delivery: serializeFirestoreValue({
      id: deliveryRef.id,
      ...deliveryRecord,
      createdAt: createdAtLabel,
    }),
    movement: serializeFirestoreValue({
      id: movementRef.id,
      ...movementRecord,
      createdAt: createdAtLabel,
    }),
    nextStock,
  };
});

exports.generateDeliveryReceipt = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const { deliveryId, receiptPdfUrl } = data;

  if (!deliveryId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId is required.");
  }

  if (!receiptPdfUrl) {
    throw new functions.https.HttpsError("invalid-argument", "receiptPdfUrl is required.");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const snapshot = await deliveryRef.get();

  if (!snapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found.");
  }

  await deliveryRef.set(
    {
      receiptPdfUrl,
      receiptGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      receiptGeneratedBy: context.auth.uid,
    },
    { merge: true }
  );

  return {
    ok: true,
    deliveryId,
    receiptPdfUrl,
  };
});

exports.backfillDeliverySignatures = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const requestedIds = Array.isArray(data?.deliveryIds)
    ? data.deliveryIds.map((id) => safeText(id)).filter(Boolean)
    : [];

  const deliveryDocs = requestedIds.length
    ? await Promise.all(requestedIds.map((id) => db.collection("deliveries").doc(id).get()))
    : (await db.collection("deliveries").get()).docs;

  const candidates = deliveryDocs
    .filter((docSnap) => docSnap.exists)
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((delivery) => !safeText(delivery.signatureDataUrl) && safeText(delivery.signatureImageUrl));

  if (!candidates.length) {
    return {
      migratedCount: 0,
      updatedDeliveries: [],
    };
  }

  const bucket = admin.storage().bucket();
  const updatedDeliveries = [];
  let batch = db.batch();
  let batchCount = 0;

  const commitBatchIfNeeded = async () => {
    if (!batchCount) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const delivery of candidates) {
    try {
      const storagePath = extractStoragePath(delivery.signatureImageUrl);
      if (!storagePath) {
        continue;
      }

      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        continue;
      }

      const [metadata] = await file.getMetadata().catch(() => [{}]);
      const [buffer] = await file.download();
      const signatureDataUrl = bytesToDataUrl(buffer, storagePath, metadata?.contentType || "");

      batch.set(
        db.collection("deliveries").doc(delivery.id),
        {
          signatureDataUrl,
          signatureStatus: delivery.signatureStatus || "signed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batchCount += 1;
      updatedDeliveries.push({
        id: delivery.id,
        signatureDataUrl,
        signatureStatus: delivery.signatureStatus || "signed",
      });

      if (batchCount >= 400) {
        await commitBatchIfNeeded();
      }
    } catch (error) {
      console.error("backfillDeliverySignatures failed for delivery", delivery.id, error);
    }
  }

  await commitBatchIfNeeded();

  return {
    migratedCount: updatedDeliveries.length,
    updatedDeliveries,
  };
});

exports.syncStockAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }

  const stock = Number(data.stock || 0);
  const minimumStock = Number(data.minimumStock || 0);
  const isLowStock = stock <= minimumStock;
  const workspaceUnit = resolveWorkspaceUnitContext(data);

  const payload = {
    epiId: data.epiId || null,
    epiName: data.epiName || null,
    stock,
    minimumStock,
    isLowStock,
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    actorUid: context.auth.uid,
  };

  const docRef = await db.collection("stock_alerts").add(payload);
  return {
    id: docRef.id,
    epiId: payload.epiId,
    epiName: payload.epiName,
    stock: payload.stock,
    minimumStock: payload.minimumStock,
    isLowStock: payload.isLowStock,
    actorUid: payload.actorUid,
  };
});

exports.onSignatureUploaded = functions.storage.object().onFinalize(async (object) => {
  if (!object.name || !object.name.startsWith("signatures/")) {
    return null;
  }

  await db.collection("storage_events").add({
    eventType: "signature_uploaded",
    objectName: object.name,
    bucket: object.bucket || null,
    contentType: object.contentType || null,
    size: Number(object.size || 0),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return null;
});
