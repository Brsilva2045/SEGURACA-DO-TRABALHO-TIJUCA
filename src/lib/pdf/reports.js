import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_LEFT = 24;
const CONTENT_RIGHT = 571;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const FOOTER_TOP = 796;
const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_HEIGHT = 18;
const TABLE_ROW_TEXT_SIZE = 5.2;

const COLORS = {
  primary: rgb(0.12, 0.24, 0.47),
  primaryDark: rgb(0.08, 0.18, 0.36),
  text: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.34, 0.37, 0.41),
  border: rgb(0.73, 0.76, 0.81),
  white: rgb(1, 1, 1),
  softBlue: rgb(0.95, 0.98, 1),
  softGreen: rgb(0.95, 0.99, 0.97),
  softAmber: rgb(1, 0.98, 0.93),
  softRose: rgb(1, 0.95, 0.96),
  softGray: rgb(0.98, 0.98, 0.99),
};

const SUMMARY_ACCENTS = [
  { accent: rgb(0.12, 0.24, 0.47), fill: COLORS.softBlue },
  { accent: rgb(0.08, 0.59, 0.42), fill: COLORS.softGreen },
  { accent: rgb(0.84, 0.52, 0.08), fill: COLORS.softAmber },
  { accent: rgb(0.78, 0.18, 0.28), fill: COLORS.softRose },
];

function safeText(value) {
  return String(value ?? "").trim();
}

function slugify(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function formatCount(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDateTimeLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  return safeText(value);
}

function formatMonthLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
    }).format(date);
  }

  return safeText(value);
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

function drawLineAtTop(page, { x1, x2, topY, thickness = 1, color = COLORS.border }) {
  page.drawLine({
    start: { x: x1, y: PAGE_HEIGHT - topY },
    end: { x: x2, y: PAGE_HEIGHT - topY },
    thickness,
    color,
  });
}

function drawFrameAtTop(page, { x, topY, width, height, borderColor = COLORS.border, borderWidth = 0.75, fillColor }) {
  const drawOptions = {
    x,
    y: PAGE_HEIGHT - topY - height,
    width,
    height,
    borderColor,
    borderWidth,
  };

  if (fillColor) {
    drawOptions.color = fillColor;
  }

  page.drawRectangle(drawOptions);
}

async function loadImage(pdfDoc, url, cache) {
  if (!url) return null;
  if (cache.has(url)) {
    return cache.get(url);
  }

  const promise = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const bytes = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "";
      const lowerUrl = url.toLowerCase();

      if (contentType.includes("png") || lowerUrl.includes(".png")) {
        return await pdfDoc.embedPng(bytes);
      }

      if (
        contentType.includes("jpeg") ||
        contentType.includes("jpg") ||
        lowerUrl.includes(".jpg") ||
        lowerUrl.includes(".jpeg")
      ) {
        return await pdfDoc.embedJpg(bytes);
      }
    } catch {
      return null;
    }

    return null;
  })();

  cache.set(url, promise);
  return promise;
}

function drawPageHeader(page, { fontRegular, fontBold, logoImage, generatedAtLabel, filterLabel }) {
  const titleX = logoImage ? 126 : CONTENT_LEFT;

  if (logoImage) {
    const logoSize = logoImage.scaleToFit(88, 40);
    page.drawImage(logoImage, {
      x: CONTENT_LEFT,
      y: PAGE_HEIGHT - 20 - logoSize.height,
      width: logoSize.width,
      height: logoSize.height,
    });
  }

  drawTextAtTop(page, "RELATÓRIO GERENCIAL DE SST", {
    x: titleX,
    topY: 20,
    size: 15.4,
    font: fontBold,
    color: COLORS.primary,
  });

  drawTextAtTop(page, "Visão consolidada de entregas, consumo e movimentações", {
    x: titleX,
    topY: 34,
    size: 8.2,
    font: fontRegular,
    color: COLORS.muted,
  });

  drawTextAtTop(page, fitText(fontRegular, `Gerado em: ${generatedAtLabel}`, 7.2, CONTENT_WIDTH - (titleX - CONTENT_LEFT)), {
    x: titleX,
    topY: 48,
    size: 7.2,
    font: fontRegular,
    color: COLORS.text,
  });

  drawTextAtTop(page, fitText(fontRegular, `Filtro: ${filterLabel}`, 7.2, CONTENT_WIDTH - (titleX - CONTENT_LEFT)), {
    x: titleX,
    topY: 60,
    size: 7.2,
    font: fontRegular,
    color: COLORS.text,
  });

  drawLineAtTop(page, {
    x1: CONTENT_LEFT,
    x2: CONTENT_RIGHT,
    topY: 76,
    thickness: 0.85,
    color: COLORS.border,
  });
}

function drawSectionTitle(page, title, subtitle, topY, fontRegular, fontBold) {
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: PAGE_HEIGHT - topY - 16,
    width: 4,
    height: 16,
    color: COLORS.primary,
  });

  drawTextAtTop(page, title, {
    x: CONTENT_LEFT + 10,
    topY,
    size: 12.4,
    font: fontBold,
    color: COLORS.text,
  });

  if (subtitle) {
    drawTextAtTop(page, subtitle, {
      x: CONTENT_LEFT + 10,
      topY: topY + 13,
      size: 7.4,
      font: fontRegular,
      color: COLORS.muted,
    });
  }
}

function drawMetricCard(page, { x, topY, width, height, label, value, helper, accentColor, fillColor, fontRegular, fontBold }) {
  drawFrameAtTop(page, {
    x,
    topY,
    width,
    height,
    borderColor: COLORS.border,
    borderWidth: 0.8,
    fillColor: fillColor || COLORS.softGray,
  });

  page.drawRectangle({
    x,
    y: PAGE_HEIGHT - topY - height,
    width: 4.5,
    height,
    color: accentColor || COLORS.primary,
  });

  drawTextAtTop(page, safeText(label), {
    x: x + 14,
    topY: topY + 10,
    size: 7.1,
    font: fontBold,
    color: COLORS.muted,
  });

  drawTextAtTop(page, fitText(fontBold, safeText(value), 17.2, width - 26), {
    x: x + 14,
    topY: topY + 28,
    size: 17.2,
    font: fontBold,
    color: COLORS.text,
  });

  drawWrappedTextAtTop(page, helper, {
    x: x + 14,
    topY: topY + 50,
    width: width - 24,
    size: 7.0,
    font: fontRegular,
    color: COLORS.muted,
    lineGap: 7.8,
  });
}

function drawTableHeader(page, columns, topY, fontBold, height = TABLE_HEADER_HEIGHT) {
  let currentX = CONTENT_LEFT;

  columns.forEach((column) => {
    drawFrameAtTop(page, {
      x: currentX,
      topY,
      width: column.width,
      height,
      fillColor: COLORS.primaryDark,
      borderColor: COLORS.black,
      borderWidth: 0.75,
    });

    const lines = safeText(column.title).split("\n");
    const lineSize = lines.length > 1 ? 5.0 : 5.8;
    const lineGap = lines.length > 1 ? 1.6 : 0;
    const totalTextHeight = lines.length * lineSize + (lines.length - 1) * lineGap;
    const startTopY = topY + Math.max((height - totalTextHeight) / 2, 0.5);

    lines.forEach((line, index) => {
      const lineWidth = fontBold.widthOfTextAtSize(line, lineSize);
      const labelX =
        column.align === "left"
          ? currentX + 4
          : currentX + Math.max((column.width - lineWidth) / 2, 1.5);

      drawTextAtTop(page, line, {
        x: labelX,
        topY: startTopY + index * (lineSize + lineGap),
        size: lineSize,
        font: fontBold,
        color: COLORS.white,
      });
    });

    currentX += column.width;
  });
}

function resolveColumnValue(column, row, index) {
  if (typeof column.value === "function") {
    return column.value(row, index);
  }

  if (column.value !== undefined) {
    return column.value;
  }

  if (column.key) {
    return row?.[column.key];
  }

  return "";
}

function drawTableRows(page, rows, columns, topY, fontRegular, fontBold, { rowHeight = TABLE_ROW_HEIGHT, textSize = TABLE_ROW_TEXT_SIZE, startIndex = 0 } = {}) {
  const columnPositions = [];
  let currentX = CONTENT_LEFT;

  columns.forEach((column) => {
    columnPositions.push(currentX);
    currentX += column.width;
  });

  rows.forEach((row, rowIndex) => {
    const rowTop = topY + rowIndex * rowHeight;
    const fillColor = rowIndex % 2 === 0 ? COLORS.white : COLORS.softGray;

    columns.forEach((column, columnIndex) => {
      const cellX = columnPositions[columnIndex];
      drawFrameAtTop(page, {
        x: cellX,
        topY: rowTop,
        width: column.width,
        height: rowHeight,
        fillColor,
        borderColor: COLORS.border,
        borderWidth: 0.55,
      });

      const resolvedValue = resolveColumnValue(column, row, startIndex + rowIndex);
      const text = fitText(fontRegular, resolvedValue === null || resolvedValue === undefined ? "" : resolvedValue, textSize, column.width - 8);
      const textWidth = fontRegular.widthOfTextAtSize(text, textSize);
      const textX =
        column.align === "center"
          ? cellX + Math.max((column.width - textWidth) / 2, 2)
          : cellX + 4;

      drawTextAtTop(page, text, {
        x: textX,
        topY: rowTop + 5,
        size: textSize,
        font: fontRegular,
        color: COLORS.text,
      });
    });
  });
}

function drawEmptyTableRow(page, columns, topY, fontRegular, message, { rowHeight = TABLE_ROW_HEIGHT, textSize = 7.0 } = {}) {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  drawFrameAtTop(page, {
    x: CONTENT_LEFT,
    topY,
    width: totalWidth,
    height: rowHeight,
    fillColor: COLORS.softGray,
    borderColor: COLORS.border,
    borderWidth: 0.55,
  });

  drawCenteredTextAtTop(page, message, {
    centerX: CONTENT_LEFT + totalWidth / 2,
    topY: topY + 5,
    size: textSize,
    font: fontRegular,
    color: COLORS.muted,
  });
}

function drawTableSectionPage(page, rows, columns, { topY, fontRegular, fontBold, emptyMessage, rowHeight = TABLE_ROW_HEIGHT, headerHeight = TABLE_HEADER_HEIGHT, startIndex = 0 }) {
  drawTableHeader(page, columns, topY, fontBold, headerHeight);

  if (!rows.length) {
    drawEmptyTableRow(page, columns, topY + headerHeight, fontRegular, emptyMessage, {
      rowHeight,
      textSize: 7.0,
    });
    return;
  }

  drawTableRows(page, rows, columns, topY + headerHeight, fontRegular, fontBold, {
    rowHeight,
    textSize: TABLE_ROW_TEXT_SIZE,
    startIndex,
  });
}

function drawPageFooter(page, pageNumber, fontRegular) {
  drawLineAtTop(page, {
    x1: CONTENT_LEFT,
    x2: CONTENT_RIGHT,
    topY: 804,
    thickness: 0.75,
    color: COLORS.border,
  });

  drawTextAtTop(page, "SST EPI - Relatório em PDF", {
    x: CONTENT_LEFT,
    topY: 814,
    size: 6.4,
    font: fontRegular,
    color: COLORS.muted,
  });

  drawTextAtTop(page, `Página ${pageNumber}`, {
    x: CONTENT_RIGHT - 60,
    topY: 814,
    size: 6.4,
    font: fontRegular,
    color: COLORS.muted,
  });
}

function drawInfoBox(page, { topY, title, lines, fontRegular, fontBold, fillColor = COLORS.softBlue }) {
  const height = 56;

  drawFrameAtTop(page, {
    x: CONTENT_LEFT,
    topY,
    width: CONTENT_WIDTH,
    height,
    fillColor,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x: CONTENT_LEFT,
    y: PAGE_HEIGHT - topY - height,
    width: 4,
    height,
    color: COLORS.primary,
  });

  drawTextAtTop(page, safeText(title), {
    x: CONTENT_LEFT + 12,
    topY: topY + 11,
    size: 8.0,
    font: fontBold,
    color: COLORS.primary,
  });

  lines.forEach((line, index) => {
    drawTextAtTop(page, fitText(fontRegular, line, 7.2, CONTENT_WIDTH - 24), {
      x: CONTENT_LEFT + 12,
      topY: topY + 26 + index * 11,
      size: 7.2,
      font: fontRegular,
      color: COLORS.text,
    });
  });
}

function drawPaginatedTableSection({
  pdfDoc,
  initialPage,
  rows,
  columns,
  firstTopY,
  continuationTopY,
  fontRegular,
  fontBold,
  drawContinuationTitle,
  emptyMessage,
  drawPageHeader,
}) {
  let currentPage = initialPage;
  let currentTopY = firstTopY;
  let cursor = 0;

  if (!rows.length) {
    drawTableSectionPage(currentPage, [], columns, {
      topY: currentTopY,
      fontRegular,
      fontBold,
      emptyMessage,
    });
    return;
  }

  while (cursor < rows.length) {
    const rowsFit = Math.max(Math.floor((FOOTER_TOP - currentTopY - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT), 1);
    const chunk = rows.slice(cursor, cursor + rowsFit);

    drawTableSectionPage(currentPage, chunk, columns, {
      topY: currentTopY,
      fontRegular,
      fontBold,
      emptyMessage,
      startIndex: cursor,
    });

    cursor += chunk.length;

    if (cursor < rows.length) {
      currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawPageHeader(currentPage);

      if (drawContinuationTitle) {
        drawContinuationTitle(currentPage);
      }

      currentTopY = continuationTopY;
    }
  }
}

function buildSummaryMetrics({ totals }) {
  return [
    {
      label: "Total de entregas no mês",
      value: formatCount(totals.deliveriesCount),
      helper: "Entregas registradas no período",
      accent: SUMMARY_ACCENTS[0],
    },
    {
      label: "Itens distribuídos",
      value: formatCount(totals.deliveriesQuantity),
      helper: "Soma das quantidades entregues",
      accent: SUMMARY_ACCENTS[1],
    },
    {
      label: "Total de ocorrências",
      value: formatCount(totals.occurrencesCount),
      helper: `Abertas: ${formatCount(totals.openOccurrencesCount)}`,
      accent: SUMMARY_ACCENTS[2],
    },
    {
      label: "Ocorrências em aberto",
      value: formatCount(totals.openOccurrencesCount),
      helper: "Pendências que exigem acompanhamento",
      accent: SUMMARY_ACCENTS[3],
    },
  ];
}

function buildMovementCards(movementSummary) {
  return [
    {
      label: "Entradas no estoque",
      value: formatCount(movementSummary.entriesQuantity),
      helper: `${formatCount(movementSummary.entriesCount)} registros`,
      accent: SUMMARY_ACCENTS[0],
    },
    {
      label: "Saídas por entrega",
      value: formatCount(movementSummary.exitsQuantity),
      helper: `${formatCount(movementSummary.exitsCount)} entregas`,
      accent: SUMMARY_ACCENTS[1],
    },
    {
      label: "Ajustes manuais",
      value: formatCount(movementSummary.adjustmentsCount),
      helper:
        Number(movementSummary.adjustmentsQuantity || 0) !== 0
          ? `${formatCount(movementSummary.adjustmentsQuantity)} unidades informadas`
          : "Nenhum ajuste manual registrado",
      accent: SUMMARY_ACCENTS[2],
    },
  ];
}

function buildTopConsumedColumns() {
  return [
    {
      key: "rank",
      title: "#",
      width: 32,
      align: "center",
      value: (_, index) => `#${index + 1}`,
    },
    {
      key: "itemName",
      title: "EPI",
      width: 220,
      align: "left",
    },
    {
      key: "category",
      title: "Categoria",
      width: 120,
      align: "left",
    },
    {
      key: "quantity",
      title: "Qtd.",
      width: 55,
      align: "center",
      value: (row) => formatCount(row.quantity),
    },
    {
      key: "deliveriesCount",
      title: "Entregas",
      width: 55,
      align: "center",
      value: (row) => formatCount(row.deliveriesCount),
    },
    {
      key: "collaboratorsCount",
      title: "Colabs.",
      width: 65,
      align: "center",
      value: (row) => formatCount(row.collaboratorsCount ?? row.employees?.size ?? 0),
    },
  ];
}

function buildTopSectorColumns() {
  return [
    {
      key: "rank",
      title: "#",
      width: 32,
      align: "center",
      value: (_, index) => `#${index + 1}`,
    },
    {
      key: "sector",
      title: "Setor",
      width: 275,
      align: "left",
    },
    {
      key: "quantity",
      title: "Qtd.",
      width: 75,
      align: "center",
      value: (row) => formatCount(row.quantity),
    },
    {
      key: "deliveriesCount",
      title: "Entregas",
      width: 70,
      align: "center",
      value: (row) => formatCount(row.deliveriesCount),
    },
    {
      key: "collaboratorsCount",
      title: "Colabs.",
      width: 95,
      align: "center",
      value: (row) => formatCount(row.collaboratorsCount ?? row.employees?.size ?? 0),
    },
  ];
}

function buildMovementColumns() {
  return [
    {
      key: "name",
      title: "EPI",
      width: 180,
      align: "left",
    },
    {
      key: "category",
      title: "Categoria",
      width: 120,
      align: "left",
    },
    {
      key: "entriesQuantity",
      title: "Entradas",
      width: 55,
      align: "center",
      value: (row) => formatCount(row.entriesQuantity),
    },
    {
      key: "exitsQuantity",
      title: "Saídas",
      width: 55,
      align: "center",
      value: (row) => formatCount(row.exitsQuantity),
    },
    {
      key: "adjustmentsCount",
      title: "Ajustes",
      width: 55,
      align: "center",
      value: (row) => formatCount(row.adjustmentsCount),
    },
    {
      key: "currentStock",
      title: "Saldo atual",
      width: 82,
      align: "center",
      value: (row) =>
        row.currentStock === null || row.currentStock === undefined ? "N/D" : formatCount(row.currentStock),
    },
  ];
}

function addPageWithHeader(pdfDoc, headerArgs) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawPageHeader(page, headerArgs);
  return page;
}

export function buildReportsPdfFilename({ filterLabel, generatedAt } = {}) {
  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now());
  const datePart = Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
  const filterSlug = slugify(filterLabel);
  const suffix = filterSlug && filterSlug !== "todos-os-colaboradores" ? `-${filterSlug}` : "";

  return `relatorio-sst${suffix}-${datePart}.pdf`;
}

export async function generateReportsPdf({
  generatedAt = new Date(),
  filterLabel = "Todos os colaboradores",
  totals = {},
  movementSummary = {},
  topConsumedEpis = [],
  topSectorConsumption = [],
  movementItems = [],
  logoUrl = "/brand-logo.png",
} = {}) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const imageCache = new Map();
  const logoImage = await loadImage(pdfDoc, logoUrl, imageCache);
  const generatedAtLabel = formatDateTimeLabel(generatedAt);
  const monthLabel = formatMonthLabel(generatedAt);
  const normalizedFilterLabel = safeText(filterLabel) || "Todos os colaboradores";

  const headerArgs = {
    fontRegular,
    fontBold,
    logoImage,
    generatedAtLabel,
    filterLabel: normalizedFilterLabel,
  };

  const summaryCards = buildSummaryMetrics({ totals });

  const page1 = addPageWithHeader(pdfDoc, headerArgs);
  drawSectionTitle(
    page1,
    "Resumo do período",
    "Indicadores consolidados do mês atual.",
    88,
    fontRegular,
    fontBold
  );

  const summaryCardWidth = (CONTENT_WIDTH - 12) / 2;
  const summaryCardHeight = 76;
  const summaryCardTopRows = [120, 204];
  const summaryCardColumns = [CONTENT_LEFT, CONTENT_LEFT + summaryCardWidth + 12];

  summaryCards.forEach((card, index) => {
    drawMetricCard(page1, {
      x: summaryCardColumns[index % 2],
      topY: summaryCardTopRows[Math.floor(index / 2)],
      width: summaryCardWidth,
      height: summaryCardHeight,
      label: card.label,
      value: card.value,
      helper: card.helper,
      accentColor: card.accent.accent,
      fillColor: card.accent.fill,
      fontRegular,
      fontBold,
    });
  });

  drawInfoBox(page1, {
    topY: 296,
    title: "Observações do relatório",
    lines: [`Período analisado: ${monthLabel}`, `Filtro aplicado: ${normalizedFilterLabel}`],
    fontRegular,
    fontBold,
  });

  const page2 = addPageWithHeader(pdfDoc, headerArgs);
  drawSectionTitle(
    page2,
    "Top 10 EPIs mais consumidos",
    "Ranking calculado com base nas entregas filtradas.",
    88,
    fontRegular,
    fontBold
  );

  drawTableSectionPage(page2, topConsumedEpis, buildTopConsumedColumns(), {
    topY: 120,
    fontRegular,
    fontBold,
    emptyMessage: "Nenhuma entrega registrada ainda.",
  });

  drawSectionTitle(
    page2,
    "Setores com maior consumo",
    "Quantidade total entregue por setor.",
    332,
    fontRegular,
    fontBold
  );

  drawTableSectionPage(page2, topSectorConsumption, buildTopSectorColumns(), {
    topY: 364,
    fontRegular,
    fontBold,
    emptyMessage: "Nenhuma entrega registrada ainda.",
  });

  const page3 = addPageWithHeader(pdfDoc, headerArgs);
  drawSectionTitle(
    page3,
    "Relatório de movimentações",
    "Entradas no estoque, saídas por entrega e ajustes manuais.",
    88,
    fontRegular,
    fontBold
  );

  const movementCards = buildMovementCards(movementSummary);
  const movementCardWidth = (CONTENT_WIDTH - 24) / 3;
  const movementCardHeight = 76;

  movementCards.forEach((card, index) => {
    drawMetricCard(page3, {
      x: CONTENT_LEFT + index * (movementCardWidth + 12),
      topY: 120,
      width: movementCardWidth,
      height: movementCardHeight,
      label: card.label,
      value: card.value,
      helper: card.helper,
      accentColor: card.accent.accent,
      fillColor: card.accent.fill,
      fontRegular,
      fontBold,
    });
  });

  drawTextAtTop(page3, "O histórico por item consolida saldos, entradas, saídas e ajustes do estoque.", {
    x: CONTENT_LEFT,
    topY: 206,
    size: 7.2,
    font: fontRegular,
    color: COLORS.muted,
  });

  drawSectionTitle(
    page3,
    "Histórico por item",
    "Saldo atual e fluxo consolidado por EPI.",
    220,
    fontRegular,
    fontBold
  );

  drawPaginatedTableSection({
    pdfDoc,
    initialPage: page3,
    rows: movementItems,
    columns: buildMovementColumns(),
    firstTopY: 250,
    continuationTopY: 118,
    fontRegular,
    fontBold,
    emptyMessage: "Nenhum movimento registrado ainda.",
    drawPageHeader: (page) => drawPageHeader(page, headerArgs),
    drawContinuationTitle: (page) =>
      drawSectionTitle(
        page,
        "Histórico por item (continuação)",
        "Saldo atual e fluxo consolidado por EPI.",
        88,
        fontRegular,
        fontBold
      ),
  });

  pdfDoc.getPages().forEach((page, index) => {
    drawPageFooter(page, index + 1, fontRegular);
  });

  return pdfDoc.save();
}
