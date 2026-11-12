# Union slice A notes — NJ follow-up (followup-2026-11-12)

Run `fb-nj-union-morris-2026-11-12`, follow-up `followup-2026-11-12`.
Providers: `nj-campus-lantern-hill`, `nj-reg-HP0254700` (A1 Plus Home Care
Services), `nj-reg-HP0364600` (AAK Healthcare Institute). Observation IDs
`fb-njfu-a-001`–`002`. All observations `internal_review_pending`,
`needs_human_review=true`.

## Providers completed (3/3)

| Provider | Observations | Outcome |
|---|---|---|
| nj-campus-lantern-hill | 2 | evidence_found — the two outage-thread comments |
| nj-reg-HP0254700 | 0 | searched_no_relevant_result |
| nj-reg-HP0364600 | 0 | searched_no_relevant_result |

## Lantern Hill outage thread — re-read outcome

The two critical comments on the official Lantern Hill Page's 2026-07-04
power-outage post ARE recorded, as fb-njfu-a-001 (safety_allegation: a
resident needing a CPAP reports an unmarked extension cord across a
hallway) and fb-njfu-a-002 (service: repeated unanswered calls to the
front desk since early morning). Both are firsthand, negative, campus-
level (no unit named), on the post that the base batch recorded as
fb-nju-b-011 (provider_promotion).

Why they were recorded: the original public content is accessible and
location/context is confirmed — the public search index returns verbatim
quotes of both comments in three independent retrievals, and a direct
page fetch of the public post describes both comments; the post is on
the official Page, dated 2026-07-04, about the New Providence area
outage at the campus. The CLI comment endpoint returning 0 results is a
tool limitation, not inaccessibility.

Method-correction attempt (per parent instruction): the nested-reply
method (pass the parent comment ID as --post-id to `facebook-cli post
comments read`) could NOT be applied here — the CLI returns 0 comments
for this post under every invocation (pfbid, numeric post ID
1595834925883155, --limit 20), so no parent comment ID is obtainable.
The method works where comments are enumerable (as on the Arbor Terrace
post); on this post they are not. The base run's "nested replies not
retrievable" note is too broad as a general rule, but for this post the
limitation is top-level comment enumeration, not nested replies.

Count discrepancy to flag for human review: post metadata reports
1 comment, while the search index and page fetch describe two comments.
Possible reply threading (one top-level comment + one reply). A human
should confirm on the live post.

Excerpt budget: the two excerpts total 23 words for the shared thread
(≤25-word cap).

## Lantern Hill campus — no other new material

Three further social.search rounds (dated, engagement-ranked, undated)
returned only base-batch items: the outage post, the Mayor Morgan
10th-anniversary proclamation (two variants — group post = base
fb-nju-b-010, plus the same event on the mayor's own timeline; same
event, not re-recorded), the Morgan/Geoffroy/Pennisi campaign photo op
(base-excluded, still excluded), the Madison Rotary CCRC talk
(base-excluded, still excluded), and the commercial reel (base
fb-nju-b-013). A Student Server Information Session flyer (2026-07-06)
confirms the campus address 535 Mountain Ave but is recruitment, not a
care account — excluded. New Providence, NJ Community Forum (7,000
members) is membership-gated (address verification, mail photo) and was
not searched; a CLI posts search for 'Lantern Hill' there returned no
results, consistent with no access.

## A1 Plus Home Care Services (nj-reg-HP0254700) — 0 observations

Business verified as real at the exact assigned address via web
directories: 2424 Morris Ave Ste 107, Union, NJ 07083, (908) 623-3293,
website a1plushomecare.wixsite.com, operating since 2016, NPI
1023521101. No Facebook Page and no public Facebook discussion of this
business found in three social.search rounds (dated, undated), two web
searches (exact name + address; site:facebook.com), and a CLI groups
search for Union. All results were other A Plus/A1 entities — A-1
Hackensack, A+ Home Care (Milwaukee), Amada Senior Care Union County,
A Plus Caring Heart (Baton Rouge), A-1 Home Care Agency — none
transferred.

## AAK Healthcare Institute (nj-reg-HP0364600) — 0 observations

Business verified as real at the exact assigned address via web
directories: 1460 Morris Ave Ste C, Union, NJ 07083, (732) 400-2735,
website aakhcinstitute.com — an NJ-licensed home-care firm (24/7
live-in aides, personal care, medication reminders, Hoyer-lift
equipment rental). No Facebook presence for the Union NJ entity found
in two social.search rounds (dated, undated) and two web searches
(exact name + address; site:facebook.com). Excluded as different
entities: AAK Home Healthcare, Sumter SC (Khadijah Gaines,
854-999-5664) — same brand pattern, different state and business; ACE
Home HealthCare / Ace Healthcare Training Institute, Union NJ — a
different entity (a school), including its Union Campus class posts;
AAK Healthcare Institute, 167 Alcorne St, Somerset NJ — a different
office of the same firm, not transferred. Only the home-care service
was in scope; no school material was matched.

## Serious allegations flagged

One recorded as an observation: fb-njfu-a-001 (safety_allegation —
unmarked extension cord across a hallway during the outage, reported by
a resident who needs a CPAP). Attributed account, not a confirmed
event; flagged for human review.

## Aggregate candidates

None in this slice. No Page for A1 Plus or AAK exists to publish a
rating, and no Lantern Hill Page rating was surfaced. The VNA/Atria
rating verification was handled by the Morris slice
(`verify-aggregate-candidates.csv` in this directory).

## Blocks / access limits

- CLI `post comments read` returns 0 results for the Lantern Hill
  outage post on every invocation; no comment ID obtainable.
- New Providence, NJ Community Forum is membership-gated; not searched.
- Union NJ Moms and Insider – Township of Union are closed (base run);
  CLI groups search for 'Union' surfaced only Union Strong and Union
  of Friends (small, no care relevance).
- Facebook Page timelines are not enumerable via CLI; only
  search-found posts were read.
