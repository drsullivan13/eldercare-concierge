"use client";
import "./provider-card.css";
import { FamilyExperienceCount } from "./family-experience";
import {
  currentNjCoreqValue,
  coreqReportingYear,
  formatCoreqPercent,
} from "./nj-coreq";
import { providerDisplayName } from "./provider-display-name";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  MapPin,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  isServiceProvider,
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

const availabilityLabels: Partial<
  Record<NonNullable<SearchProvider["research"]>["availabilityStatus"], string>
> = {
  "opening-published": "Openings listed · confirm",
  "waitlist-published": "Waitlist published",
};

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

function ExperienceBadge({
  score,
  maximum,
  label,
  detail,
}: {
  score: string | number;
  maximum?: number;
  label: string;
  detail: React.ReactNode;
}) {
  return (
    <span className="experience-card-score">
      <strong>
        {score}
        {maximum !== undefined && <small>/{maximum}</small>}
      </strong>
      <span>
        {label}
        <small>{detail}</small>
      </span>
    </span>
  );
}

function reviewButtonLabel(
  reviews: NonNullable<SearchProvider["research"]>["individualReviews"],
): string {
  if (!reviews?.total) return "Explore review sources";
  const { total, withText } = reviews;
  if (withText === 0) return `Browse ${total} review links`;
  if (withText === total) return `Read ${withText} reviews`;
  return `Read ${withText} reviews, browse ${total - withText} links`;
}

export function ProviderCard({
  provider,
  saved,
  onSave,
  onOpen,
  onReviews,
  compare,
  onCompare,
}: {
  provider: SearchProvider;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  onReviews: (trigger: HTMLButtonElement) => void;
  compare?: boolean;
  onCompare?: () => void;
}) {
  const research = provider.research;
  const showSurvey =
    research?.experience.value == null &&
    research?.experience.publicationStatus !== "sources-disagree";
  const coreq = showSurvey ? currentNjCoreqValue(provider) : null;
  const engagement = showSurvey ? research?.residentEngagement : undefined;
  const patientSurvey = showSurvey ? research?.homeHealthSurvey : undefined;
  const alerts = new Set<string>();
  if (research?.admissionRestriction) alerts.add(research.admissionRestriction);
  for (const alert of providerCareAlerts(provider)) alerts.add(alert);
  const tags: string[] = [];
  const status = research?.availabilityStatus;
  const availability = status && availabilityLabels[status];
  if (availability) tags.push(availability);
  if (research?.publishedCosts) tags.push("Published costs");
  if (
    research?.facebookResearch?.findingCount &&
    !research.familyExperience?.distinctThreadCount
  )
    tags.push("Facebook findings");
  for (const service of provider.services) {
    if (tags.length === 3) break;
    if (!categoryServices[provider.category]?.includes(service))
      tags.push(service);
  }
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
        {providerDisplayName(provider.name)}
      </button>
      <p className="provider-address">
        {providerDisplayName(provider.city)}, {provider.state} {provider.zip}
      </p>
      {(provider.locationKind === "office" || isServiceProvider(provider)) && (
        <p className="provider-location-note">
          {provider.category === "home-care" &&
          provider.serviceAreaMatch === true ? (
            <>
              Provider-reported service area includes your searched ZIP. Office
              distance does not limit this match. Confirm service at your
              address and staffing.
            </>
          ) : (
            <>
              {provider.locationKind === "zip"
                ? "ZIP-estimated office location."
                : "Office location."}{" "}
              {provider.category === "home-care" &&
                "Service area unknown for your searched ZIP. "}
              Service at your address is not confirmed.
            </>
          )}
        </p>
      )}
      <div className="provider-research-summary">
        {research && research.experience.value !== null ? (
          <ExperienceBadge
            score={research.experience.value.toFixed(1)}
            maximum={10}
            label="Consumer experience"
            detail={
              <>
                Based on {research.experience.reviewCount}{" "}
                {research.experience.independentSourceCount === 1
                  ? research.experience.singleSourceLabel
                  : "source"}{" "}
                ratings
              </>
            }
          />
        ) : engagement ? (
          <ExperienceBadge
            score={engagement.index}
            maximum={engagement.maximum}
            label="Resident engagement"
            detail={`${engagement.year} · ${engagement.respondents} independent-living residents responded`}
          />
        ) : patientSurvey ? (
          <ExperienceBadge
            score={patientSurvey.stars}
            maximum={5}
            label="CMS patient survey"
            detail={`${patientSurvey.completed.toLocaleString("en-US")} completed surveys${patientSurvey.smallSample ? " · Small sample" : ""}`}
          />
        ) : coreq !== null ? (
          <ExperienceBadge
            score={formatCoreqPercent(coreq)}
            label="NJ resident & family survey"
            detail={`Long-stay satisfaction composite · ${coreqReportingYear} reporting year`}
          />
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
        {research?.experience.value == null &&
          Boolean(research?.experience.reviewCount) && (
            <p className="provider-rating-count">
              {research!.experience.reviewCount} source-reported ratings
            </p>
          )}
        <button
          className="provider-review-entry"
          onClick={(event) => onReviews(event.currentTarget)}
        >
          {coreq !== null || patientSurvey || engagement
            ? "View survey & review sources"
            : reviewButtonLabel(research?.individualReviews)}
          <ArrowUpRight size={15} />
        </button>
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
