import {
  deleteObject,
  getBytes,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadString,
} from "firebase/storage";
import { storage } from "./client";

const buildStorageRef = (path) => ref(storage, path);

function safeText(value) {
  return String(value || "").trim();
}

function isDataUrl(source) {
  return /^data:/i.test(safeText(source));
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

function inferMimeType(source) {
  const hint = safeText(source).toLowerCase();

  if (hint.includes("jpeg") || hint.includes("jpg")) {
    return "image/jpeg";
  }

  return "image/png";
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

export async function uploadBase64(path, base64Data) {
  const storageRef = buildStorageRef(path);
  await uploadString(storageRef, base64Data, "data_url");
  return getDownloadURL(storageRef);
}

export async function downloadStorageFileDataUrl(source) {
  if (!source || isDataUrl(source)) {
    return safeText(source);
  }

  const storagePath = extractStoragePath(source);
  if (!storagePath) {
    return "";
  }

  const bytes = await getBytes(buildStorageRef(storagePath));
  const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mimeType = inferMimeType(source);
  return `data:${mimeType};base64,${bytesToBase64(byteArray)}`;
}

export async function uploadFile(path, file) {
  const storageRef = buildStorageRef(path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function uploadPdfBytes(path, pdfBytes) {
  const storageRef = buildStorageRef(path);
  await uploadBytes(storageRef, pdfBytes, { contentType: "application/pdf" });
  return getDownloadURL(storageRef);
}

export async function deleteStorageFile(path) {
  return deleteObject(buildStorageRef(path));
}

export async function getStorageDownloadUrl(path) {
  return getDownloadURL(buildStorageRef(path));
}
