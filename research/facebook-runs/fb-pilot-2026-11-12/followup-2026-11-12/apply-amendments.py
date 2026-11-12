#!/usr/bin/env python3
"""Apply the 2026-11-12 follow-up amendments to the versioned copies.

Reads observations-amended.csv and coverage-amended.csv in this directory
(which already carry the task-1 coverage format fixes), applies every
proposed amendment from the four findings files in scratch/, and writes the
files back in place.

Every amendment asserts the current cell value before changing it:
replacements must match exactly; appends must match the expected suffix.
Any mismatch aborts before writing anything, so a bad transcription can
never silently corrupt the batch.

Length caps enforced are the importer's: match_reason 1500, summary 1500,
independence_notes 1000, coverage_notes 1500.
"""

import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OBS_PATH = os.path.join(HERE, "observations-amended.csv")
COV_PATH = os.path.join(HERE, "coverage-amended.csv")

LINKED_NOTE = (
    "Linked case, reviewed 2026-11-12: one of three MGB Home Care advocacy "
    "records (fb-nww-001, 2026-06-30; fb-nww-002, 2026-08-13; fb-nww-003, "
    "2026-11-01) from the same Massachusetts Nurses Association labor "
    "dispute and post-strike bargaining. Related staff accounts from one "
    "linked dispute, not three independent events and not a prevalence "
    "measure. Reported allegations are staff-reported, not independently "
    "verified and not confirmed events."
)
REREAD_CAVEAT = (
    "Direct re-read failed 2026-11-12 (post unavailable to this account); "
    "the public web index still returns this permalink with content "
    "matching the recorded summary."
)

GENERIC_MATCH_REASON = (
    "Comment in a short-term rehab / skilled-nursing recommendations thread "
    "naming NewBridge. The rehab context points to the separately licensed "
    "skilled nursing facility at 7000 Great Meadow Road, which is not in "
    "this batch. Campus vs. nursing unit cannot be distinguished from the "
    "comment alone; provider_id is left blank so the account is not "
    "transferred to the life-plan campus."
)

# (kind, key, field, mode, expected_current, new_value)
# kind: 'obs' (key = observation_id) or 'cov' (key = provider_id)
# mode: 'replace' (expected_current must equal the cell) or 'append'
# (cell must end with expected_current suffix, new_value is the text to add)
AMENDMENTS = [
    # --- MGB trio: linked-case note (mgb-testimonials-findings.md §4, §6)
    ("obs", "fb-nww-001", "independence_notes", "append",
     "Independence unestablished beyond the shared source.", " " + LINKED_NOTE),
    ("obs", "fb-nww-002", "independence_notes", "append",
     "Independence unestablished beyond the shared source.", " " + LINKED_NOTE),
    ("obs", "fb-nww-003", "independence_notes", "append",
     "Independence unestablished.", " " + LINKED_NOTE + " " + REREAD_CAVEAT),
    # --- Testimonials: false review flags -> true
    ("obs", "fb-bos-003", "needs_human_review", "replace", "false", "true"),
    ("obs", "fb-bos-004", "needs_human_review", "replace", "false", "true"),
    ("obs", "fb-bos-007", "needs_human_review", "replace", "false", "true"),
    ("obs", "fb-nsh-008", "needs_human_review", "replace", "false", "true"),
    ("obs", "fb-nsh-009", "needs_human_review", "replace", "false", "true"),
    # --- Reconciliation note appends (reconciliation-findings.md items 1-3)
    ("cov", "cms-225540", "coverage_notes", "append",
     "was found in this run.",
     " Re-read 2026-11-12 confirms the visit was to the Edelweiss Village "
     "assisted-living unit. The candidate's subject matches catalog record "
     "ma-alr-edelweiss-village (Edelweiss Village, assisted-living, 2220 "
     "Centre St, Boston-West Roxbury); see follow-up assignment A1."),
    ("cov", "cms-225634", "coverage_notes", "append",
     "brand-confusion risk noted.",
     " Re-read 2026-11-12: 71 of 73 top-level comments retrieved via the "
     "CLI, none names a location; nested replies are not exposed by the "
     "CLI. A web-search summary of the thread reports the author's own "
     "reply as naming Care One in Weymouth, but that is a secondary "
     "summary, not retrievable source text. A human should open the thread "
     "directly and read the nested reply to the 'what hospital in?' "
     "comment before any upgrade to exact."),
    ("obs", "fb-ssh-001", "match_reason", "append",
     "before treating as exact.",
     " Re-read 2026-11-12: 71 of 73 top-level comments retrieved, none "
     "names a location; nested replies not retrievable via the CLI."),
    # --- Duplicate groups: independence_notes replacements (G03/G04/G12/G13/G14)
    ("obs", "fb-nsh-004", "independence_notes", "replace",
     "independence unestablished",
     "Distinct comment on the facility's retirement-celebration post "
     "(2026-09-12); shares the thread and the bare post URL as source with "
     "fb-nsh-005, a separate comment about an aunt currently resident. "
     "Different claims (mother's previous care vs aunt's current "
     "residence); not duplicates; independence unestablished."),
    ("obs", "fb-nsh-005", "independence_notes", "replace",
     "independence unestablished",
     "Distinct comment on the facility's retirement-celebration post "
     "(2026-09-12); shares the thread and the bare post URL as source with "
     "fb-nsh-004, a separate comment about a mother's previous care. "
     "Different claims; not duplicates; independence unestablished."),
    ("obs", "fb-nsh-011", "independence_notes", "replace",
     "Same comment as fb-nsh-012; separate provider-specific claims from "
     "one comment. Same thread as fb-nsh-007 and fb-nsh-010.",
     "Same comment as fb-nsh-012: one comment naming two providers, "
     "recorded as one observation per provider. Not two independent "
     "recommendations and not a duplicate account; shares the advice thread "
     "with fb-nsh-007 and fb-nsh-010, which are distinct comments; "
     "independence unestablished."),
    ("obs", "fb-nsh-012", "independence_notes", "replace",
     "Same comment as fb-nsh-011; separate provider-specific claims from "
     "one comment. Found during the Brooksby Village thread review; counts "
     "toward Kaplan Estates coverage.",
     "Same comment as fb-nsh-011: one comment naming two providers, "
     "recorded as one observation per provider. Not two independent "
     "recommendations and not a duplicate account; counts toward Kaplan "
     "Estates coverage; independence unestablished."),
    ("obs", "fb-ssh-018", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-020 because each comment named "
     "only the facility (collector template for name-only comments), not "
     "because it is the same comment; distinct comment objects, not "
     "duplicates."),
    ("obs", "fb-ssh-020", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-018 because each comment named "
     "only the facility (collector template for name-only comments), not "
     "because it is the same comment; distinct comment objects, not "
     "duplicates."),
    ("obs", "fb-ssh-022", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-023 and fb-ssh-026 because "
     "each comment named only the facility (collector template for "
     "name-only comments), not because it is the same comment; distinct "
     "comment objects, not duplicates."),
    ("obs", "fb-ssh-023", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-022 and fb-ssh-026 because "
     "each comment named only the facility (collector template for "
     "name-only comments), not because it is the same comment; distinct "
     "comment objects, not duplicates."),
    ("obs", "fb-ssh-026", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-022 and fb-ssh-023 because "
     "each comment named only the facility (collector template for "
     "name-only comments), not because it is the same comment; distinct "
     "comment objects, not duplicates."),
    ("obs", "fb-ssh-032", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-034 because each comment named "
     "only the facility (collector template for name-only comments), not "
     "because it is the same comment; distinct comment objects, not "
     "duplicates."),
    ("obs", "fb-ssh-034", "independence_notes", "append",
     "independence unestablished",
     ". Summary text is identical to fb-ssh-032 because each comment named "
     "only the facility (collector template for name-only comments), not "
     "because it is the same comment; distinct comment objects, not "
     "duplicates."),
    # --- NewBridge metadata corrections (newbridge-findings.md)
    ("obs", "fb-ssh-002", "independence_notes", "replace",
     "Shares thread with fb-ssh-003 (different post); independence unestablished",
     "Separate post on the official NewBridge Page from fb-ssh-003; "
     "different commenters; independence unestablished"),
    ("obs", "fb-ssh-003", "independence_notes", "replace",
     "Shares thread with fb-ssh-002 (different post); independence unestablished",
     "Separate post on the official NewBridge Page from fb-ssh-002; "
     "different commenters; independence unestablished"),
    ("obs", "fb-ssh-009", "match_reason", "replace",
     "Comment on the official NewBridge on the Charles Facebook Page "
     "thread; author says they have worked for the company for years and "
     "praises the campus memory-care unit. The unit is part of the "
     "life-plan campus in this batch, but the account is a staff "
     "endorsement, so it is recorded as provider promotion and flagged for "
     "human review.",
     "Comment in the public Everything Local Dedham/Westwood and Beyond "
     "group memory-care recommendations thread; author says they have "
     "worked for the company for years and praises the campus memory-care "
     "unit. The unit is part of the life-plan campus in this batch, but "
     "the account is a staff endorsement, so it is recorded as provider "
     "promotion and flagged for human review."),
    ("obs", "fb-ssh-012", "care_level", "replace", "unknown", "memory care"),
    ("obs", "fb-ssh-012", "summary", "replace",
     "Commenter said NewBridge in Dedham is the best and that the campus "
     "cared for their mother and their mother-in-law. No specific events, "
     "dates, or care level were stated.",
     "Commenter said NewBridge in Dedham is the best and that the campus "
     "cared for their mother, who had dementia, and their mother-in-law. "
     "No specific events or dates were stated."),
    ("obs", "fb-ssh-016", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in the memory-care recommendations thread naming NewBridge; "
     "the commenter describes firsthand short-term rehab experience and "
     "links the Hebrew Rehabilitation Center rating page. The rehab "
     "service points to the separately licensed skilled nursing facility "
     "at 7000 Great Meadow Road, which is not in this batch; provider_id "
     "is left blank so the account is not transferred to the life-plan "
     "campus."),
    ("obs", "fb-ssh-017", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in the memory-care recommendations thread naming NewBridge; "
     "the commenter states they have no memory-care experience but that "
     "the skilled nursing section is excellent. The skilled-nursing "
     "service points to the separately licensed skilled nursing facility "
     "at 7000 Great Meadow Road, which is not in this batch; provider_id "
     "is left blank so the account is not transferred to the life-plan "
     "campus."),
    ("obs", "fb-ssh-021", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in a rehab recommendations thread (hip surgery) naming "
     "NewBridge. The commenter describes two good stays for their mother "
     "and compares NewBridge with Hebrew Rehab, both noted as owned by "
     "Hebrew Senior Life. The rehab service points to the separately "
     "licensed skilled nursing facility at 7000 Great Meadow Road, which "
     "is not in this batch; provider_id is left blank so the account is "
     "not transferred to the life-plan campus."),
    ("obs", "fb-ssh-021", "summary", "replace",
     "Commenter said Newbridge in Dedham was a very good experience for "
     "their mother twice. No specific events, dates, or care aspects were "
     "stated. The rehab context points to the skilled nursing unit, not "
     "the life-plan campus.",
     "Commenter said Newbridge in Dedham was a very good experience for "
     "their mother twice, and that she was also at Hebrew Rehab in "
     "Roslindale once, noting both are owned by Hebrew Senior Life. No "
     "specific events, dates, or care aspects were stated. The rehab "
     "context points to the skilled nursing unit, not the life-plan "
     "campus."),
    ("obs", "fb-ssh-027", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in a rehab recommendations thread (hip surgery) naming "
     "NewBridge. The commenter describes a firsthand negative stay for "
     "their husband, with care, food, room and evening-staffing "
     "conditions. The stay was a rehab stay in context; the rehab service "
     "points to the separately licensed skilled nursing facility at 7000 "
     "Great Meadow Road, which is not in this batch; provider_id is left "
     "blank so the account is not transferred to the life-plan campus."),
    ("obs", "fb-ssh-030", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in a skilled-nursing recommendations thread naming "
     "NewBridge. The commenter states their mother had good care there "
     "and classifies NewBridge as a rehabilitation facility. The rehab "
     "service points to the separately licensed skilled nursing facility "
     "at 7000 Great Meadow Road, which is not in this batch; provider_id "
     "is left blank so the account is not transferred to the life-plan "
     "campus."),
    ("obs", "fb-ssh-031", "match_reason", "replace", GENERIC_MATCH_REASON,
     "Comment in a skilled-nursing recommendations thread naming "
     "NewBridge. The commenter calls it the best and notes it is "
     "difficult to get in if it is just for rehab. The rehab service "
     "points to the separately licensed skilled nursing facility at 7000 "
     "Great Meadow Road, which is not in this batch; provider_id is left "
     "blank so the account is not transferred to the life-plan campus."),
]

CAPS = {
    "match_reason": 1500,
    "summary": 1500,
    "independence_notes": 1000,
    "coverage_notes": 1500,
}


def load(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        rows = list(reader)
    return headers, rows


def main():
    obs_headers, obs_rows = load(OBS_PATH)
    cov_headers, cov_rows = load(COV_PATH)
    obs = {r["observation_id"]: r for r in obs_rows}
    cov = {r["provider_id"]: r for r in cov_rows}
    applied = []
    for kind, key, field, mode, expected, new in AMENDMENTS:
        table = obs if kind == "obs" else cov
        row = table.get(key)
        if row is None:
            print(f"ABORT: {kind} {key} not found")
            sys.exit(1)
        current = row[field]
        if mode == "replace":
            if current != expected:
                print(f"ABORT: {kind} {key} {field} current value mismatch")
                print(f"  expected: {expected!r}")
                print(f"  actual:   {current!r}")
                sys.exit(1)
            row[field] = new
        else:  # append
            if not current.endswith(expected):
                print(f"ABORT: {kind} {key} {field} suffix mismatch")
                print(f"  expected suffix: {expected!r}")
                print(f"  actual tail:     {current[-len(expected) - 20:]!r}")
                sys.exit(1)
            row[field] = current + new
        cap = CAPS.get(field)
        if cap and len(row[field]) > cap:
            print(f"ABORT: {kind} {key} {field} length {len(row[field])} > {cap}")
            sys.exit(1)
        applied.append((kind, key, field, len(current), len(row[field])))

    with open(OBS_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=obs_headers)
        w.writeheader()
        w.writerows(obs_rows)
    with open(COV_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cov_headers)
        w.writeheader()
        w.writerows(cov_rows)
    print(f"applied {len(applied)} amendments")
    for kind, key, field, before, after in applied:
        print(f"  {kind} {key} {field}: {before} -> {after} chars")


if __name__ == "__main__":
    main()
