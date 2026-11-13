export type LocationDescription = {
  providerId: string;
  summary: string;
  scope: "facility" | "campus" | "agency-office" | "service-area";
  basis: "provider" | "official-listing";
  sources: {
    url: string;
    publisher: string;
    title: string;
    checkedAt: string;
  }[];
  limitations: string[];
};

export type LocationDescriptionResponse = LocationDescription & {
  schemaVersion: 1;
  marketId: "north-jersey";
  checkedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function isSource(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isText(value.url) ||
    !isText(value.publisher) ||
    !isText(value.title) ||
    !isDate(value.checkedAt)
  )
    return false;
  try {
    const url = new URL(value.url);
    return (
      url.protocol === "https:" &&
      url.hostname.includes(".") &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.endsWith(".local") &&
      !url.hostname.endsWith(".internal") &&
      !url.username &&
      !url.password &&
      !["token", "access_token", "api_key", "password", "secret"].some((key) =>
        url.searchParams.has(key),
      )
    );
  } catch {
    return false;
  }
}

export function isLocationDescriptionResponse(
  value: unknown,
  providerId: string,
): value is LocationDescriptionResponse {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.marketId === "north-jersey" &&
    isDate(value.checkedAt) &&
    value.providerId === providerId &&
    isText(value.summary) &&
    typeof value.scope === "string" &&
    ["facility", "campus", "agency-office", "service-area"].includes(
      value.scope,
    ) &&
    typeof value.basis === "string" &&
    ["provider", "official-listing"].includes(value.basis) &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.every(isSource) &&
    Array.isArray(value.limitations) &&
    value.limitations.every(isText)
  );
}
