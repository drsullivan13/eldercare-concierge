import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const OBSERVATION_COLUMNS = [
  "observation_id",
  "run_id",
  "provider_id",
  "candidate_provider_name",
  "match_status",
  "match_reason",
  "source_url",
  "thread_url",
  "source_visibility",
  "retrieved_at_utc",
  "posted_at",
  "experience_period",
  "relationship",
  "account_type",
  "care_level",
  "experience_stage",
  "themes",
  "sentiment",
  "summary",
  "supporting_public_excerpt",
  "concern_type",
  "duplicate_of",
  "independence_notes",
  "use_status",
  "needs_human_review",
] as const;
export const COVERAGE_COLUMNS = [
  "run_id",
  "provider_id",
  "searched_at_utc",
  "queries_used",
  "sources_checked",
  "status",
  "observations_found",
  "access_limits",
  "coverage_notes",
] as const;
const THEMES = [
  "communication",
  "staff_responsiveness",
  "staff_continuity",
  "respect_and_dignity",
  "personal_care",
  "medication_coordination",
  "dining",
  "cleanliness",
  "activities",
  "billing",
  "admission_transition",
  "discharge_followup",
  "family_access",
  "transport",
  "other",
];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
type Row = Record<string, string>;
export type ImportIssue = {
  file: "observations" | "coverage" | "batch";
  row: number | null;
  field: string | null;
  code: string;
  message: string;
};
export type StagedObservation = {
  id: string;
  sourceKey: string;
  contentHash: string;
  inputObservationId: string;
  runId: string;
  providerId: string | null;
  candidateProviderName: string | null;
  matchStatus: string;
  matchReason: string;
  sourceUrl: string | null;
  threadUrl: string | null;
  sourceVisibility: "public";
  retrievedAtUtc: string;
  postedAt: string | null;
  experiencePeriod: string | null;
  relationship: string;
  relationshipVerification: "self-described-or-unknown-not-independently-verified";
  accountType: string;
  careLevel: string;
  experienceStage: string;
  themes: string[];
  sentiment: string;
  summary: string;
  supportingPublicExcerpt: string | null;
  concernType: string;
  duplicateOf: string | null;
  duplicateCandidateIds: string[];
  /** Shared-source/thread/text groups; candidates are capped in each row, groups preserve full membership. */
  duplicateGroupIds: string[];
  independenceNotes: string;
  useStatus: "internal_review_pending";
  needsHumanReview: true;
  reportedNeedsHumanReview: boolean;
  scoreEligible: false;
  publishable: false;
  reviewReasons: string[];
};
export type StagedCoverage = {
  id: string;
  runId: string;
  providerId: string;
  searchedAtUtc: string | null;
  queriesUsed: string[];
  sourcesChecked: string[];
  status: string;
  observationsFound: number;
  exactMatchedRows: number;
  accessLimits: string | null;
  coverageNotes: string | null;
};
export type ResearchImportStaging = {
  schemaVersion: "harbor-research-import/1";
  batchId: string;
  runId: string;
  publicationState: "internal_review_pending";
  scoreEligible: false;
  observations: StagedObservation[];
  coverage: StagedCoverage[];
  duplicateGroups: { id: string; reason: string; observationIds: string[] }[];
  reviewQueue: {
    observationId: string;
    priority: "priority" | "normal";
    reasons: string[];
  }[];
  limitations: string[];
};
export type ResearchImportResult = {
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: {
    inputObservations: number;
    coverageRows: number;
    restrictedRowsRejected: number;
    catalogProviders: number;
  };
  staging: ResearchImportStaging | null;
};
export class CsvValidationError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = "CsvValidationError";
  }
}

/** RFC-style quoted cells, escaped quotes, embedded newlines, CRLF/LF; no evaluation or coercion. */
export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES)
    throw new CsvValidationError(1, "CSV exceeds the 10 MiB limit.");
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))
    throw new CsvValidationError(
      1,
      "CSV contains disallowed control characters.",
    );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false,
    closed = false,
    line = 1;
  const pushCell = () => {
    if (cell.length > 12000)
      throw new CsvValidationError(line, "CSV cell exceeds 12,000 characters.");
    row.push(cell);
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1)
      throw new CsvValidationError(line, "CSV exceeds 10,000 data rows.");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (ch === "\r") {
        if (text[i + 1] !== "\n")
          throw new CsvValidationError(
            line,
            "Bare carriage returns are not supported.",
          );
        cell += "\n";
        i++;
        line++;
      } else {
        cell += ch;
        if (ch === "\n") line++;
      }
      continue;
    }
    if (closed && ![",", "\r", "\n"].includes(ch))
      throw new CsvValidationError(
        line,
        "Unexpected text after a closing quote.",
      );
    if (ch === '"') {
      if (cell.length)
        throw new CsvValidationError(
          line,
          "A quote must start a cell or be escaped inside a quoted cell.",
        );
      quoted = true;
    } else if (ch === ",") pushCell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r") {
        if (text[i + 1] !== "\n")
          throw new CsvValidationError(
            line,
            "Bare carriage returns are not supported.",
          );
        i++;
      }
      pushRow();
      line++;
    } else cell += ch;
  }
  if (quoted) throw new CsvValidationError(line, "Unclosed quoted CSV cell.");
  if (cell.length || row.length || closed) pushRow();
  return rows;
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
function isoDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
function isoUtc(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !isoDate(value.slice(0, 10))
  )
    return false;
  const n = Date.parse(value);
  return (
    Number.isFinite(n) &&
    new Date(n).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function publicUrl(value: string): string | null {
  if (!value || value.length > 2048 || /[\s\u0000-\u001F\u007F]/.test(value))
    return null;
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      !u.hostname.includes(".") ||
      isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
/** Keep identity query parameters (e.g. Facebook comment_id); remove only known tracking. */
function identityUrl(value: string | null) {
  if (!value) return null;
  const u = new URL(value);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}

export function validateResearchImport(input: {
  observationsCsv: string;
  coverageCsv: string;
  catalogProviderIds: readonly string[];
  asOfUtc: string;
  assignedProviderIds?: readonly string[];
}): ResearchImportResult {
  const errors: ImportIssue[] = [],
    warnings: ImportIssue[] = [];
  const issue = (
    file: ImportIssue["file"],
    row: number | null,
    field: string | null,
    code: string,
    message: string,
  ) => errors.push({ file, row, field, code, message });
  const warn = (
    file: ImportIssue["file"],
    row: number | null,
    field: string | null,
    code: string,
    message: string,
  ) => warnings.push({ file, row, field, code, message });
  const catalog = new Set(input.catalogProviderIds);
  if (
    catalog.size !== input.catalogProviderIds.length ||
    !catalog.size ||
    input.catalogProviderIds.some((id) => !ID.test(id))
  )
    issue(
      "batch",
      null,
      "catalogProviderIds",
      "catalog_invalid",
      "Catalog IDs must be unique, nonempty identifiers.",
    );
  if (!isoUtc(input.asOfUtc))
    issue(
      "batch",
      null,
      "asOfUtc",
      "date_invalid",
      "Assessment time must be a valid UTC ISO timestamp ending in Z.",
    );
  const table = (
    csv: string,
    columns: readonly string[],
    file: "observations" | "coverage",
  ): Row[] => {
    let data: string[][];
    try {
      data = parseCsv(csv);
    } catch (e) {
      issue(
        file,
        e instanceof CsvValidationError ? e.line : null,
        null,
        "csv_invalid",
        e instanceof CsvValidationError ? e.message : "CSV cannot be parsed.",
      );
      return [];
    }
    const header = data.shift();
    if (
      !header ||
      header.length !== columns.length ||
      new Set(header).size !== header.length ||
      !columns.every((c) => header.includes(c))
    ) {
      issue(
        file,
        1,
        null,
        "headers_invalid",
        "Use exactly the supplied template columns, without duplicate or extra headers.",
      );
      return [];
    }
    return data.flatMap((cells, index) => {
      if (cells.length !== header.length) {
        issue(
          file,
          index + 2,
          null,
          "width_invalid",
          "CSV row has the wrong number of fields.",
        );
        return [];
      }
      return [Object.fromEntries(header.map((key, i) => [key, cells[i]]))];
    });
  };
  const observations = table(
    input.observationsCsv,
    OBSERVATION_COLUMNS,
    "observations",
  );
  const coverageRows = table(input.coverageCsv, COVERAGE_COLUMNS, "coverage");
  const staged: StagedObservation[] = [],
    coverage: StagedCoverage[] = [];
  let restrictedRowsRejected = 0;
  const runIds = new Set<string>();
  const rawIds = new Map<string, StagedObservation>();
  const rawDuplicates = new Map<string, string>();
  const quoteTotals = new Map<string, number>();
  const check = (file: "observations" | "coverage", row: number) => ({
    text(value: string, field: string, max: number, required = false) {
      if (value.length > max || (required && !value.trim()))
        issue(
          file,
          row,
          field,
          "text_invalid",
          `Field must ${required ? "be nonempty and " : ""}contain at most ${max} characters.`,
        );
      return value.trim();
    },
    enum(value: string, field: string, allowed: readonly string[]) {
      if (!allowed.includes(value))
        issue(
          file,
          row,
          field,
          "enum_invalid",
          "Field is not an allowed protocol value.",
        );
    },
    time(value: string, field: string, optional = false) {
      if (optional && !value) return;
      if (!isoUtc(value) || Date.parse(value) > Date.parse(input.asOfUtc))
        issue(
          file,
          row,
          field,
          "date_invalid",
          "Use a valid, non-future UTC ISO timestamp ending in Z.",
        );
    },
    array(value: string, field: string, allowed?: readonly string[]) {
      if (!value) return [];
      try {
        const parsed: unknown = JSON.parse(value);
        if (
          !Array.isArray(parsed) ||
          parsed.length > 50 ||
          parsed.some(
            (v) =>
              typeof v !== "string" ||
              !v.trim() ||
              v.length > 500 ||
              (allowed && !allowed.includes(v)),
          ) ||
          new Set(parsed).size !== parsed.length
        )
          throw new Error();
        return parsed as string[];
      } catch {
        issue(
          file,
          row,
          field,
          "array_invalid",
          "Use a JSON array of up to 50 distinct, bounded strings from the permitted vocabulary.",
        );
        return [];
      }
    },
  });
  observations.forEach((r, index) => {
    const row = index + 2,
      c = check("observations", row),
      before = errors.length;
    // Do not normalize, quote, log or persist the contents of a restricted row.
    if (
      r.source_visibility !== "public" ||
      r.use_status === "restricted_no_publication"
    ) {
      restrictedRowsRejected++;
      issue(
        "observations",
        row,
        "source_visibility",
        "restricted_rejected",
        "This importer has no authorized restricted-content store. Remove restricted content and retain only a coverage access limitation.",
      );
      return;
    }
    for (const field of ["run_id", "observation_id"])
      if (!ID.test(r[field]))
        issue(
          "observations",
          row,
          field,
          "id_invalid",
          "Use a bounded local identifier without personal profile information.",
        );
    runIds.add(r.run_id);
    if (rawIds.has(r.observation_id) || rawDuplicates.has(r.observation_id))
      issue(
        "observations",
        row,
        "observation_id",
        "duplicate_input_id",
        "Observation IDs must be unique within the run.",
      );
    rawDuplicates.set(r.observation_id, r.duplicate_of);
    c.enum(r.match_status, "match_status", ["exact", "probable", "unresolved"]);
    if (r.match_status === "exact") {
      if (!catalog.has(r.provider_id))
        issue(
          "observations",
          row,
          "provider_id",
          "provider_invalid",
          "Exact matches require an unchanged catalog provider ID.",
        );
    } else if (r.provider_id)
      issue(
        "observations",
        row,
        "provider_id",
        "ambiguous_assignment",
        "Probable/unresolved matches must leave provider_id blank.",
      );
    const candidate = c.text(
      r.candidate_provider_name,
      "candidate_provider_name",
      200,
      r.match_status !== "exact",
    );
    c.text(r.match_reason, "match_reason", 1500, true);
    c.enum(r.use_status, "use_status", ["internal_review_pending"]);
    c.enum(r.needs_human_review, "needs_human_review", ["true", "false"]);
    c.enum(r.relationship, "relationship", [
      "resident",
      "family",
      "tour_visitor",
      "staff",
      "care_professional",
      "other",
      "unknown",
    ]);
    c.enum(r.account_type, "account_type", [
      "firsthand",
      "recommendation_without_detail",
      "hearsay",
      "provider_promotion",
      "unclear",
    ]);
    c.enum(r.experience_stage, "experience_stage", [
      "touring",
      "receiving_care",
      "previous_care",
      "employment",
      "unknown",
    ]);
    c.enum(r.sentiment, "sentiment", [
      "positive",
      "negative",
      "mixed",
      "neutral",
      "unknown",
    ]);
    c.enum(r.concern_type, "concern_type", [
      "none",
      "service",
      "financial",
      "safety_allegation",
      "unclear",
    ]);
    c.time(r.retrieved_at_utc, "retrieved_at_utc");
    if (
      r.posted_at &&
      (!isoDate(r.posted_at) || r.posted_at > r.retrieved_at_utc.slice(0, 10))
    )
      issue(
        "observations",
        row,
        "posted_at",
        "date_invalid",
        "Post date must be a real date no later than retrieval; unknown dates stay blank.",
      );
    const sourceUrl = r.source_url ? publicUrl(r.source_url) : null,
      threadUrl = r.thread_url ? publicUrl(r.thread_url) : null;
    for (const [field, value] of [
      ["source_url", sourceUrl],
      ["thread_url", threadUrl],
    ] as const)
      if (r[field] && !value)
        issue(
          "observations",
          row,
          field,
          "url_invalid",
          "Use a bounded public HTTP(S) URL without credentials, whitespace or local/IP hosts.",
        );
    const themes = c.array(r.themes, "themes", THEMES);
    c.text(r.experience_period, "experience_period", 200);
    c.text(r.care_level, "care_level", 100, true);
    c.text(r.summary, "summary", 1500, true);
    c.text(r.supporting_public_excerpt, "supporting_public_excerpt", 500);
    c.text(r.independence_notes, "independence_notes", 1000, true);
    if (r.duplicate_of && !ID.test(r.duplicate_of))
      issue(
        "observations",
        row,
        "duplicate_of",
        "id_invalid",
        "Duplicate references must use local observation IDs.",
      );
    const words = r.supporting_public_excerpt
      .trim()
      .split(/\s+/u)
      .filter(Boolean).length;
    if (words && !sourceUrl && !threadUrl)
      issue(
        "observations",
        row,
        "supporting_public_excerpt",
        "excerpt_unlinked",
        "Quoted text requires an actual source or thread link.",
      );
    for (const url of new Set(
      [identityUrl(sourceUrl), identityUrl(threadUrl)].filter(
        Boolean,
      ) as string[],
    )) {
      const total = (quoteTotals.get(url) ?? 0) + words;
      quoteTotals.set(url, total);
      if (total > 25)
        issue(
          "observations",
          row,
          "supporting_public_excerpt",
          "quote_budget",
          "Total quoted text from a shared source/thread exceeds the 25-word cap.",
        );
    }
    const reasons = ["identity-source-redaction-and-reuse-review"];
    if (r.match_status !== "exact") reasons.push("ambiguous-provider-match");
    if (!sourceUrl) reasons.push("missing-source-permalink");
    if (r.concern_type === "safety_allegation")
      reasons.push("reported-serious-allegation");
    else if (
      /\b(?:abus(?:e|ed|ive)|neglect(?:ed)?|assault|overdose|sexual|fraud|theft|stolen|unsafe|medication error|serious injury)\b/i.test(
        `${r.summary} ${r.supporting_public_excerpt}`,
      )
    )
      reasons.push("possible-serious-allegation-human-triage");
    if (r.relationship === "staff" || r.experience_stage === "employment")
      reasons.push("employment-view-separate-from-care-experience");
    if (r.account_type === "provider_promotion")
      reasons.push("provider-promotion-not-independent-experience");
    if (reasons.length > 1 && r.needs_human_review === "false")
      warn(
        "observations",
        row,
        "needs_human_review",
        "review_escalated",
        "Importer has queued this row for human review regardless of the submitted flag.",
      );
    if (errors.length !== before) return;
    const sourceKey = `src_${digest([identityUrl(sourceUrl) ?? identityUrl(threadUrl) ?? [r.run_id, r.observation_id], r.provider_id || [r.match_status, candidate.toLowerCase()]]).slice(0, 32)}`;
    const content = {
      matchStatus: r.match_status,
      matchReason: r.match_reason.trim(),
      postedAt: r.posted_at || null,
      experiencePeriod: r.experience_period.trim() || null,
      relationship: r.relationship,
      accountType: r.account_type,
      careLevel: r.care_level.trim(),
      experienceStage: r.experience_stage,
      themes: [...themes].sort(),
      sentiment: r.sentiment,
      summary: r.summary.trim(),
      supportingPublicExcerpt: r.supporting_public_excerpt.trim() || null,
      concernType: r.concern_type,
    };
    const contentHash = digest(content);
    const observation: StagedObservation = {
      id: `obs_${digest([sourceKey, contentHash]).slice(0, 32)}`,
      sourceKey,
      contentHash,
      inputObservationId: r.observation_id,
      runId: r.run_id,
      providerId: r.provider_id || null,
      candidateProviderName: candidate || null,
      ...content,
      sourceUrl,
      threadUrl,
      sourceVisibility: "public",
      retrievedAtUtc: r.retrieved_at_utc,
      relationshipVerification:
        "self-described-or-unknown-not-independently-verified",
      duplicateOf: null,
      duplicateCandidateIds: [],
      duplicateGroupIds: [],
      independenceNotes: r.independence_notes.trim(),
      useStatus: "internal_review_pending",
      needsHumanReview: true,
      reportedNeedsHumanReview: r.needs_human_review === "true",
      scoreEligible: false,
      publishable: false,
      reviewReasons: reasons,
    };
    staged.push(observation);
    rawIds.set(r.observation_id, observation);
  });
  // Resolve explicit links and reject cycles; do not silently count or collapse distinct accounts.
  for (const [id, target] of rawDuplicates) {
    if (!target) continue;
    const observation = rawIds.get(id),
      other = rawIds.get(target);
    if (!observation || !other) {
      issue(
        "observations",
        null,
        "duplicate_of",
        "duplicate_target_missing",
        "Duplicate target must be another valid observation in this batch.",
      );
      continue;
    }
    const seen = new Set([id]);
    let current = target;
    while (current) {
      if (seen.has(current)) {
        issue(
          "observations",
          null,
          "duplicate_of",
          "duplicate_cycle",
          "Duplicate references must not form a cycle or self-reference.",
        );
        break;
      }
      seen.add(current);
      current = rawDuplicates.get(current) ?? "";
    }
    observation.duplicateOf = other.id;
    observation.reviewReasons.push("declared-duplicate");
  }
  const stagedIds = new Set<string>();
  const groupIndex = new Map<
    string,
    { reason: string; members: StagedObservation[] }
  >();
  for (const observation of staged) {
    if (stagedIds.has(observation.id))
      issue(
        "observations",
        null,
        "observation_id",
        "duplicate_content",
        "The same location/source/content occurs more than once; reconcile duplicate rows before import.",
      );
    stagedIds.add(observation.id);
    const thread = identityUrl(observation.threadUrl);
    for (const [reason, key] of [
      ["shared-source-or-source-edit", observation.sourceKey],
      ["shared-thread", thread],
      [
        "repeated-location-summary",
        `${observation.providerId ?? observation.candidateProviderName}:${observation.summary.toLowerCase()}`,
      ],
    ]) {
      if (!key) continue;
      const indexKey = `${reason}:${key}`;
      const group = groupIndex.get(indexKey) ?? {
        reason: reason!,
        members: [],
      };
      group.members.push(observation);
      groupIndex.set(indexKey, group);
    }
  }
  const duplicateGroups: ResearchImportStaging["duplicateGroups"] = [];
  for (const [key, group] of groupIndex) {
    if (group.members.length < 2) continue;
    const id = `dup_${digest(key).slice(0, 32)}`;
    const observationIds = [...new Set(group.members.map((o) => o.id))].sort();
    duplicateGroups.push({ id, reason: group.reason, observationIds });
    for (const observation of group.members) {
      observation.duplicateGroupIds.push(id);
      observation.duplicateCandidateIds = [
        ...new Set([
          ...observation.duplicateCandidateIds,
          ...observationIds
            .slice(0, 51)
            .filter((other) => other !== observation.id),
        ]),
      ]
        .sort()
        .slice(0, 50);
      if (
        !observation.reviewReasons.includes(
          "possible-shared-thread-copy-or-source-edit",
        )
      )
        observation.reviewReasons.push(
          "possible-shared-thread-copy-or-source-edit",
        );
    }
  }
  duplicateGroups.sort((a, b) => a.id.localeCompare(b.id));
  for (const observation of staged) observation.duplicateGroupIds.sort();
  const coverageIds = new Set<string>();
  coverageRows.forEach((r, index) => {
    const row = index + 2,
      c = check("coverage", row),
      before = errors.length;
    runIds.add(r.run_id);
    if (!ID.test(r.run_id))
      issue(
        "coverage",
        row,
        "run_id",
        "id_invalid",
        "Use a bounded run identifier.",
      );
    if (!catalog.has(r.provider_id))
      issue(
        "coverage",
        row,
        "provider_id",
        "provider_invalid",
        "Coverage requires an unchanged catalog provider ID.",
      );
    if (coverageIds.has(r.provider_id))
      issue(
        "coverage",
        row,
        "provider_id",
        "duplicate_coverage",
        "Use one coverage row per assigned provider in the run.",
      );
    coverageIds.add(r.provider_id);
    c.enum(r.status, "status", [
      "evidence_found",
      "searched_no_relevant_result",
      "access_restricted",
      "ambiguous_only",
      "partial",
      "not_searched",
    ]);
    c.time(r.searched_at_utc, "searched_at_utc", r.status === "not_searched");
    const queries = c.array(r.queries_used, "queries_used"),
      sources = c.array(r.sources_checked, "sources_checked");
    c.text(r.access_limits, "access_limits", 1500);
    c.text(r.coverage_notes, "coverage_notes", 1500);
    const count = Number(r.observations_found);
    if (!/^\d{1,5}$/.test(r.observations_found) || count > MAX_ROWS)
      issue(
        "coverage",
        row,
        "observations_found",
        "count_invalid",
        "Observation count must be a whole number from 0 to 10,000, not a people count.",
      );
    const exact = staged.filter(
      (o) => o.providerId === r.provider_id && o.runId === r.run_id,
    ).length;
    const unresolved = staged.filter(
      (o) => !o.providerId && o.runId === r.run_id,
    ).length;
    if (count < exact || count > exact + unresolved)
      issue(
        "coverage",
        row,
        "observations_found",
        "count_mismatch",
        "Reported rows do not reconcile to exact matches plus unresolved candidate rows in this run.",
      );
    if (count > exact && count <= exact + unresolved)
      warn(
        "coverage",
        row,
        "observations_found",
        "unresolved_count",
        "Unresolved rows cannot be assigned to this provider automatically; the reported count requires human reconciliation.",
      );
    if (
      [
        "searched_no_relevant_result",
        "access_restricted",
        "not_searched",
      ].includes(r.status) &&
      (count || exact)
    )
      issue(
        "coverage",
        row,
        "status",
        "status_contradiction",
        "This zero-evidence status cannot contain observations; use partial for mixed results and access limits.",
      );
    if (r.status === "evidence_found" && (count === 0 || exact === 0))
      issue(
        "coverage",
        row,
        "status",
        "status_contradiction",
        "Evidence found requires an exact-matched observation; use ambiguous_only or partial when appropriate.",
      );
    if (r.status === "ambiguous_only" && exact)
      issue(
        "coverage",
        row,
        "status",
        "status_contradiction",
        "Ambiguous-only coverage cannot contain exact-matched observations.",
      );
    if (
      r.status === "not_searched" &&
      (r.searched_at_utc || queries.length || sources.length)
    )
      issue(
        "coverage",
        row,
        "status",
        "status_contradiction",
        "Not-searched rows must not claim a search time, queries or checked sources.",
      );
    if (r.status !== "not_searched" && !queries.length && !sources.length)
      issue(
        "coverage",
        row,
        "queries_used",
        "search_provenance_missing",
        "An attempted search needs its actual queries or checked source descriptions.",
      );
    if (
      ["partial", "access_restricted"].includes(r.status) &&
      !r.access_limits.trim()
    )
      issue(
        "coverage",
        row,
        "access_limits",
        "limitation_missing",
        "Partial or restricted searches need an explicit access/interruption limitation.",
      );
    if (errors.length === before)
      coverage.push({
        id: `cov_${digest([r.run_id, r.provider_id]).slice(0, 32)}`,
        runId: r.run_id,
        providerId: r.provider_id,
        searchedAtUtc: r.searched_at_utc || null,
        queriesUsed: queries,
        sourcesChecked: sources,
        status: r.status,
        observationsFound: count,
        exactMatchedRows: exact,
        accessLimits: r.access_limits.trim() || null,
        coverageNotes: r.coverage_notes.trim() || null,
      });
  });
  if (runIds.size !== 1)
    issue(
      "batch",
      null,
      "run_id",
      "run_mismatch",
      "Import exactly one nonempty run at a time, with matching observation and coverage run IDs.",
    );
  for (const o of staged)
    if (o.providerId && !coverageIds.has(o.providerId))
      issue(
        "coverage",
        null,
        "provider_id",
        "coverage_missing",
        "Every exact-matched observation requires a coverage row.",
      );
  if (input.assignedProviderIds) {
    const assigned = new Set(input.assignedProviderIds);
    if (
      assigned.size !== input.assignedProviderIds.length ||
      !assigned.size ||
      [...assigned].some((id) => !catalog.has(id)) ||
      assigned.size !== coverageIds.size ||
      [...assigned].some((id) => !coverageIds.has(id))
    )
      issue(
        "coverage",
        null,
        "provider_id",
        "assignment_mismatch",
        "Coverage must contain exactly one row for each valid assigned provider, including not-searched providers.",
      );
  } else
    warn(
      "batch",
      null,
      null,
      "assignment_unchecked",
      "No assignment manifest supplied; coverage completeness is unknown. This batch does not establish catalog-wide search coverage.",
    );
  const counts = {
    inputObservations: observations.length,
    coverageRows: coverageRows.length,
    restrictedRowsRejected,
    catalogProviders: catalog.size,
  };
  if (errors.length)
    return { ok: false, errors, warnings, counts, staging: null };
  staged.sort((a, b) => a.id.localeCompare(b.id));
  coverage.sort((a, b) => a.providerId.localeCompare(b.providerId));
  const runId = [...runIds][0];
  const batchId = `batch_${digest({ runId, observations: staged, coverage }).slice(0, 32)}`;
  const staging: ResearchImportStaging = {
    schemaVersion: "harbor-research-import/1",
    batchId,
    runId,
    publicationState: "internal_review_pending",
    scoreEligible: false,
    observations: staged,
    coverage,
    duplicateGroups,
    reviewQueue: staged.map((o) => ({
      observationId: o.id,
      priority: o.reviewReasons.some((r) => r.includes("allegation"))
        ? "priority"
        : "normal",
      reasons: o.reviewReasons,
    })),
    limitations: [
      "Staging only: no publication, numerical scoring, author verification or independent-household count is authorized by this import.",
      "Restricted content is rejected; access limitations alone may be retained in the coverage ledger without private content.",
      "Exact location matches, redaction, source rights, serious allegations and duplicate/source-edit candidates still require human review.",
      "Stable source/content IDs support later reconciliation; this CLI does not operate a persistent retrieval-history, deletion or permission-change ledger.",
    ],
  };
  return { ok: true, errors, warnings, counts, staging };
}
