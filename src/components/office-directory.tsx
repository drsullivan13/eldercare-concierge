import { ExternalLink } from "lucide-react";
import type { OfficeDirectoryResearch } from "@/lib/location-research-types";
import { evidenceDate } from "./evidence-date";

export function OfficeDirectory({
  data,
  uid,
}: {
  data: OfficeDirectoryResearch;
  uid: string;
}) {
  return (
    <section aria-labelledby={uid}>
      <h4 id={uid}>{data.source.publisher}</h4>
      {data.accreditations?.length ? (
        <>
          <h5>Listed accreditation</h5>
          <ul className="research-specifics">
            {data.accreditations.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        </>
      ) : null}
      {data.services.length > 0 && (
        <details
          className="evidence-disclosure"
          open={data.services.length <= 4}
        >
          <summary>Listed services ({data.services.length})</summary>
          <ul className="research-specifics">
            {data.services.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </details>
      )}
      {data.paymentOptions.length > 0 && (
        <>
          <h5>Listed payment options</h5>
          <ul className="research-specifics">
            {data.paymentOptions.map((option) => (
              <li key={option}>
                {option === "CreditCard" ? "Credit card" : option}
              </li>
            ))}
          </ul>
          <p className="small muted">
            Confirm benefits and authorization with the agency and your plan.
          </p>
        </>
      )}
      {data.awards.length > 0 && (
        <>
          <h5>Client-satisfaction awards</h5>
          <ul className="research-specifics">
            {data.awards.map((award) => (
              <li key={award.name}>
                {award.name} · {award.years.join(", ")}
              </li>
            ))}
          </ul>
        </>
      )}
      <a
        className="research-source"
        href={data.source.url}
        target="_blank"
        rel="noreferrer"
      >
        {data.office.name} · checked {evidenceDate(data.source.checkedAt)}{" "}
        <ExternalLink size={12} />
      </a>
    </section>
  );
}
