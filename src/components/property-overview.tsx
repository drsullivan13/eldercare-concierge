"use client";

import { useProviderEvidence } from "@/hooks/use-provider-evidence";
import {
  isLocationDescriptionResponse,
  type LocationDescriptionResponse,
} from "@/lib/location-description-types";
import { isServiceProvider, type Provider } from "@/lib/providers";
import { evidenceDate } from "./evidence-date";
import "./property-overview.css";

const descriptionScopes: Record<LocationDescriptionResponse["scope"], string> =
  {
    facility: "Facility description.",
    campus: "Campus description. Individual care units may differ.",
    "agency-office": "Agency office, not a residential community.",
    "service-area":
      "Service-area description, not a verified visitable location.",
  };

const descriptionSource = {
  path: "/api/location-description",
  idParameter: "id",
  unavailable: "Description request failed.",
  notFound: null,
  mismatched: "Invalid description response.",
  fallback: "The location description could not be loaded.",
  validate: isLocationDescriptionResponse,
};

function LocationDescriptionSummary({ providerId }: { providerId: string }) {
  const {
    data: description,
    error,
    retry,
  } = useProviderEvidence<LocationDescriptionResponse>(
    providerId,
    descriptionSource,
  );

  if (error)
    return (
      <section aria-label="Location description">
        <p>The location description could not be loaded.</p>
        <button type="button" className="overview-more" onClick={retry}>
          Retry location description
        </button>
      </section>
    );

  if (!description) return null;
  const official = description.basis === "official-listing";
  return (
    <section className="overview-description" aria-label="Location description">
      <h4>
        {official ? "Official listing description" : "Provider description"}
      </h4>
      <p>{description.summary}</p>
      <p>{descriptionScopes[description.scope]}</p>
      {official && (
        <p>
          Limited to facts in an official listing, not a provider-authored
          description.
        </p>
      )}
      <p>Current care availability is not established.</p>
      {description.limitations.length > 0 && (
        <details className="overview-description-notes">
          <summary>Source limitations</summary>
          {description.limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
        </details>
      )}
      {description.sources.map((source) => (
        <a
          key={source.url}
          className="overview-more overview-source"
          href={source.url}
          title={source.title}
          target="_blank"
          rel="noreferrer"
        >
          Description source · {source.publisher} · checked{" "}
          {evidenceDate(source.checkedAt)}
        </a>
      ))}
    </section>
  );
}

export function PropertyOverview({ provider }: { provider: Provider }) {
  const office = isServiceProvider(provider);
  const street = provider.address.trim().replace(/,+$/, "");
  const locality = `${provider.city}, ${provider.state} ${provider.zip}`;
  const address = street
    ? street.toLowerCase().endsWith(locality.toLowerCase())
      ? street
      : `${street}, ${locality}`
    : "";
  const mailing = /\bP\.?\s*O\.?\s*BOX\b|\bPOST OFFICE BOX\b/i.test(street);
  const directions =
    street && address && !mailing
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
      : undefined;

  return (
    <div
      className="property-overview"
      role="region"
      aria-label="Property overview"
    >
      {provider.state === "NJ" && (
        <LocationDescriptionSummary
          key={provider.id}
          providerId={provider.id}
        />
      )}
      <div className="overview-location">
        <h4>{office ? "Service location & access" : "Location & access"}</h4>
        {address ? (
          <p className="overview-address">{address}</p>
        ) : (
          <p>A street address is not established.</p>
        )}
        {directions && (
          <a
            className="overview-more"
            href={directions}
            target="_blank"
            rel="noreferrer"
          >
            Get directions{office ? " to the office" : ""}
          </a>
        )}
        {mailing && (
          <p>
            Mailing address only. A visitable street location is not
            established. Confirm the office address before visiting.
          </p>
        )}
        {office && (
          <p>
            {mailing
              ? "A service-area listing, not a verified residential location."
              : "An office that arranges care, not a residential community."}
          </p>
        )}
        {provider.locationKind === "zip" && (
          <p>
            Exact location point not confirmed; distance and map use ZIP area
            estimate.
            {directions && " Directions use the published street address."}
          </p>
        )}
        {provider.serviceArea && (
          <p>Provider-reported service area. {provider.serviceArea}</p>
        )}
        {(office || provider.serviceArea) && (
          <p>
            Office proximity does not confirm service at your address or staff
            availability.
          </p>
        )}
        {provider.sources.slice(0, 1).map((source) => (
          <a
            key={source.url}
            className="overview-more overview-source"
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            Location source · {source.publisher} · checked{" "}
            {evidenceDate(source.checkedAt)}
          </a>
        ))}
      </div>
    </div>
  );
}
