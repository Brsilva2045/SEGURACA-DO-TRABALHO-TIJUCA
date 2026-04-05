#!/usr/bin/env node

const admin = require("firebase-admin");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "seguranca-do-trabalho-254f5";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const BATCH_SIZE = 400;

const TARGET_WORKSPACE_UNIT = {
  workspaceUnitId: "tijuca-messejana",
  workspaceUnitName: "Tijuca Messejana",
};

const COLLECTIONS = [
  "employees",
  "epi_items",
  "occurrences",
  "deliveries",
  "stock_movements",
  "stock_alerts",
  "users",
];

function normalizeLegacyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function needsMigration(data = {}) {
  const workspaceUnitId = normalizeLegacyText(data.workspaceUnitId);
  const workspaceUnitName = normalizeLegacyText(data.workspaceUnitName);
  const targetUnitName = normalizeLegacyText(TARGET_WORKSPACE_UNIT.workspaceUnitName);

  if (!workspaceUnitId && !workspaceUnitName) {
    return true;
  }

  if (workspaceUnitId === "matriz" || workspaceUnitName === "matriz") {
    return true;
  }

  if (workspaceUnitId === TARGET_WORKSPACE_UNIT.workspaceUnitId && workspaceUnitName === targetUnitName) {
    return false;
  }

  if (workspaceUnitId === TARGET_WORKSPACE_UNIT.workspaceUnitId && !workspaceUnitName) {
    return true;
  }

  if (!workspaceUnitId && workspaceUnitName === targetUnitName) {
    return true;
  }

  return false;
}

async function migrateCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const docsToMigrate = snapshot.docs.filter((docSnap) => needsMigration(docSnap.data()));

  if (!docsToMigrate.length) {
    return {
      collectionName,
      scanned: snapshot.size,
      migrated: 0,
    };
  }

  if (DRY_RUN) {
    docsToMigrate.forEach((docSnap) => {
      console.log(`[dry-run] ${collectionName}/${docSnap.id} -> ${TARGET_WORKSPACE_UNIT.workspaceUnitId}`);
    });

    return {
      collectionName,
      scanned: snapshot.size,
      migrated: docsToMigrate.length,
    };
  }

  let batch = db.batch();
  let pendingWrites = 0;

  for (const docSnap of docsToMigrate) {
    batch.set(
      docSnap.ref,
      {
        workspaceUnitId: TARGET_WORKSPACE_UNIT.workspaceUnitId,
        workspaceUnitName: TARGET_WORKSPACE_UNIT.workspaceUnitName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    pendingWrites += 1;

    if (pendingWrites >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }
  }

  if (pendingWrites > 0) {
    await batch.commit();
  }

  return {
    collectionName,
    scanned: snapshot.size,
    migrated: docsToMigrate.length,
  };
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const db = admin.firestore();

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);
  console.log(`Target unit: ${TARGET_WORKSPACE_UNIT.workspaceUnitName} (${TARGET_WORKSPACE_UNIT.workspaceUnitId})`);

  const summary = [];
  for (const collectionName of COLLECTIONS) {
    const result = await migrateCollection(db, collectionName);
    summary.push(result);
    console.log(`${collectionName}: scanned ${result.scanned}, migrated ${result.migrated}`);
  }

  const totalMigrated = summary.reduce((sum, item) => sum + item.migrated, 0);
  console.log(`Total migrated: ${totalMigrated}`);
}

main().catch((error) => {
  console.error("Workspace unit migration failed", error);
  process.exitCode = 1;
});
