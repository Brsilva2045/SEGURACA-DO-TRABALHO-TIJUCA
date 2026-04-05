import { downloadStorageFileDataUrl } from "../firebase/storage";

function safeText(value) {
  return String(value || "").trim();
}

function isDataUrl(source) {
  return /^data:/i.test(safeText(source));
}

function isFirebaseStorageDownloadUrl(source) {
  return /^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/.+/i.test(safeText(source));
}

function decodeBase64(base64) {
  const cleanBase64 = safeText(base64).replace(/\s+/g, "");

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(cleanBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(cleanBase64, "base64"));
  }

  return null;
}

function parseDataUrl(source) {
  const match = safeText(source).match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i);
  if (!match) return null;

  const contentType = safeText(match[1]);
  const bytes = decodeBase64(match[2]);
  if (!bytes) return null;

  return { contentType, bytes };
}

function hasCanvasSupport() {
  return typeof document !== "undefined" && typeof Image !== "undefined";
}

function loadHtmlImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.decoding = "async";
    image.src = source;
  });
}

function findVisibleBounds(imageData, width, height, { alphaThreshold = 0, whiteThreshold = null } = {}) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const { data } = imageData;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const isNearWhite =
        Number.isFinite(whiteThreshold) &&
        red >= whiteThreshold &&
        green >= whiteThreshold &&
        blue >= whiteThreshold;

      if (alpha > alphaThreshold && !isNearWhite) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

async function trimTransparentPaddingFromDataUrl(dataUrl) {
  const source = safeText(dataUrl);
  if (!source || !hasCanvasSupport()) {
    return source;
  }

  const image = await loadHtmlImage(source).catch(() => null);
  if (!image) {
    return source;
  }

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    return source;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return source;
  }

  context.drawImage(image, 0, 0);

  let imageData;
  try {
    imageData = context.getImageData(0, 0, width, height);
  } catch {
    return source;
  }

  const tryCrop = (bounds, paddingRatio = 0.02) => {
    if (!bounds) {
      return source;
    }

    const padding = Math.max(1, Math.round(Math.min(width, height) * paddingRatio));
    const cropX = Math.max(0, bounds.minX - padding);
    const cropY = Math.max(0, bounds.minY - padding);
    const cropWidth = Math.min(width - cropX, bounds.maxX - bounds.minX + 1 + padding * 2);
    const cropHeight = Math.min(height - cropY, bounds.maxY - bounds.minY + 1 + padding * 2);

    if (cropWidth >= width && cropHeight >= height) {
      return source;
    }

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;

    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) {
      return source;
    }

    cropContext.drawImage(
      canvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    return cropCanvas.toDataURL("image/png");
  };

  const transparentBounds = findVisibleBounds(imageData, width, height, { alphaThreshold: 0 });
  const transparentCrop = tryCrop(transparentBounds, 0.018);
  if (transparentCrop !== source) {
    return transparentCrop;
  }

  const whiteBounds = findVisibleBounds(imageData, width, height, {
    alphaThreshold: 0,
    whiteThreshold: 248,
  });
  return tryCrop(whiteBounds, 0.008);
}

function inferImageKind(source, contentType = "") {
  const hint = `${safeText(contentType)} ${safeText(source)}`.toLowerCase();

  if (hint.includes("png")) return "png";
  if (hint.includes("jpeg") || hint.includes("jpg")) return "jpg";

  return "";
}

async function embedImage(pdfDoc, bytes, source, contentType = "") {
  const imageKind = inferImageKind(source, contentType);

  if (imageKind === "png") {
    return pdfDoc.embedPng(bytes);
  }

  if (imageKind === "jpg") {
    return pdfDoc.embedJpg(bytes);
  }

  return null;
}

function isRelativeImageUrl(source) {
  const text = safeText(source);
  if (!text) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false;
  return true;
}

function resolveRelativeImageUrl(source) {
  const text = safeText(source);
  if (!text) return "";

  if (typeof window === "undefined") {
    return text;
  }

  try {
    return new URL(text, window.location.href).href;
  } catch {
    return text;
  }
}

export async function loadPdfImage(pdfDoc, source, cache) {
  const cacheKey = safeText(source);
  if (!cacheKey) return null;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const promise = (async () => {
    if (isDataUrl(cacheKey)) {
      const trimmedSource = await trimTransparentPaddingFromDataUrl(cacheKey);
      const parsed = parseDataUrl(trimmedSource);
      if (parsed) {
        const embedded = await embedImage(pdfDoc, parsed.bytes, trimmedSource, parsed.contentType);
        if (embedded) return embedded;
      }
    }

    if (isFirebaseStorageDownloadUrl(cacheKey) || cacheKey.startsWith("gs://")) {
      const dataUrl = await downloadStorageFileDataUrl(cacheKey).catch(() => "");
      const trimmedSource = await trimTransparentPaddingFromDataUrl(dataUrl);
      const parsed = parseDataUrl(trimmedSource);
      if (parsed) {
        const embedded = await embedImage(pdfDoc, parsed.bytes, trimmedSource, parsed.contentType);
        if (embedded) return embedded;
      }

      return null;
    }

    try {
      if (/^https?:\/\//i.test(cacheKey) || isRelativeImageUrl(cacheKey)) {
        const resolvedUrl = /^https?:\/\//i.test(cacheKey) ? cacheKey : resolveRelativeImageUrl(cacheKey);
        const response = await fetch(resolvedUrl);
        if (response.ok) {
          const bytes = await response.arrayBuffer();
          const contentType = response.headers.get("content-type") || "";
          const embedded = await embedImage(pdfDoc, bytes, cacheKey, contentType);
          if (embedded) return embedded;
        }
      }
    } catch {
      return null;
    }

    return null;
  })();

  cache.set(cacheKey, promise);
  return promise;
}
