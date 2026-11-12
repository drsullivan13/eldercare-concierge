"use client";
import {
  ArrowUpRight,
  Bookmark,
  Building2,
  Check,
  FileCheck2,
  HeartHandshake,
  Hospital,
  MapPin,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  type Provider,
  type SearchProvider,
} from "@/lib/providers";
export function ProviderIcon({
  provider,
  size = 21,
}: {
  provider: Provider;
  size?: number;
}) {
  return provider.category === "home-care" ||
    provider.category === "staffing" ? (
    <HeartHandshake size={size} />
  ) : provider.category === "home-health" ? (
    <Hospital size={size} />
  ) : (
    <Building2 size={size} />
  );
}
export function Rating({
  value,
  label = "CMS overall",
}: {
  value: number | null;
  label?: string;
}) {
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
      <span>{label}</span>
    </span>
  );
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
  return (
    <article className="provider-card">
      <div className="provider-card-top">
        <div className={`provider-symbol symbol-${provider.category}`}>
          <ProviderIcon provider={provider} />
        </div>
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
          title={saved ? "Remove from shortlist" : "Save to shortlist"}
        >
          <Bookmark size={19} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <button className="provider-title" onClick={onOpen}>
        {provider.name}
      </button>
      <p className="provider-address">
        {provider.city}, {provider.state} {provider.zip}
      </p>
      <div className="provider-proof">
        {provider.cms ? (
          <Rating value={provider.cms.overall} />
        ) : (
          <span
            className={`evidence-badge ${provider.officialRecord ? "" : "provider-claim"}`}
          >
            <FileCheck2 size={14} />
            {provider.officialRecord
              ? "Official record available"
              : "Provider information"}
          </span>
        )}
      </div>
      <p className="provider-description">{provider.description}</p>
      <div className="provider-tags">
        {provider.services.slice(0, 3).map((service) => (
          <span key={service}>{service}</span>
        ))}
      </div>
      {provider.warnings.length > 0 && (
        <div className="provider-alert">
          <ShieldAlert size={15} />
          <span>{provider.warnings[0]}</span>
        </div>
      )}
      <div className="provider-footer">
        {onCompare ? (
          <label className="compare-check">
            <input
              type="checkbox"
              checked={compare || false}
              onChange={onCompare}
            />
            <span>{compare ? <Check size={12} /> : null}</span>Compare
          </label>
        ) : (
          <span className="source-count">
            {provider.sources.length} source
            {provider.sources.length === 1 ? "" : "s"}
          </span>
        )}
        <button className="text-link" onClick={onOpen}>
          View evidence <ArrowUpRight size={15} />
        </button>
      </div>
    </article>
  );
}
