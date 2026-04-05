import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdfImage } from "./imageLoader";
import { formatDateTimePtBr } from "../date";
import { formatGeoLocationSummary } from "../geolocation";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_LEFT = 18.47;
const CONTENT_RIGHT = 576.53;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;

const COLORS = {
  primary: rgb(0.12, 0.24, 0.47),
  text: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.34, 0.37, 0.41),
  border: rgb(0.7, 0.73, 0.78),
  black: rgb(0, 0, 0),
};

function safeText(value) {
  return String(value || "").trim();
}

function displayValue(value) {
  return safeText(value).toUpperCase();
}

function resolveDeliveryDateTime(delivery) {
  return formatDateTimePtBr(delivery?.faceVerifiedAt || delivery?.signatureCapturedAt || delivery?.createdAt || "");
}

function describeGeoLocation(geoLocation) {
  return formatGeoLocationSummary(geoLocation, {
    emptyText: "",
    notCapturedText: "Não capturada",
    capturedText: "capturada",
  });
}

function fitText(font, text, size, maxWidth) {
  const input = safeText(text);
  if (!input) return "";
  if (font.widthOfTextAtSize(input, size) <= maxWidth) return input;

  const ellipsis = "...";
  let candidate = input;

  while (candidate.length > 0 && font.widthOfTextAtSize(`${candidate}${ellipsis}`, size) > maxWidth) {
    candidate = candidate.slice(0, -1);
  }

  return candidate ? `${candidate}${ellipsis}` : ellipsis;
}

function wrapText(font, text, size, maxWidth) {
  const input = safeText(text);
  if (!input) return [""];

  const lines = [];
  const paragraphs = input.split(/\r?\n/);

  for (const paragraph of paragraphs) {
    const cleaned = paragraph.trim();
    if (!cleaned) {
      lines.push("");
      continue;
    }

    const words = cleaned.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function drawTextAtTop(page, text, { x, topY, size, font, color = COLORS.text }) {
  page.drawText(safeText(text), {
    x,
    y: PAGE_HEIGHT - topY - size,
    size,
    font,
    color,
  });
}

function drawWrappedTextAtTop(page, text, { x, topY, width, size, font, color = COLORS.text, lineGap = 8 }) {
  const lines = wrapText(font, text, size, width);

  lines.forEach((line, index) => {
    drawTextAtTop(page, line, {
      x,
      topY: topY + index * lineGap,
      size,
      font,
      color,
    });
  });

  return lines.length * lineGap;
}

function drawCenteredTextAtTop(page, text, { centerX, topY, size, font, color = COLORS.text }) {
  const width = font.widthOfTextAtSize(safeText(text), size);
  drawTextAtTop(page, text, {
    x: centerX - width / 2,
    topY,
    size,
    font,
    color,
  });
}

function drawFrameAtTop(page, { x, topY, width, height, borderColor = COLORS.black, borderWidth = 0.75 }) {
  page.drawRectangle({
    x,
    y: PAGE_HEIGHT - topY - height,
    width,
    height,
    borderColor,
    borderWidth,
  });
}

function drawLineAtTop(page, { x1, x2, topY, thickness = 1, color = COLORS.border }) {
  page.drawLine({
    start: { x: x1, y: PAGE_HEIGHT - topY },
    end: { x: x2, y: PAGE_HEIGHT - topY },
    thickness,
    color,
  });
}

function drawImageAtTop(page, image, { x, topY, width, height }) {
  page.drawImage(image, {
    x,
    y: PAGE_HEIGHT - topY - height,
    width,
    height,
  });
}

function drawFieldLine(page, fontRegular, fontBold, { label, value, x, topY, size = 8, maxWidth = 240 }) {
  const labelText = `${label}:`;
  const labelWidth = fontBold.widthOfTextAtSize(labelText, size);

  drawTextAtTop(page, labelText, {
    x,
    topY,
    size,
    font: fontBold,
    color: COLORS.text,
  });

  drawTextAtTop(page, fitText(fontRegular, value, size, Math.max(maxWidth - labelWidth - 5, 40)), {
    x: x + labelWidth + 5,
    topY,
    size,
    font: fontRegular,
    color: COLORS.text,
  });
}

function drawReceiptHeader(page, fontRegular, fontBold, logoImage, employee, delivery) {
  drawFrameAtTop(page, {
    x: CONTENT_LEFT,
    topY: 14,
    width: CONTENT_WIDTH,
    height: 810,
    borderColor: COLORS.black,
    borderWidth: 0.8,
  });

  if (logoImage) {
    const logoSize = logoImage.scaleToFit(90, 42);
    drawImageAtTop(page, logoImage, {
      x: 24,
      topY: 18,
      width: logoSize.width,
      height: logoSize.height,
    });
  }

  drawCenteredTextAtTop(page, "RECIBO DE ENTREGA DE EPI", {
    centerX: PAGE_WIDTH / 2,
    topY: 22,
    size: 16,
    font: fontBold,
    color: COLORS.primary,
  });
  drawCenteredTextAtTop(page, "Comprovante de entrega e recebimento", {
    centerX: PAGE_WIDTH / 2,
    topY: 38,
    size: 8.6,
    font: fontRegular,
    color: COLORS.muted,
  });

  drawFrameAtTop(page, {
    x: 24,
    topY: 60,
    width: 547,
    height: 90,
    borderColor: COLORS.black,
    borderWidth: 0.75,
  });

  const employeeName = displayValue(employee?.name || delivery?.employeeName);
  const registration = displayValue(employee?.registration || delivery?.employeeRegistration);
  const company = displayValue(employee?.company || delivery?.employeeCompany);
  const role = displayValue(employee?.role || delivery?.employeeRole);
  const lotacao = displayValue(employee?.lotacao || employee?.sector || delivery?.employeeLotacao || delivery?.sector);

  drawFieldLine(page, fontRegular, fontBold, {
    label: "Nome do Funcionário",
    value: employeeName,
    x: 34,
    topY: 74,
    maxWidth: 250,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "N° Registro",
    value: registration,
    x: 34,
    topY: 91,
    maxWidth: 250,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "Empresa",
    value: company,
    x: 300,
    topY: 74,
    maxWidth: 220,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "Cargo",
    value: role,
    x: 300,
    topY: 91,
    maxWidth: 220,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "Lotação",
    value: lotacao,
    x: 300,
    topY: 108,
    maxWidth: 220,
  });

  drawFrameAtTop(page, {
    x: 24,
    topY: 160,
    width: 547,
    height: 104,
    borderColor: COLORS.black,
    borderWidth: 0.75,
  });

  const itemName = displayValue(delivery?.itemName);
  const caNumber = displayValue(delivery?.caNumber);
  const quantity = safeText(delivery?.quantity);
  const deliveryDate = resolveDeliveryDateTime(delivery);
  const note = safeText(delivery?.note) || "Sem observações";

  drawFieldLine(page, fontRegular, fontBold, {
    label: "Data/Hora da entrega",
    value: deliveryDate,
    x: 34,
    topY: 174,
    maxWidth: 240,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "EPI",
    value: itemName,
    x: 34,
    topY: 192,
    maxWidth: 510,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "CA",
    value: caNumber,
    x: 34,
    topY: 210,
    maxWidth: 220,
  });
  drawFieldLine(page, fontRegular, fontBold, {
    label: "Quant",
    value: quantity,
    x: 300,
    topY: 210,
    maxWidth: 120,
  });
  drawTextAtTop(page, "Observação:", {
    x: 34,
    topY: 228,
    size: 8,
    font: fontBold,
    color: COLORS.text,
  });
  drawWrappedTextAtTop(page, note, {
    x: 116,
    topY: 228,
    width: 444,
    size: 7.4,
    font: fontRegular,
    color: COLORS.text,
    lineGap: 8,
  });

  const geoLocationSummary = describeGeoLocation(delivery?.geoLocation);
  if (geoLocationSummary) {
    drawTextAtTop(page, `Localização: ${fitText(fontRegular, geoLocationSummary, 6.7, 500)}`, {
      x: 34,
      topY: 246,
      size: 6.7,
      font: fontRegular,
      color: COLORS.muted,
    });
  }

  drawFrameAtTop(page, {
    x: 24,
    topY: 276,
    width: 547,
    height: 154,
    borderColor: COLORS.black,
    borderWidth: 0.75,
  });

  drawCenteredTextAtTop(page, "DECLARAÇÃO", {
    centerX: PAGE_WIDTH / 2,
    topY: 284,
    size: 10.4,
    font: fontBold,
    color: COLORS.text,
  });

  const declaration = [
    "Declaro para os devidos fins que recebi o EPI acima descrito, em perfeito estado de conservação e funcionamento.",
    "Comprometo-me a utilizá-lo corretamente, zelar por sua guarda e comunicar imediatamente qualquer avaria, perda ou necessidade de troca.",
    "Estou ciente das normas internas da empresa e da NR-6 aplicáveis ao uso e controle deste equipamento.",
  ].join(" ");

  drawWrappedTextAtTop(page, declaration, {
    x: 34,
    topY: 298,
    width: 520,
    size: 7.1,
    font: fontRegular,
    color: COLORS.text,
    lineGap: 8,
  });

  drawFrameAtTop(page, {
    x: 24,
    topY: 444,
    width: 547,
    height: 228,
    borderColor: COLORS.black,
    borderWidth: 0.75,
  });

  drawCenteredTextAtTop(page, "ASSINATURA DO COLABORADOR", {
    centerX: PAGE_WIDTH / 2,
    topY: 452,
    size: 10,
    font: fontBold,
    color: COLORS.text,
  });

}

export function buildDeliveryReceiptFilename({ employee, delivery }) {
  const employeeName = safeText(employee?.name || delivery?.employeeName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const registration = safeText(employee?.registration || delivery?.employeeRegistration)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const deliveryId = safeText(delivery?.id)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const suffix = [employeeName, registration, deliveryId].filter(Boolean).join("-");
  return `recibo-entrega${suffix ? `-${suffix}` : ""}.pdf`;
}

export async function generateDeliveryReceiptPdf({
  employee,
  delivery,
  epi,
  logoUrl = "/brand-logo.png",
  signatureUrl = "",
  signatureDataUrl = "",
}) {
  if (!delivery) {
    throw new Error("Entrega não informada.");
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const imageCache = new Map();

  const logoImage = await loadPdfImage(pdfDoc, logoUrl, imageCache);
  const signatureImage = await loadPdfImage(
    pdfDoc,
    signatureDataUrl || signatureUrl || delivery?.signatureDataUrl || delivery?.signatureImageUrl,
    imageCache
  );

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawReceiptHeader(page, fontRegular, fontBold, logoImage, employee, {
    ...delivery,
    itemName: delivery?.itemName || epi?.name,
    caNumber: epi?.caNumber || delivery?.caNumber,
    signatureImageUrl: signatureUrl || delivery?.signatureImageUrl,
  });

  drawTextAtTop(page, `Gerado em: ${formatDateTimePtBr(new Date())}`, {
    x: 34,
    topY: 692,
    size: 7.2,
    font: fontRegular,
    color: COLORS.muted,
  });
  drawTextAtTop(page, `Recibo: ${buildDeliveryReceiptFilename({ employee, delivery }).replace(/\.pdf$/i, "")}`, {
    x: 34,
    topY: 704,
    size: 7.2,
    font: fontRegular,
    color: COLORS.muted,
  });

  if (signatureImage) {
    const signatureArea = {
      x: 36,
      topY: 484,
      width: 523,
      height: 110,
    };
    const scale = Math.min(signatureArea.width / signatureImage.width, signatureArea.height / signatureImage.height);
    const drawWidth = signatureImage.width * scale;
    const drawHeight = signatureImage.height * scale;

    drawImageAtTop(page, signatureImage, {
      x: signatureArea.x + (signatureArea.width - drawWidth) / 2,
      topY: signatureArea.topY + (signatureArea.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  return pdfDoc.save();
}
