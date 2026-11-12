"use client";
import "./provider-card.css";
import { FamilyExperienceCount } from "./family-experience";
import {
  ArrowUpRight,
  Bookmark,
  Building2,
  Check,
  HeartHandshake,
  Hospital,
  MapPin,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  type CareCategory,
  type Provider,
  type SearchProvider,
} from "@/lib/providers";
const categoryServices: Partial<Record<CareCategory, string[]>> = {
  "nursing-home": [
    "Nursing facility",
    "LONG TERM CARE FACILITY",
    "LONG TERM CARE FACILITY SNF/NF",
  ],
  "assisted-living": ["Assisted living", "ASSISTED LIVING RESIDENCE"],
  "home-health": ["Skilled home health"],
  staffing: ["Staffing"],
};

export function ProviderIcon({
  provider,
  size = 21,
}: {
  provider: Provider;
  size?: number;
}) {
  if (provider.category === "home-care" || provider.category === "staffing")
    return <HeartHandshake size={size} />;
  if (provider.category === "home-health") return <Hospital size={size} />;
  return <Building2 size={size} />;
}
function Rating({ value }: { value: number | null }) {
  return (
    <span className="rating">
      <span className="rating-stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={12}
            fill={value !== null && i < value ? "currentColor" : "none"}
            className={value !== null && i < value ? "" : "star-empty"}
          />
        ))}
      </span>
      <strong>{value === null ? "Not rated" : `${value}/5`}</strong>
      <span>CMS overall</span>
    </span>
  );
}

export function providerCareAlerts(provider: Provider) {
  const alerts = provider.warnings.filter((warning) =>
    /abuse|special.focus|certification is unverified|ownership change|admission restriction/i.test(
      warning,
    ),
  );
  const cms = provider.category === "nursing-home" ? provider.cms : undefined;
  if (cms?.abuse && !alerts.some((alert) => /abuse/i.test(alert)))
    alerts.push("CMS abuse icon is present in this source release.");
  if (
    cms?.specialFocus &&
    !alerts.some((alert) => /special.focus/i.test(alert))
  )
    alerts.push(`CMS special-focus status: ${cms.specialFocus}.`);
  return alerts;
}

export function ProviderCard({
  provider,
  saved,
  onSave,
  onOpen,
  compare,
  onCompare,
}: {
  provider: SearchProvider;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  compare?: boolean;
  onCompare?: () => void;
}) {
  const research = provider.research;
  const alerts = new Set<string>();
  if (research?.admissionRestriction) alerts.add(research.admissionRestriction);
  for (const alert of providerCareAlerts(provider)) alerts.add(alert);
  const availability =
    research?.availabilityStatus === "opening-published"
      ? "Openings listed · confirm"
      : research?.availabilityStatus === "waitlist-published"
        ? "Waitlist published"
        : null;
  const tags = [
    ...(availability ? [availability] : []),
    ...(research?.publishedCosts ? ["Published costs"] : []),
    ...(research?.facebookResearch?.findingCount &&
    !research.familyExperience?.distinctThreadCount
      ? ["Facebook findings"]
      : []),
    ...provider.services.filter(
      (service) => !categoryServices[provider.category]?.includes(service),
    ),
  ].slice(0, 3);
  return (
    <article className={`provider-card${compare ? " is-compared" : ""}`}>
      <div className="provider-card-top">
        <div className="provider-label">
          <span className="eyebrow">{CATEGORY_LABELS[provider.category]}</span>
          <span className="distance">
            <MapPin size={13} />
            {provider.distanceMiles === null
              ? provider.lat === null || provider.lng === null
                ? "Location unconfirmed"
                : "Distance not shown"
              : `${provider.distanceMiles.toFixed(1)} mi`}
            {provider.locationKind === "office"
              ? " · office"
              : provider.locationKind === "zip"
                ? " · ZIP estimate"
                : ""}
          </span>
        </div>
        <button
          className={`icon-button save-button ${saved ? "is-saved" : ""}`}
          onClick={onSave}
          aria-label={`${saved ? "Remove" : "Save"} ${provider.name}`}
          aria-pressed={saved}
          title={saved ? "Remove from shortlist" : "Save to shortlist"}
        >
          <Bookmark size={19} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <button
        className="provider-title"
        onClick={onOpen}
        aria-label={provider.name}
      >
        {provider.name === provider.name.toUpperCase()
          ? provider.name
              .toLowerCase()
              .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
              .replace(
                /\b(Llc|Llp|Inc|Cms|Vna|Snf|Nf|Usa|Ii|Iii|Iv)\b/g,
                (word) => word.toUpperCase(),
              )
          : provider.name}
      </button>
      <p className="provider-address">
        {provider.city}, {provider.state} {provider.zip}
      </p>
      {provider.locationKind === "office" && (
        <p className="provider-location-note">
          Office location. Service at your address is not confirmed.
        </p>
      )}
      <div className="provider-research-summary">
        {research && research.experience.value !== null ? (
          <span className="experience-card-score">
            <strong>
              {research.experience.value.toFixed(1)}
              <small>/10</small>
            </strong>
            <span>
              Consumer experience
              <small>
                {research.experience.publicationStatus ===
                "single-source-estimate"
                  ? `Single-source estimate · ${research.experience.singleSourceLabel} · `
                  : ""}
                {research.experience.confidence === "moderate"
                  ? "Moderate"
                  : "Limited"}{" "}
                evidence
                {" · "}
                {research.experience.reviewCount} reviews reported
              </small>
            </span>
          </span>
        ) : (
          <span className="experience-card-unrated">
            <span>
              Consumer experience
              <small>
                {research?.experience.publicationStatus === "sources-disagree"
                  ? "Harbor score withheld · Sources disagree"
                  : "Not enough evidence to score"}
              </small>
            </span>
          </span>
        )}
        {research?.experience.selectedConcerns && (
          <p className="provider-review-concern">
            Selected reviews include concerns.
          </p>
        )}
        {Boolean(research?.familyExperience?.distinctThreadCount) && (
          <div className="provider-family-insight">
            <FamilyExperienceCount evidence={research?.familyExperience} />
            <p>
              Selected accounts, not a representative sample or part of the
              score.
            </p>
          </div>
        )}
      </div>
      {provider.category === "nursing-home" && provider.cms && (
        <div className="provider-proof">
          <Rating value={provider.cms.overall} />
        </div>
      )}
      {tags.length > 0 && (
        <div className="provider-tags">
          {tags.map((tag) => (
            <span
              className={
                tag === availability ? "provider-availability" : undefined
              }
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {[...alerts].map((alert) => (
        <div className="provider-alert" key={alert}>
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{alert}</span>
        </div>
      ))}
      <div className="provider-footer">
        {onCompare && (
          <label className="compare-check">
            <input
              type="checkbox"
              checked={compare || false}
              aria-label={`Compare ${provider.name}`}
              onChange={onCompare}
            />
            <span>{compare ? <Check size={12} /> : null}</span>Compare
          </label>
        )}
        <button className="text-link" onClick={onOpen}>
          View details <ArrowUpRight size={15} />
        </button>
      </div>
    </article>
  );
}
