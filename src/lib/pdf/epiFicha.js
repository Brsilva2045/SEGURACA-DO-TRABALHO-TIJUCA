import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdfImage } from "./imageLoader";
import { formatDateTimePtBr } from "../date";
import { formatGeoLocationSummary } from "../geolocation";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TABLE_LEFT = 15;
const TABLE_RIGHT = 580;
const HEADER_HEIGHT_FIRST_PAGE = 14.5;
const MIN_HISTORY_ROWS = 1;
const MAX_HISTORY_ROWS = 18;
const MIN_HISTORY_ROW_HEIGHT = 24;
const MAX_HISTORY_ROW_HEIGHT = 54;
const HEADER_TEXT_SIZE = 5.8;
const HEADER_TEXT_MIN_SIZE = 4.5;
const HEADER_TEXT_LINE_GAP = 1.9;
const ROW_TEXT_SIZE = 5.3;

const COLORS = {
  border: rgb(0.76, 0.79, 0.84),
  text: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.34, 0.37, 0.41),
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
};

const TABLE_COLUMNS = [
  { key: "date", title: "DATA/HORA\nDE ENTREGA", width: 60, align: "center" },
  { key: "location", title: "LOCALIZAÇÃO", width: 92, align: "left" },
  { key: "description", title: "DESCRIÇÃO", width: 101, align: "left" },
  { key: "ca", title: "CA", width: 48, align: "center" },
  { key: "quantity", title: "QUANT", width: 28, align: "center" },
  { key: "signature", title: "ASSINATURA", width: 236, align: "center" },
];

const DECLARATION_LINES = [
  "A - Declaro haver recebido, nesta data, para o meu uso e proteção pessoal, em serviço, os equipamentos abaixo descritos, os quais me comprometo a utilizar de acordo com orientações técnicas que me foram dadas quanto ao seu uso, tarefas e locais determinados.",
  "B - Responsabilizo-me também pela guarda e conservação dos equipamentos, respondendo pelo eventual desaparecimento e/ou danos causados por descuido ou mau uso - NR 6 da Portaria SIT nº25, de 15 de Outubro de 2001. Publicada no DOU em 17 de Outubro de 2001.",
  "C - Comprometo-me ainda a apresentar para troca, todo o equipamento que no decorrer do uso apresentar defeitos ou desgastes naturais da utilização, tão logo estes forem constatados.",
  "D - Declaro também, estar ciente, de que o não uso dos equipamentos abaixo discriminados, constitui ato faltoso cabível a aplicação de medidas disciplinares, por parte da Empresa, conforme a lei 6514 de 22.12.77, artigo 158, parágrafo único e NR 6 item 6.7",
];

function toComparable(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function safeText(value) {
  return String(value || "").trim();
}

function displayValue(value) {
  return safeText(value).toUpperCase();
}

function resolveDeliveryDateValue(delivery) {
  return delivery?.faceVerifiedAt || delivery?.signatureCapturedAt || delivery?.createdAt || "";
}

function describeGeoLocation(geoLocation) {
  return formatGeoLocationSummary(geoLocation, {
    includeAccuracy: false,
    emptyText: "GPS NAO CAPTURADO",
    notCapturedText: "GPS NAO CAPTURADO",
    capturedText: "GPS CAPTURADO",
    uppercase: true,
    preferReason: false,
  });
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

function parseBrazilianDateTime(value) {
  const text = safeText(value);
  if (!text) return 0;

  const isoLike = Date.parse(text);
  if (!Number.isNaN(isoLike) && /T/.test(text)) {
    return isoLike;
  }

  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+)?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime();
  }

  return Number.isNaN(isoLike) ? 0 : isoLike;
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

function drawWrappedTextAtTop(page, text, { x, topY, width, size, font, color = COLORS.text, lineGap = 9 }) {
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

function drawFieldLine(page, fontRegular, fontBold, { label, value, x, topY, size = 7.8, maxWidth = 240 }) {
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

function drawStackedField(page, fontRegular, fontBold, { label, value, x, topY, width, labelSize = 5.6, valueSize = 8.2 }) {
  drawTextAtTop(page, fitText(fontRegular, label, labelSize, width), {
    x,
    topY,
    size: labelSize,
    font: fontRegular,
    color: COLORS.muted,
  });

  drawTextAtTop(page, fitText(fontBold, value, valueSize, width), {
    x,
    topY: topY + 8,
    size: valueSize,
    font: fontBold,
    color: COLORS.text,
  });
}

function drawRectAtTop(page, { x, topY, width, height, fillColor, borderColor, borderWidth = 1 }) {
  page.drawRectangle({
    x,
    y: PAGE_HEIGHT - topY - height,
    width,
    height,
    color: fillColor,
    borderColor,
    borderWidth,
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

function matchesEmployee(delivery, employee) {
  if (!delivery || !employee) return false;

  if (toComparable(delivery.employeeId) && toComparable(employee.id) === toComparable(delivery.employeeId)) {
    return true;
  }

  const employeeName = toComparable(employee.name);
  const employeeRegistration = toComparable(employee.registration);

  return (
    (employeeName && employeeName === toComparable(delivery.employeeName)) ||
    (employeeRegistration && employeeRegistration === toComparable(delivery.employeeRegistration))
  );
}

function buildDeliveryRows(employee, deliveries, epis) {
  const epiById = new Map((epis || []).map((item) => [item.id, item]));

  return (deliveries || [])
    .filter((delivery) => matchesEmployee(delivery, employee))
    .map((delivery, index) => {
      const epi = epiById.get(delivery.itemId);
      const quantity = Number(delivery.quantity || 0);
      const deliveryDateValue = resolveDeliveryDateValue(delivery);

      return {
        id: delivery.id || `row-${index}`,
        date: formatDateTimePtBr(deliveryDateValue),
        dateSort: parseBrazilianDateTime(deliveryDateValue),
        location: describeGeoLocation(delivery.geoLocation),
        description: safeText(delivery.itemName || epi?.name || "EPI"),
        ca: safeText(epi?.caNumber || delivery.caNumber || ""),
        quantity: quantity > 0 ? String(quantity) : "",
        signatureDataUrl: safeText(delivery.signatureDataUrl),
        signatureImageUrl: safeText(delivery.signatureImageUrl),
        signatureStatus: safeText(delivery.signatureStatus),
        geoLocation: delivery.geoLocation || null,
      };
    })
    .sort((a, b) => a.dateSort - b.dateSort);
}

function drawEmployeeHeader(page, employee, fontRegular, fontBold, logoImage) {
  drawFrameAtTop(page, {
    x: TABLE_LEFT,
    topY: 14,
    width: TABLE_RIGHT - TABLE_LEFT,
    height: 88,
    borderColor: COLORS.black,
    borderWidth: 0.8,
  });

  if (logoImage) {
    const logoSize = logoImage.scaleToFit(78, 36);
    drawImageAtTop(page, logoImage, {
      x: 22,
      topY: 18,
      width: logoSize.width,
      height: logoSize.height,
    });
  }

  drawCenteredTextAtTop(page, "FICHA DE ENTREGA DE EPI", {
    centerX: PAGE_WIDTH / 2,
    topY: 24,
    size: 12.8,
    font: fontBold,
    color: COLORS.text,
  });
  drawCenteredTextAtTop(page, "Controle de entrega e recebimento", {
    centerX: PAGE_WIDTH / 2,
    topY: 40,
    size: 6.6,
    font: fontRegular,
    color: COLORS.muted,
  });
}

function drawDeclarationSection(page, fontRegular, fontBold) {
  drawFrameAtTop(page, {
    x: TABLE_LEFT,
    topY: 108,
    width: TABLE_RIGHT - TABLE_LEFT,
    height: 78,
    borderColor: COLORS.black,
    borderWidth: 0.72,
  });
  drawCenteredTextAtTop(page, "DECLARAÇÃO", {
    centerX: PAGE_WIDTH / 2,
    topY: 110.2,
    size: 4.9,
    font: fontBold,
    color: COLORS.text,
  });

  let topY = 117.4;
  DECLARATION_LINES.forEach((paragraph, index) => {
    const usedHeight = drawWrappedTextAtTop(page, paragraph, {
      x: 20,
      topY,
      width: 555,
      size: 5.5,
      font: fontRegular,
      color: COLORS.text,
      lineGap: 5.55,
    });
    topY += usedHeight + (index === 3 ? 3.5 : 1.5);
  });
}

function drawEmployeeInfoSection(page, employee, locationText, fontRegular, fontBold) {
  drawStackedField(page, fontRegular, fontBold, {
    label: "Nome do Funcionário",
    value: displayValue(employee?.name),
    x: 30,
    topY: 194,
    width: 250,
    labelSize: 5.2,
    valueSize: 7.5,
  });
  drawStackedField(page, fontRegular, fontBold, {
    label: "N° Registro",
    value: displayValue(employee?.registration),
    x: 290,
    topY: 194,
    width: 110,
    labelSize: 5.2,
    valueSize: 7.5,
  });
  drawStackedField(page, fontRegular, fontBold, {
    label: "Localização",
    value: displayValue(locationText),
    x: 415,
    topY: 194,
    width: 150,
    labelSize: 4.8,
    valueSize: 5.8,
  });
  drawStackedField(page, fontRegular, fontBold, {
    label: "Função",
    value: displayValue(employee?.role),
    x: 30,
    topY: 210,
    width: 250,
    labelSize: 5.2,
    valueSize: 7.5,
  });
  drawStackedField(page, fontRegular, fontBold, {
    label: "Setor",
    value: displayValue(employee?.lotacao || employee?.sector),
    x: 290,
    topY: 210,
    width: 275,
    labelSize: 5.2,
    valueSize: 7.5,
  });
}

function drawTableHeader(page, topY, height, fontBold) {
  let currentX = TABLE_LEFT;

  TABLE_COLUMNS.forEach((column) => {
    const lines = safeText(column.title).split("\n");
    const isMultiline = lines.length > 1;
    const textSize = isMultiline
      ? Math.max(
          HEADER_TEXT_MIN_SIZE,
          Math.min(5.6, (height - 3 - (lines.length - 1) * HEADER_TEXT_LINE_GAP) / lines.length)
        )
      : HEADER_TEXT_SIZE;
    const labelWidth = Math.max(
      ...lines.map((line) => fontBold.widthOfTextAtSize(line, textSize)),
      0
    );

    drawRectAtTop(page, {
      x: currentX,
      topY,
      width: column.width,
      height,
      fillColor: COLORS.white,
      borderColor: COLORS.black,
      borderWidth: 0.85,
    });

    if (isMultiline) {
      const totalTextHeight = lines.length * textSize + (lines.length - 1) * HEADER_TEXT_LINE_GAP;
      const startTopY = topY + Math.max((height - totalTextHeight) / 2, 0.6);
      lines.forEach((line, index) => {
        const lineWidth = fontBold.widthOfTextAtSize(line, textSize);
        const labelX =
          column.align === "left"
            ? currentX + 4
            : currentX + Math.max((column.width - lineWidth) / 2, 1.5);

        drawTextAtTop(page, line, {
          x: labelX,
          topY: startTopY + index * (textSize + HEADER_TEXT_LINE_GAP),
          size: textSize,
          font: fontBold,
          color: COLORS.text,
        });
      });
    } else {
      const labelX =
        column.align === "left"
          ? currentX + 4
          : currentX + Math.max((column.width - labelWidth) / 2, 2);

      drawTextAtTop(page, column.title, {
        x: labelX,
        topY: topY + Math.max((height - textSize) / 2, 0.7),
        size: textSize,
        font: fontBold,
        color: COLORS.text,
      });
    }

    currentX += column.width;
  });
}

async function drawTableRows(page, rows, bodyTop, rowHeight, fontRegular, fontBold, pdfDoc, imageCache) {
  let currentXPositions = [];
  let cursorX = TABLE_LEFT;
  TABLE_COLUMNS.forEach((column) => {
    currentXPositions.push(cursorX);
    cursorX += column.width;
  });

  const populatedRows = rows.filter(Boolean);
  const hasMoreThanOneRow = populatedRows.length > 1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowTop = bodyTop + rowIndex * rowHeight;

    if (!row) continue;

    const rowY = rowTop + Math.max((rowHeight - ROW_TEXT_SIZE) / 2 - 0.8, 2.6);
    const dateLines = safeText(row.date)
      .split(",")
      .map((line) => line.trim())
      .filter(Boolean);
    const resolvedDateLines =
      dateLines.length > 1
        ? dateLines.slice(0, 2)
        : wrapText(fontRegular, row.date, 4.6, TABLE_COLUMNS[0].width - 8).slice(0, 2);
    const dateTextSize = resolvedDateLines.length > 1 ? 4.6 : ROW_TEXT_SIZE;
    const dateLineGap = resolvedDateLines.length > 1 ? 5.2 : ROW_TEXT_SIZE;
    const dateStartTopY =
      resolvedDateLines.length > 1
        ? rowTop + Math.max((rowHeight - resolvedDateLines.length * dateLineGap) / 2 - 0.2, 2.3)
        : rowY;

    resolvedDateLines.forEach((line, index) => {
      drawTextAtTop(page, fitText(fontRegular, line, dateTextSize, TABLE_COLUMNS[0].width - 6), {
        x: currentXPositions[0] + 4,
        topY: dateStartTopY + index * dateLineGap,
        size: dateTextSize,
        font: fontRegular,
        color: COLORS.text,
      });
    });

    const locationLines = wrapText(fontRegular, row.location, 4.6, TABLE_COLUMNS[1].width - 8).slice(0, 3);
    const locationLineGap = 5.1;
    const locationStartTopY = rowTop + Math.max((rowHeight - locationLines.length * locationLineGap) / 2 - 0.2, 2.3);
    locationLines.forEach((line, index) => {
      drawTextAtTop(page, line, {
        x: currentXPositions[1] + 4,
        topY: locationStartTopY + index * locationLineGap,
        size: 4.6,
        font: fontRegular,
        color: COLORS.text,
      });
    });

    drawTextAtTop(page, fitText(fontRegular, row.description, ROW_TEXT_SIZE, TABLE_COLUMNS[2].width - 6), {
      x: currentXPositions[2] + 4,
      topY: rowY,
      size: ROW_TEXT_SIZE,
      font: fontRegular,
      color: COLORS.text,
    });

    drawTextAtTop(page, fitText(fontRegular, row.ca, ROW_TEXT_SIZE, TABLE_COLUMNS[3].width - 6), {
      x: currentXPositions[3] + 4,
      topY: rowY,
      size: ROW_TEXT_SIZE,
      font: fontRegular,
      color: COLORS.text,
    });

    drawTextAtTop(page, fitText(fontRegular, row.quantity, ROW_TEXT_SIZE, TABLE_COLUMNS[4].width - 6), {
      x: currentXPositions[4] + 4,
      topY: rowY,
      size: ROW_TEXT_SIZE,
      font: fontRegular,
      color: COLORS.text,
    });

    const signatureCell = {
      x: currentXPositions[5],
      width: TABLE_COLUMNS[5].width,
      topY: rowTop,
      height: rowHeight,
    };

    let signatureImage = null;
    if (row.signatureDataUrl || row.signatureImageUrl) {
      signatureImage = await loadPdfImage(
        pdfDoc,
        row.signatureDataUrl || row.signatureImageUrl,
        imageCache
      );
    }

    if (signatureImage) {
      const maxWidth = signatureCell.width - 1.5;
      const maxHeight = signatureCell.height - 1;
      const scale = Math.min(maxWidth / signatureImage.width, maxHeight / signatureImage.height);
      const drawWidth = signatureImage.width * scale;
      const drawHeight = signatureImage.height * scale;
      drawImageAtTop(page, signatureImage, {
        x: signatureCell.x + (signatureCell.width - drawWidth) / 2,
        topY: signatureCell.topY + (signatureCell.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    } else if (row.signatureStatus) {
      drawTextAtTop(page, fitText(fontBold, "ASSINADO", 5.0, signatureCell.width - 8), {
        x: signatureCell.x + 4,
        topY: rowY,
        size: 5.0,
        font: fontBold,
        color: COLORS.muted,
      });
    }

    if (hasMoreThanOneRow && rowIndex < populatedRows.length - 1) {
      drawLineAtTop(page, {
        x1: TABLE_LEFT + 2,
        x2: TABLE_RIGHT - 2,
        topY: rowTop + rowHeight,
        thickness: 0.55,
        color: COLORS.border,
      });
    }
  }
}

export function buildEmployeeFichaFilename(employee) {
  const safe = safeText(employee?.name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const registration = safeText(employee?.registration)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const suffix = [safe, registration].filter(Boolean).join("-");
  return `ficha-epi${suffix ? `-${suffix}` : ""}.pdf`;
}

export async function generateEmployeeFichaPdf({ employee, deliveries = [], epis = [], logoUrl = "/brand-logo.png" }) {
  if (!employee) {
    throw new Error("Colaborador não informado.");
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const imageCache = new Map();

  const logoImage = await loadPdfImage(pdfDoc, logoUrl, imageCache);
  const deliveryRows = buildDeliveryRows(employee, deliveries, epis);
  const latestGeoLocation = [...deliveryRows].reverse().find((row) => row?.geoLocation)?.geoLocation || null;
  const locationText = describeGeoLocation(latestGeoLocation);
  const historyRowCount = Math.min(
    MAX_HISTORY_ROWS,
    Math.max(MIN_HISTORY_ROWS, deliveryRows.length)
  );
  const visibleRows = deliveryRows.slice(-historyRowCount);
  const renderRows = visibleRows.concat(
    Array.from({ length: Math.max(historyRowCount - visibleRows.length, 0) }, () => null)
  );
  const availableHistoryHeight = 542;
  const historyRowHeight = Math.max(
    MIN_HISTORY_ROW_HEIGHT,
    Math.min(MAX_HISTORY_ROW_HEIGHT, availableHistoryHeight / historyRowCount)
  );
  const tableBodyHeight = historyRowHeight * historyRowCount;

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  drawEmployeeHeader(page, employee, fontRegular, fontBold, logoImage);
  drawDeclarationSection(page, fontRegular, fontBold);
  drawEmployeeInfoSection(page, employee, locationText, fontRegular, fontBold);
  drawFrameAtTop(page, {
    x: TABLE_LEFT,
    topY: 242.11,
    width: TABLE_RIGHT - TABLE_LEFT,
    height: tableBodyHeight,
    borderColor: COLORS.black,
    borderWidth: 0.75,
  });
  drawTableHeader(page, 227.61, HEADER_HEIGHT_FIRST_PAGE, fontBold);

  await drawTableRows(page, renderRows, 242.11, historyRowHeight, fontRegular, fontBold, pdfDoc, imageCache);

  return pdfDoc.save();
}
