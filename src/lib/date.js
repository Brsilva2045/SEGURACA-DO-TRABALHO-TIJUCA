const APP_TIME_ZONE = "America/Sao_Paulo";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function coerceDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return null;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatDateTimePtBr(value = new Date()) {
  const date = coerceDate(value);
  if (!date) {
    return String(value ?? "").trim();
  }

  return DATE_TIME_FORMATTER.format(date);
}

export function isIsoDateTimeString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(value.trim());
}
