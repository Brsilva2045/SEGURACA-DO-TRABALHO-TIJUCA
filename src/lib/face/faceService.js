import { formatDateTimePtBr } from "../date";

const FACE_MODEL_URI = "/models";
export const FACE_MATCH_THRESHOLD = 0.5;

let faceApiModulePromise = null;
let faceModelsPromise = null;

async function loadFaceApiModule() {
  if (!faceApiModulePromise) {
    faceApiModulePromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      if (typeof tf.ready === "function") {
        await tf.ready();
      }

      const faceapi = await import("face-api.js");
      return faceapi;
    })();
  }

  return faceApiModulePromise;
}

export async function ensureFaceModelsLoaded() {
  if (!faceModelsPromise) {
    faceModelsPromise = (async () => {
      const faceapi = await loadFaceApiModule();

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URI),
        faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODEL_URI),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URI),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URI),
      ]);

      return faceapi;
    })();
  }

  return faceModelsPromise;
}

function safeText(value) {
  return String(value || "").trim();
}

function toDescriptorArray(descriptor) {
  if (descriptor instanceof Float32Array) {
    return Array.from(descriptor);
  }

  if (Array.isArray(descriptor)) {
    return Array.from(descriptor, (value) => Number(value));
  }

  if (descriptor && typeof descriptor === "object") {
    const values = descriptor.values || descriptor.descriptor || descriptor.data;
    if (Array.isArray(values)) {
      return Array.from(values, (value) => Number(value));
    }
  }

  return [];
}

function normalizeStoredDescriptors(descriptors) {
  if (!Array.isArray(descriptors)) return [];

  return descriptors
    .map((descriptor) => {
      if (descriptor instanceof Float32Array) {
        return descriptor;
      }

      if (Array.isArray(descriptor)) {
        return new Float32Array(descriptor.map((value) => Number(value)));
      }

      if (descriptor && typeof descriptor === "object") {
        const values = descriptor.values || descriptor.descriptor || descriptor.data;
        if (Array.isArray(values)) {
          return new Float32Array(values.map((value) => Number(value)));
        }
      }

      return null;
    })
    .filter((descriptor) => descriptor instanceof Float32Array && descriptor.length > 0);
}

async function loadImageElement(source) {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return source;
  }

  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return source;
  }

  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    return source;
  }

  if (typeof File !== "undefined" && source instanceof File) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Não foi possível preparar a imagem para leitura facial.");
        }

        ctx.drawImage(bitmap, 0, 0);
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }

        return canvas;
      } catch {
        // Fallback para o carregamento tradicional via <img>.
      }
    }

    const objectUrl = URL.createObjectURL(source);

    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Não foi possível ler a imagem ${source.name || ""}.`));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (typeof source === "string" && safeText(source)) {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Não foi possível carregar a imagem para leitura facial."));
      image.src = source;
    });
  }

  throw new Error("Fonte de imagem não suportada para reconhecimento facial.");
}

async function detectFaceDescriptorWithTinyDetector(faceapi, input, inputSize, scoreThreshold) {
  return faceapi
    .detectSingleFace(
      input,
      new faceapi.TinyFaceDetectorOptions({
        inputSize,
        scoreThreshold,
      })
    )
    .withFaceLandmarks(true)
    .withFaceDescriptor();
}

async function detectFaceDescriptorWithSsdDetector(faceapi, input, minConfidence) {
  return faceapi
    .detectSingleFace(
      input,
      new faceapi.SsdMobilenetv1Options({
        minConfidence,
      })
    )
    .withFaceLandmarks(true)
    .withFaceDescriptor();
}

async function detectFaceDescriptorFromInput(input) {
  const faceapi = await ensureFaceModelsLoaded();
  const detectionAttempts = [
    () => detectFaceDescriptorWithTinyDetector(faceapi, input, 608, 0.12),
    () => detectFaceDescriptorWithTinyDetector(faceapi, input, 512, 0.15),
    () => detectFaceDescriptorWithTinyDetector(faceapi, input, 416, 0.18),
    () => detectFaceDescriptorWithTinyDetector(faceapi, input, 320, 0.2),
    () => detectFaceDescriptorWithSsdDetector(faceapi, input, 0.25),
  ];

  for (const attempt of detectionAttempts) {
    try {
      const detection = await attempt();
      if (detection) {
        return detection.descriptor;
      }
    } catch {
      // Tenta o próximo detector/configuração.
    }
  }

  throw new Error(
    "Nenhuma face válida foi detectada nas fotos enviadas. Use uma foto de frente, bem iluminada e com o rosto mais centralizado."
  );
}

export async function extractFaceDescriptorsFromFiles(files = []) {
  const descriptors = [];
  const failedFiles = [];

  for (const file of files) {
    try {
      const image = await loadImageElement(file);
      const descriptor = await detectFaceDescriptorFromInput(image);
      descriptors.push({
        values: toDescriptorArray(descriptor),
        length: descriptor?.length || 0,
        sourceFileName: safeText(file?.name) || null,
      });
    } catch (error) {
      failedFiles.push({
        name: safeText(file?.name) || "foto",
        error: error?.message || "Falha ao ler a foto.",
      });
    }
  }

  if (!descriptors.length) {
    throw new Error("Nenhuma face válida foi detectada nas fotos enviadas.");
  }

  return {
    descriptors,
    failedFiles,
  };
}

export async function detectFaceMatchFromSource(source, employees = [], threshold = FACE_MATCH_THRESHOLD) {
  const eligibleEmployees = (Array.isArray(employees) ? employees : []).filter((employee) => {
    const descriptors = normalizeStoredDescriptors(employee?.faceDescriptors || employee?.faceDescriptor || []);
    return descriptors.length > 0;
  });

  if (!eligibleEmployees.length) {
    throw new Error("Nenhum colaborador possui cadastro facial.");
  }

  const faceapi = await ensureFaceModelsLoaded();
  const input = await loadImageElement(source);
  const descriptor = await detectFaceDescriptorFromInput(input);

  const labeledDescriptors = eligibleEmployees.map((employee) => {
    const rawDescriptors = employee.faceDescriptors || employee.faceDescriptor || [];
    const normalizedDescriptors = normalizeStoredDescriptors(rawDescriptors);
    return new faceapi.LabeledFaceDescriptors(employee.id, normalizedDescriptors);
  });

  const matcher = new faceapi.FaceMatcher(labeledDescriptors, threshold);
  const bestMatch = matcher.findBestMatch(descriptor);
  const matchedEmployee = bestMatch.label === "unknown"
    ? null
    : eligibleEmployees.find((employee) => employee.id === bestMatch.label) || null;

  return {
    bestMatch,
    descriptor: toDescriptorArray(descriptor),
    matchedEmployee,
    eligibleEmployeesCount: eligibleEmployees.length,
  };
}

export function buildFaceVerificationBadge({
  title = "RECONHECIMENTO FACIAL",
  employeeName = "",
  registration = "",
  distance = null,
  verifiedAt = new Date(),
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 980;
  canvas.height = 260;
  const ctx = canvas.getContext("2d");

  const date = verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);
  const formattedDate = Number.isNaN(date.getTime()) ? "" : formatDateTimePtBr(date);

  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#0f172a");
  background.addColorStop(1, "#1d4ed8");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(0, 0, canvas.width, 18);

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 42, 72);

  ctx.font = "600 26px sans-serif";
  ctx.fillText(`Colaborador: ${employeeName || "Sem nome"}`, 42, 122);
  ctx.fillText(`Matrícula: ${registration || "N/D"}`, 42, 164);

  const distanceLabel = distance === null || distance === undefined ? "N/D" : Number(distance).toFixed(3);
  ctx.fillText(`Distância facial: ${distanceLabel}`, 42, 206);

  ctx.textAlign = "right";
  ctx.font = "500 20px sans-serif";
  ctx.fillText(formattedDate ? `Validado em ${formattedDate}` : "Validado", canvas.width - 42, 72);

  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = "#dbeafe";
  ctx.fillText("FACE OK", canvas.width - 42, 138);

  ctx.font = "500 18px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("Autenticação concluída pelo Firebase", canvas.width - 42, 172);

  return canvas.toDataURL("image/png");
}
