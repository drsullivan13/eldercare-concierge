import type { FamilyExperience } from "@/lib/facebook-research";

export function FamilyExperienceCount({
  evidence,
}: {
  evidence?: FamilyExperience;
}) {
  const count = evidence?.distinctThreadCount ?? 0;
  if (!count) return null;
  return (
    <p className="family-experience small">
      {count} Facebook {count === 1 ? "thread" : "threads"} with resident or
      family accounts
    </p>
  );
}

export function FamilyExperienceEvidence({
  evidence,
}: {
  evidence?: FamilyExperience;
}) {
  if (!evidence?.distinctThreadCount) return null;
  return (
    <>
      <FamilyExperienceCount evidence={evidence} />
      <details className="evidence-disclosure family-experience-method">
        <summary>How Harbor uses these accounts</summary>
        <p>
          Selected accounts, not a representative survey. Relationships are not
          independently verified. Thread counts do not measure positivity,
          quality or prevalence.
        </p>
        <p>
          Findings apply to this catalog location, which may be a campus. Campus
          findings cannot transfer to separate nursing or assisted-living units.
        </p>
        <p>
          Each thread counts once, even when several people comment. Harbor
          includes selected accounts about this location.
        </p>
        <p>
          These accounts do not change the experience score. When you sort by
          experience within a care category, locations with the same published
          score are ordered by thread count, highest first. Locations without a
          score are ordered by distance, then name.
        </p>
      </details>
    </>
  );
}
