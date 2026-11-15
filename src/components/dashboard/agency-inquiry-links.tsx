import routes from "@/data/inputs/nj-home-care-inquiry-routes.json";
import { familyOutreachMessage } from "@/lib/home-care-message";
import {
  homeCareContactLinks,
  type HomeCareOutreachRecord,
} from "@/lib/home-care-outreach";
import type { Provider } from "@/lib/providers";

export type AgencyInquiryPurpose = "interview" | "introduction";

type OfficeRoutes = (typeof routes.offices)[keyof typeof routes.offices];

const offices: Readonly<Record<string, OfficeRoutes>> = routes.offices;

export function AgencyInquiryLinks({
  providerId,
  purpose,
  at,
  record,
  provider,
  showUnavailable = false,
}: {
  providerId: string;
  purpose: AgencyInquiryPurpose;
  at?: Date;
  record?: HomeCareOutreachRecord;
  provider?: Provider;
  showUnavailable?: boolean;
}) {
  if (
    provider &&
    (provider.category !== "home-care" || provider.id !== providerId)
  )
    return null;
  if (
    purpose === "introduction" &&
    (!record ||
      record.interview.status !== "completed" ||
      record.interview.outcome !== "suitable" ||
      !Number.isFinite(Date.parse(record.interview.occurredAt)) ||
      record.interview.occurredAt > record.updatedAt ||
      !at ||
      !Number.isFinite(at.getTime()) ||
      at.getTime() <= Date.parse(record.interview.occurredAt))
  )
    return null;
  const message = familyOutreachMessage(purpose, at);
  const office = Object.hasOwn(offices, providerId)
    ? offices[providerId]
    : undefined;
  const links = (office?.routes ?? []).flatMap((route) => {
    if ("address" in route)
      return [
        {
          label: "Draft an email",
          href: `mailto:${route.address}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`,
        },
      ];
    const url = new URL(route.href);
    return url.protocol === "https:" && !url.username && !url.password
      ? [{ label: "Open the office form", href: route.href }]
      : [];
  });
  if (provider) {
    for (const link of homeCareContactLinks(provider)) {
      if (link.href.startsWith("tel:")) links.push(link);
      else if (!office && link.href.startsWith("mailto:")) {
        links.push({
          label: "Draft an email",
          href:
            link.href +
            "?subject=" +
            encodeURIComponent(message.subject) +
            "&body=" +
            encodeURIComponent(message.body),
        });
      } else if (!office && link.href.startsWith("https:")) links.push(link);
    }
  }
  const unique = links.filter(
    (link, index) =>
      links.findIndex((other) => other.href === link.href) === index,
  );
  if (!unique.length)
    return showUnavailable ? (
      <p>
        No contact route is published for this agency. Ask the agency for a care
        inquiry route.
      </p>
    ) : null;
  return (
    <div className="search-research-links">
      {unique.map((link) => (
        <a
          key={link.href}
          className="text-link"
          href={link.href}
          {...(link.href.startsWith("https:")
            ? { target: "_blank", rel: "noreferrer" }
            : {})}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
