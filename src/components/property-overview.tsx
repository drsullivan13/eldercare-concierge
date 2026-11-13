import { isServiceProvider, type Provider } from "@/lib/providers";
import { evidenceDate } from "./evidence-date";
import "./property-overview.css";

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
          <>
            <p>Provider-reported service area. {provider.serviceArea}</p>
            <p>
              Office proximity does not confirm service at your address or staff
              availability.
            </p>
          </>
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
