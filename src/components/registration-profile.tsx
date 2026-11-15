import type { RegistrationFacts } from "@/lib/providers";
import { evidenceDate } from "./evidence-date";

export function RegistrationProfile({ facts }: { facts: RegistrationFacts }) {
  const { source, expiresOn } = facts;
  const pastAtCheck = expiresOn && expiresOn < source.checkedAt;
  return (
    <section aria-label="New Jersey registration">
      <h4>New Jersey registration</h4>
      <ul className="research-specifics">
        {facts.dbas && <li>Registered trade names · {facts.dbas}</li>}
        <li>
          {facts.licenseType} · {facts.registration}
        </li>
        <li>
          Registry status · {facts.status} as of{" "}
          {evidenceDate(source.checkedAt)}
        </li>
        {expiresOn && <li>Listed expiration · {evidenceDate(expiresOn)}</li>}
      </ul>
      {pastAtCheck && (
        <p>
          The state lists an expiration before its status check. Confirm the
          current registration with NJ Consumer Affairs.
        </p>
      )}
      <a
        className="overview-more overview-source"
        href={source.url}
        target="_blank"
        rel="noreferrer"
      >
        {source.publisher} · checked {evidenceDate(source.checkedAt)}
      </a>
    </section>
  );
}
