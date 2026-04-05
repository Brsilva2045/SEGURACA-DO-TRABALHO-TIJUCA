const REVERSE_GEOCODING_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

function safeText(value) {
  return String(value || "").trim();
}

function normalizeLookupText(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isRegionalDescriptor(value) {
  const normalized = normalizeLookupText(value);

  return (
    normalized.includes("regiao metropolitana") ||
    normalized.includes("regiao geografica") ||
    normalized.includes("mesorregiao") ||
    normalized.includes("microrregiao") ||
    normalized.includes("intermediaria") ||
    normalized.includes("imediata")
  );
}

function dedupeText(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const text = safeText(value);
    if (!text) continue;

    const normalized = normalizeLookupText(text);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(text);
  }

  return result;
}

function resolveAdministrativeAreas(data) {
  return Array.isArray(data?.localityInfo?.administrative) ? data.localityInfo.administrative : [];
}

function resolveCityName(data) {
  const administrative = resolveAdministrativeAreas(data);
  const administrativeCity = administrative
    .filter((item) => {
      const adminLevel = Number(item?.adminLevel);
      return Number.isFinite(adminLevel) && adminLevel >= 8 && adminLevel <= 10;
    })
    .map((item) => safeText(item?.name))
    .find((value) => value && !isRegionalDescriptor(value));

  const rawCity = safeText(data?.city);
  const rawLocality = safeText(data?.locality);

  if (administrativeCity) {
    return administrativeCity;
  }

  if (rawCity && !isRegionalDescriptor(rawCity)) {
    return rawCity;
  }

  if (rawLocality && !isRegionalDescriptor(rawLocality)) {
    return rawLocality;
  }

  return rawCity || rawLocality;
}

function resolveNeighborhoodName(data, city, state, country) {
  const excluded = new Set(
    dedupeText([city, state, country]).map((value) => normalizeLookupText(value))
  );
  const rawLocality = safeText(data?.locality);

  if (rawLocality) {
    const normalizedLocality = normalizeLookupText(rawLocality);
    if (!excluded.has(normalizedLocality) && !isRegionalDescriptor(rawLocality)) {
      return rawLocality;
    }
  }

  const administrative = resolveAdministrativeAreas(data);

  return (
    administrative
      .filter((item) => Number(item?.adminLevel) >= 9)
      .map((item) => safeText(item?.name))
      .find((value) => {
        if (!value || isRegionalDescriptor(value)) return false;
        return !excluded.has(normalizeLookupText(value));
      }) || ""
  );
}

function buildLocationLabel({ neighborhood, city, state, country }) {
  const primary = dedupeText([neighborhood, city]);
  if (primary.length > 0) {
    return primary.join(", ");
  }

  const secondary = dedupeText([city, state]);
  if (secondary.length > 1) {
    return `${secondary[0]} - ${secondary[1]}`;
  }

  return secondary[0] || safeText(country);
}

function extractAddressSource(geoLocation) {
  if (!geoLocation || typeof geoLocation !== "object") {
    return {};
  }

  if (geoLocation.address && typeof geoLocation.address === "object" && !Array.isArray(geoLocation.address)) {
    return geoLocation.address;
  }

  return geoLocation;
}

export function formatGeoCoordinates(geoLocation) {
  const latitude = Number(geoLocation?.latitude);
  const longitude = Number(geoLocation?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "";
  }

  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function getGeoLocationPlaceLabel(geoLocation) {
  const address = extractAddressSource(geoLocation);
  const explicitLabel = safeText(
    address.displayName || address.fullDisplayName || address.label || geoLocation?.locationLabel
  );

  if (explicitLabel) {
    return explicitLabel;
  }

  const neighborhood = safeText(address.neighborhood || address.suburb || address.district);
  const city = safeText(address.city);
  const state = safeText(address.state || address.principalSubdivision);
  const country = safeText(address.country || address.countryName);

  return buildLocationLabel({ neighborhood, city, state, country });
}

export function formatGeoLocationSummary(
  geoLocation,
  {
    includeAccuracy = true,
    emptyText = "",
    notCapturedText = "não capturada",
    capturedText = "capturada",
    uppercase = false,
    preferReason = true,
  } = {}
) {
  if (!geoLocation || typeof geoLocation !== "object") {
    return uppercase ? safeText(emptyText).toUpperCase() : safeText(emptyText);
  }

  if (geoLocation.status !== "captured") {
    const fallback = preferReason ? safeText(geoLocation.reason) : "";
    const text = fallback || notCapturedText;
    return uppercase ? text.toUpperCase() : text;
  }

  const mainText = getGeoLocationPlaceLabel(geoLocation) || formatGeoCoordinates(geoLocation) || capturedText;
  const accuracy = Number(geoLocation.accuracy);
  const accuracyText =
    includeAccuracy && Number.isFinite(accuracy) && accuracy > 0
      ? ` • precisão ${Math.round(accuracy)} m`
      : "";
  const summary = `${mainText}${accuracyText}`;

  return uppercase ? summary.toUpperCase() : summary;
}

function mapReverseGeocodeData(data) {
  const city = resolveCityName(data);
  const state = safeText(data?.principalSubdivision);
  const country = safeText(data?.countryName);
  const neighborhood = resolveNeighborhoodName(data, city, state, country);
  const displayName = buildLocationLabel({ neighborhood, city, state, country });

  if (!displayName) {
    return null;
  }

  return {
    neighborhood,
    city,
    state,
    country,
    displayName,
    fullDisplayName: dedupeText([neighborhood, city, state, country]).join(", "),
    provider: "bigdatacloud",
    resolvedAt: new Date().toISOString(),
  };
}

export async function reverseGeocodeCoordinates(latitude, longitude, { timeoutMs = 4000 } = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const url = new URL(REVERSE_GEOCODING_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", "pt");

  let controller = null;
  let timeoutId = null;

  try {
    if (typeof AbortController === "function") {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller?.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return mapReverseGeocodeData(data);
  } catch {
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function enrichGeoLocationWithAddress(geoLocation, options) {
  if (!geoLocation || typeof geoLocation !== "object" || geoLocation.status !== "captured") {
    return geoLocation;
  }

  if (getGeoLocationPlaceLabel(geoLocation)) {
    return geoLocation;
  }

  const address = await reverseGeocodeCoordinates(geoLocation.latitude, geoLocation.longitude, options);

  if (!address) {
    return geoLocation;
  }

  return {
    ...geoLocation,
    address,
    locationLabel: address.displayName,
  };
}
