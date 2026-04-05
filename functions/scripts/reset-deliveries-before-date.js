#!/usr/bin/env node

"use strict";

const admin = require("firebase-admin");

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "seguranca-do-trabalho-254f5";

const DEFAULT_CUTOFF_DATE = "30/03/2026";
const DEFAULT_BATCH_SIZE = 400;
const DEFAULT_STORAGE_CONCURRENCY = 25;

const args = process.argv.slice(2);

function hasFlag(...names) {
  return names.some((name) => args.includes(name));
}

function readArgValue(...names) {
  const index = args.findIndex((value) => names.includes(value));
  if (index < 0) return "";
  return String(args[index + 1] || "").trim();
}

function safeText(value) {
  return String(value || "").trim();
}

function parseCutoffDate(value) {
  const text = safeText(value);

  if (!text) {
    throw new Error("Informe a data de corte com --date (ex: 30/03/2026).");
  }

  let year;
  let month;
  let day;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [dd, mm, yyyy] = text.split("/");
    day = Number(dd);
    month = Number(mm);
    year = Number(yyyy);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [yyyy, mm, dd] = text.split("-");
    day = Number(dd);
    month = Number(mm);
    year = Number(yyyy);
  } else {
    throw new Error(`Data inválida: "${text}". Use dd/mm/aaaa (ex: 30/03/2026).`);
  }

  const cutoffExclusive = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  if (Number.isNaN(cutoffExclusive.getTime())) {
    throw new Error(`Não foi possível interpretar a data "${text}".`);
  }

  return { text, cutoffExclusive };
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

function toMillis(value) {
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function deleteStorageFiles(bucket, storagePaths, { concurrency }) {
  const paths = [...storagePaths].filter(Boolean);
  let deletedCount = 0;

  for (const group of chunkArray(paths, concurrency)) {
    const results = await Promise.allSettled(
      group.map(async (path) => {
        try {
          await bucket.file(path).delete();
          return { ok: true, path };
        } catch (error) {
          const code = error?.code;
          if (code === 404 || code === "404" || code === "object-not-found") {
            return { ok: true, skipped: true, path };
          }
          return { ok: false, path, error };
        }
      })
    );

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        if (result.value?.ok && !result.value?.skipped) {
          deletedCount += 1;
        }

        if (result.value && result.value.ok === false) {
          console.error(`Falha ao apagar arquivo do Storage: ${result.value.path}`, result.value.error);
        }
        return;
      }
      console.error("Falha ao apagar arquivo do Storage", result.reason);
    });
  }

  return deletedCount;
}

async function main() {
  const cutoffDateText =
    readArgValue("--date", "--cutoff") || process.env.CUTOFF_DATE || DEFAULT_CUTOFF_DATE;
  const { text: cutoffLabel, cutoffExclusive } = parseCutoffDate(cutoffDateText);

  const commit = hasFlag("--commit", "--apply") || process.env.COMMIT === "1";
  const keepStorage = hasFlag("--keep-storage", "--skip-storage") || process.env.KEEP_STORAGE === "1";
  const deliveriesOnly = hasFlag("--deliveries-only") || process.env.DELIVERIES_ONLY === "1";
  const workspaceUnitIdFilter = safeText(readArgValue("--workspace-unit-id"));
  const workspaceUnitNameFilter = safeText(readArgValue("--workspace-unit-name"));
  const batchSize = Number(
    readArgValue("--batch-size") || process.env.BATCH_SIZE || DEFAULT_BATCH_SIZE
  );
  const storageConcurrency = Number(
    readArgValue("--storage-concurrency") || process.env.STORAGE_CONCURRENCY || DEFAULT_STORAGE_CONCURRENCY
  );

  if (!admin.apps.length) {
    const storageBucket =
      safeText(
        process.env.FIREBASE_STORAGE_BUCKET ||
          process.env.GCLOUD_STORAGE_BUCKET ||
          process.env.STORAGE_BUCKET
      ) || `${PROJECT_ID}.appspot.com`;

    admin.initializeApp({ projectId: PROJECT_ID, storageBucket });
  }

  const db = admin.firestore();
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffExclusive);

  const workspaceLabelParts = [];
  if (workspaceUnitIdFilter) workspaceLabelParts.push(`workspaceUnitId=${workspaceUnitIdFilter}`);
  if (workspaceUnitNameFilter) workspaceLabelParts.push(`workspaceUnitName=${workspaceUnitNameFilter}`);
  const workspaceLabel = workspaceLabelParts.length ? workspaceLabelParts.join(", ") : "todas as unidades";

  console.log(`Projeto: ${PROJECT_ID}`);
  console.log(`Corte (inclusivo): ${cutoffLabel} (createdAt < ${cutoffExclusive.toISOString()})`);
  console.log(`Escopo: ${workspaceLabel}`);
  console.log(`Modo: ${commit ? "APLICAR (commit)" : "SIMULAÇÃO (dry-run)"}`);
  console.log(`Storage: ${commit ? (keepStorage ? "manter arquivos" : "apagar recibos/assinaturas") : "simular"}`);
  console.log("");

  const deliveriesSnapshot = await db
    .collection("deliveries")
    .where("createdAt", "<", cutoffTimestamp)
    .get();

  const deliveries = deliveriesSnapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((delivery) => {
      if (workspaceUnitIdFilter && safeText(delivery.workspaceUnitId) !== workspaceUnitIdFilter) {
        return false;
      }
      if (workspaceUnitNameFilter && safeText(delivery.workspaceUnitName) !== workspaceUnitNameFilter) {
        return false;
      }
      return true;
    });

  let movements = [];
  if (!deliveriesOnly) {
    const movementsSnapshot = await db
      .collection("stock_movements")
      .where("type", "==", "saida")
      .get();

    const cutoffMillis = cutoffExclusive.getTime();
    movements = movementsSnapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((movement) => {
        if (workspaceUnitIdFilter && safeText(movement.workspaceUnitId) !== workspaceUnitIdFilter) {
          return false;
        }
        if (workspaceUnitNameFilter && safeText(movement.workspaceUnitName) !== workspaceUnitNameFilter) {
          return false;
        }

        const createdAtMillis = toMillis(movement.createdAt);
        return createdAtMillis > 0 && createdAtMillis < cutoffMillis;
      });
  }

  const stockRestoration = new Map();
  const storagePathsToDelete = new Set();

  deliveries.forEach((delivery) => {
    const itemId = safeText(delivery.itemId);
    const quantity = Number(delivery.quantity || 0);

    if (itemId && Number.isFinite(quantity) && quantity > 0) {
      stockRestoration.set(itemId, (stockRestoration.get(itemId) || 0) + quantity);
    }

    const signaturePath = extractStoragePath(delivery.signatureImageUrl);
    if (signaturePath) storagePathsToDelete.add(signaturePath);

    const receiptPdfPath = extractStoragePath(delivery.receiptPdfPath);
    if (receiptPdfPath) storagePathsToDelete.add(receiptPdfPath);

    const receiptPdfUrlPath = extractStoragePath(delivery.receiptPdfUrl);
    if (receiptPdfUrlPath) storagePathsToDelete.add(receiptPdfUrlPath);
  });

  const itemIds = [...stockRestoration.keys()];
  const itemSnapshots = itemIds.length
    ? await Promise.all(itemIds.map((itemId) => db.collection("epi_items").doc(itemId).get()))
    : [];

  const restoredItems = [];
  const missingItemIds = [];

  itemSnapshots.forEach((snapshot, index) => {
    const itemId = itemIds[index];
    const quantity = stockRestoration.get(itemId) || 0;
    if (!quantity) return;

    if (snapshot.exists) {
      restoredItems.push({ itemId, quantity });
    } else {
      missingItemIds.push(itemId);
    }
  });

  console.log(`Entregas encontradas: ${deliveries.length}`);
  console.log(`Saídas (movimentações) encontradas: ${movements.length}`);
  console.log(`EPIs para restaurar estoque: ${restoredItems.length}${missingItemIds.length ? ` (+${missingItemIds.length} faltando)` : ""}`);
  console.log(`Arquivos (recibos/assinaturas) para apagar: ${storagePathsToDelete.size}`);
  console.log("");

  if (!commit) {
    console.log("Nenhuma alteração aplicada. Use --commit para executar.");
    return;
  }

  const writes = [];

  restoredItems.forEach((item) => {
    writes.push({
      type: "update",
      ref: db.collection("epi_items").doc(item.itemId),
      data: {
        stock: admin.firestore.FieldValue.increment(item.quantity),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  deliveries.forEach((delivery) => {
    writes.push({
      type: "delete",
      ref: db.collection("deliveries").doc(delivery.id),
    });
  });

  movements.forEach((movement) => {
    writes.push({
      type: "delete",
      ref: db.collection("stock_movements").doc(movement.id),
    });
  });

  for (const chunk of chunkArray(writes, batchSize)) {
    if (!chunk.length) continue;

    const batch = db.batch();
    chunk.forEach((operation) => {
      if (operation.type === "update") {
        batch.update(operation.ref, operation.data);
      } else {
        batch.delete(operation.ref);
      }
    });
    await batch.commit();
  }

  let deletedStorageCount = 0;
  if (!keepStorage && storagePathsToDelete.size) {
    const bucket = admin.storage().bucket();
    deletedStorageCount = await deleteStorageFiles(bucket, storagePathsToDelete, {
      concurrency: storageConcurrency,
    });
  }

  console.log("Concluído.");
  console.log(`Entregas removidas: ${deliveries.length}`);
  console.log(`Saídas removidas: ${movements.length}`);
  console.log(`Arquivos apagados no Storage: ${deletedStorageCount}`);
  if (missingItemIds.length) {
    console.log(`EPIs sem restauração (docs não encontrados): ${missingItemIds.join(", ")}`);
  }
}

main().catch((error) => {
  console.error("Reset por data falhou", error);
  process.exitCode = 1;
});
