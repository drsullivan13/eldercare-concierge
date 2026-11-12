/** Server-side collectors. Only CMS data may enter the durable evidence store. */
export type CollectionOutcome = {
  status: "succeeded" | "unchanged" | "retry" | "blocked" | "failed";
  http_status?: number;
  error_code?: string;
  source_url?: string;
  retry_after_seconds?: number;
  snapshot?: {
    sha256: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  candidates?: {
    kind: "cms-metadata" | "cms-survey" | "cms-clinical";
    summary: string;
    data: Record<string, unknown>;
  }[];
  listing_id?: string;
  listing_url?: string;
  capabilities?: Partial<
    Record<
      "business_match" | "business_details" | "reviews",
      | "available"
      | "unauthorized"
      | "forbidden"
      | "rate_limited"
      | "not_found"
      | "unknown"
    >
  >;
};
export type Fetcher = typeof fetch;
export type ProviderIdentity = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string | null;
};
const CMS_DATASETS = new Set([
  "4pq5-n9py",
  "ccn4-8vby",
  "6jpm-sxkc",
  "c886-nwpj",
  "fa88-6ff2",
]);
const MAX_RESPONSE_BYTES = 1_000_000;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Parsing is not authorization; the database must atomically consume this ticket. */
export async function workerTicketHash(
  header: string | null,
): Promise<string | null> {
  if (!header?.match(/^Bearer [a-f0-9]{64}$/)) return null;
  return sha256(header.slice(7));
}
function retryDelay(value: string | null): number {
  const number = value && /^\d+$/.test(value) ? Number(value) : NaN;
  const seconds = Number.isFinite(number)
    ? number
    : value
      ? (Date.parse(value) - Date.now()) / 1000
      : 300;
  return Math.min(
    86400,
    Math.max(60, Math.ceil(Number.isFinite(seconds) ? seconds : 300)),
  );
}
type JsonResponse =
  | { ok: true; value: unknown; text: string; status: number }
  | { ok: false; outcome: CollectionOutcome };
async function requestJson(
  url: URL,
  fetcher: Fetcher,
  headers: HeadersInit = {},
): Promise<JsonResponse> {
  // URLs are built below from fixed origins; redirects must not forward credentials.
  if (
    !["data.cms.gov", "api.yelp.com"].includes(url.hostname) ||
    url.protocol !== "https:"
  )
    return {
      ok: false,
      outcome: { status: "failed", error_code: "SOURCE_URL_NOT_ALLOWED" },
    };
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "HarborResearch/0.1 (+https://github.com/drsullivan13/eldercare-concierge)",
        ...headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const base = {
        http_status: response.status,
        source_url:
          url.hostname === "api.yelp.com"
            ? `${url.origin}${url.pathname}`
            : url.toString(),
      };
      if ([401, 403].includes(response.status))
        return {
          ok: false,
          outcome: {
            ...base,
            status: "blocked",
            error_code:
              response.status === 401
                ? "SOURCE_UNAUTHORIZED"
                : "SOURCE_FORBIDDEN",
          },
        };
      if (response.status === 429 || response.status >= 500)
        return {
          ok: false,
          outcome: {
            ...base,
            status: "retry",
            error_code:
              response.status === 429
                ? "SOURCE_RATE_LIMITED"
                : "SOURCE_SERVER_ERROR",
            retry_after_seconds: retryDelay(
              response.headers.get("retry-after"),
            ),
          },
        };
      return {
        ok: false,
        outcome: {
          ...base,
          status: "failed",
          error_code:
            response.status === 404
              ? "SOURCE_NOT_FOUND"
              : "SOURCE_REQUEST_REJECTED",
        },
      };
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return {
        ok: false,
        outcome: { status: "failed", error_code: "SOURCE_RESPONSE_TOO_LARGE" },
      };
    }
    const reader = response.body?.getReader();
    if (!reader)
      return {
        ok: false,
        outcome: { status: "failed", error_code: "SOURCE_EMPTY_BODY" },
      };
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          outcome: {
            status: "failed",
            error_code: "SOURCE_RESPONSE_TOO_LARGE",
          },
        };
      }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(buffer);
    try {
      return {
        ok: true,
        value: JSON.parse(text),
        text,
        status: response.status,
      };
    } catch {
      return {
        ok: false,
        outcome: { status: "failed", error_code: "SOURCE_INVALID_JSON" },
      };
    }
  } catch {
    // Never return/log exception messages, request headers or remote response bodies.
    return {
      ok: false,
      outcome: {
        status: "retry",
        error_code: "SOURCE_NETWORK_ERROR",
        retry_after_seconds: 300,
      },
    };
  }
}

export async function collectCms(
  config: Record<string, unknown>,
  previousHash: string | null,
  fetcher: Fetcher = fetch,
): Promise<CollectionOutcome> {
  const dataset = typeof config.dataset === "string" ? config.dataset : "";
  const mode = config.mode;
  if (
    !CMS_DATASETS.has(dataset) ||
    !["metadata", "record", "periods"].includes(String(mode))
  )
    return { status: "failed", error_code: "CMS_CONFIG_INVALID" };
  if (
    mode === "record" &&
    (!/^[0-9]{6}$/.test(String(config.ccn)) ||
      !["ccn4-8vby", "6jpm-sxkc"].includes(dataset))
  )
    return { status: "failed", error_code: "CMS_CCN_INVALID" };
  if (mode === "periods" && !["c886-nwpj", "fa88-6ff2"].includes(dataset))
    return { status: "failed", error_code: "CMS_CONFIG_INVALID" };
  const url = new URL(
    mode === "metadata"
      ? `https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/${dataset}`
      : `https://data.cms.gov/provider-data/api/1/datastore/query/${dataset}/0`,
  );
  if (mode !== "metadata") {
    url.searchParams.set("limit", mode === "record" ? "2" : "100");
    if (mode === "record") {
      url.searchParams.set(
        "conditions[0][property]",
        "cms_certification_number_ccn",
      );
      url.searchParams.set("conditions[0][value]", String(config.ccn));
      url.searchParams.set("conditions[0][operator]", "=");
    }
  }
  const result = await requestJson(url, fetcher);
  if (!result.ok) return result.outcome;
  const body = result.value;
  if (!object(body))
    return { status: "failed", error_code: "CMS_SCHEMA_CHANGED" };
  if (
    mode === "metadata" &&
    (body.identifier !== dataset || typeof body.title !== "string")
  )
    return { status: "failed", error_code: "CMS_DATASET_MISMATCH" };
  if (
    mode !== "metadata" &&
    (!Array.isArray(body.results) || !object(body.schema))
  )
    return { status: "failed", error_code: "CMS_SCHEMA_CHANGED" };
  const rows = mode === "metadata" ? [] : (body.results as unknown[]);
  if (
    mode === "record" &&
    (rows.length !== 1 ||
      !object(rows[0]) ||
      rows[0].cms_certification_number_ccn !== config.ccn)
  )
    return { status: "blocked", error_code: "CMS_IDENTITY_REVIEW_REQUIRED" };
  if (mode === "periods" && (!rows.length || Number(body.count) > rows.length))
    return { status: "blocked", error_code: "CMS_PERIOD_COVERAGE_INCOMPLETE" };
  const hash = await sha256(result.text);
  if (hash === previousHash)
    return {
      status: "unchanged",
      http_status: result.status,
      source_url: url.toString(),
    };
  const kind =
    mode === "record"
      ? dataset === "ccn4-8vby"
        ? "cms-survey"
        : "cms-clinical"
      : "cms-metadata";
  return {
    status: "succeeded",
    http_status: result.status,
    source_url: url.toString(),
    snapshot: {
      sha256: hash,
      content: result.text,
      metadata: {
        dataset,
        mode,
        ccn: config.ccn ?? null,
        released: body.released ?? null,
        modified: body.modified ?? null,
      },
    },
    candidates: [
      {
        kind,
        summary:
          mode === "record"
            ? `Review CMS ${dataset} evidence for CCN ${config.ccn}.`
            : `Review CMS ${dataset} ${mode} source change.`,
        data: {
          dataset,
          mode,
          ccn: config.ccn ?? null,
          sourceUrl: url.toString(),
          snapshotHash: hash,
        },
      },
    ],
  };
}

function normalized(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    : "";
}
function street(value: unknown): string {
  return typeof value === "string"
    ? normalized(
        value.replace(
          /\b(street|road|avenue|drive|boulevard|lane|court|place)\b/gi,
          (s) =>
            ({
              street: "st",
              road: "rd",
              avenue: "ave",
              drive: "dr",
              boulevard: "blvd",
              lane: "ln",
              court: "ct",
              place: "pl",
            })[s.toLowerCase()]!,
        ),
      )
    : "";
}
function streetAddress(provider: ProviderIdentity): string {
  // Some catalog addresses include their town/state/ZIP. Remove only that exact
  // known suffix; never infer a different street, town or care unit.
  const suffix = `, ${provider.city}, ${provider.state} ${provider.zip}`;
  return provider.address.toLowerCase().endsWith(suffix.toLowerCase())
    ? provider.address.slice(0, -suffix.length).trim()
    : provider.address;
}
/** Deliberately conservative. A match is a listing identity, never a care-quality validation. */
export function exactYelpListing(
  value: unknown,
  provider: ProviderIdentity,
): { id: string } | null {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(value.id) ||
    !object(value.location)
  )
    return null;
  const location = value.location;
  if (!provider.address || !provider.name || !provider.city || !provider.zip)
    return null;
  if (
    normalized(value.name) !== normalized(provider.name) ||
    street(location.address1) !== street(streetAddress(provider)) ||
    normalized(location.city) !== normalized(provider.city) ||
    location.state !== provider.state ||
    String(location.zip_code).slice(0, 5) !== provider.zip ||
    location.country !== "US"
  )
    return null;
  return { id: value.id };
}
function capability(
  status: number,
):
  | "available"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "unknown" {
  return status >= 200 && status < 300
    ? "available"
    : status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status === 429
          ? "rate_limited"
          : status === 404
            ? "not_found"
            : "unknown";
}

export async function collectYelpIdentifiers(
  provider: ProviderIdentity,
  apiKey: string | undefined,
  reserveRequest: () => Promise<boolean>,
  fetcher: Fetcher = fetch,
): Promise<CollectionOutcome> {
  if (!apiKey?.trim())
    return { status: "blocked", error_code: "YELP_KEY_NOT_CONFIGURED" };
  const address = streetAddress(provider);
  if (
    ![provider.name, address, provider.city].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 64,
    ) ||
    !/^[A-Z]{2}$/.test(provider.state) ||
    !/^\d{5}$/.test(provider.zip)
  )
    return { status: "blocked", error_code: "YELP_IDENTITY_INPUT_REVIEW" };
  const url = new URL("https://api.yelp.com/v3/businesses/matches");
  for (const [key, value] of Object.entries({
    name: provider.name,
    address1: address,
    city: provider.city,
    state: provider.state,
    postal_code: provider.zip,
    country: "US",
    match_threshold: "strict",
  }))
    url.searchParams.set(key, value);
  if (!(await reserveRequest()))
    return {
      status: "retry",
      error_code: "YELP_DAILY_BUDGET_REACHED",
      retry_after_seconds: 86400,
    };
  const result = await requestJson(url, fetcher, {
    Authorization: `Bearer ${apiKey}`,
  });
  if (!result.ok)
    return {
      ...result.outcome,
      capabilities: {
        business_match: capability(result.outcome.http_status || 0),
      },
    };
  if (!object(result.value) || !Array.isArray(result.value.businesses))
    return { status: "failed", error_code: "YELP_SCHEMA_CHANGED" };
  const matches = new Map<string, { id: string }>();
  for (const candidate of result.value.businesses) {
    const match = exactYelpListing(candidate, provider);
    if (match) matches.set(match.id, match);
  }
  if (matches.size !== 1)
    return {
      status: "blocked",
      error_code: matches.size
        ? "YELP_MULTIPLE_EXACT_MATCHES"
        : result.value.businesses.length
          ? "YELP_MATCH_REVIEW_REQUIRED"
          : "YELP_NO_LISTING_RETURNED",
      capabilities: { business_match: "available" },
    };
  const { id } = [...matches.values()][0];
  const output: CollectionOutcome = {
    status: "succeeded",
    listing_id: id,
    listing_url: `https://www.yelp.com/biz/${id}`,
    capabilities: {
      business_match: "available",
      business_details: "unknown",
      reviews: "unknown",
    },
  };
  for (const [endpoint, key] of [
    [`/v3/businesses/${id}`, "business_details"],
    [`/v3/businesses/${id}/reviews`, "reviews"],
  ] as const) {
    if (!(await reserveRequest())) {
      output.error_code = "YELP_CAPABILITY_CHECK_BUDGET_REACHED";
      break;
    }
    const probe = await requestJson(
      new URL(`https://api.yelp.com${endpoint}`),
      fetcher,
      { Authorization: `Bearer ${apiKey}` },
    );
    output.capabilities![key] = capability(
      probe.ok ? probe.status : probe.outcome.http_status || 0,
    );
    // Discard response text, ratings, reviewer identities and excerpts. Standard Places
    // permission is not a license for durable analytics or Harbor's experience score.
    if (!probe.ok) {
      output.error_code =
        key === "reviews"
          ? "YELP_REVIEWS_NOT_AVAILABLE"
          : "YELP_DETAILS_NOT_AVAILABLE";
      if (
        probe.outcome.http_status === 429 ||
        probe.outcome.http_status === 401
      )
        break;
    }
  }
  return output;
}
