# Verification notes — followup-2026-11-12 (rating checks + Arbor Terrace nested reply)

Date: 2026-11-12. Checks run ~16:09–16:10 UTC. Base batch: commit 0041ba3f.
No new observations were created. No rows were amended.

## 1. VNA of Northern New Jersey rating — NOT VISIBLE on the Page

- Assignment: nj-m-09 (Harbor ID cms-317002), 175 South Street, Morristown.
- Base candidate: 4.0/5, 10 reviews, from a web-search snippet only.
- Page: https://www.facebook.com/vnannj

Methods and what each returned:

- `facebook-cli profile info --profile-id vnannj` → HTTP 403:
  "Profile Not Accessible — this profile is only readable for the viewer
  or the viewer's friends." The CLI profile endpoint is gated for this
  Page; it is not an authentication failure.
- Browser read of `https://www.facebook.com/vnannj` → profile stub only:
  name, URL, account type professional, 1192 followers. No rating block,
  no reviews, no address.
- Browser read of `https://www.facebook.com/vnannj/reviews` → the same
  stub (the /reviews path resolves back to the profile stub).
- Browser read of the place-ID URL
  `https://www.facebook.com/438990601487941` → upstream fetch failed
  (no public profile data available); not retried.
- Web search (context only, not confirmation): the search-indexed place
  card for place_id 438990601487941, 175 South St, Morristown, still shows
  "four stars (4.0), Based on 10 reviews" in the web index. That is index
  data, not the Page itself, so the 4.0/10 value is NOT confirmed.
- ReviewStars 4.6 (402–412 reviews) is a third-party aggregator value,
  not a Facebook value; not recorded.

Outcome: rating_value, rating_scale and review_count left blank in
`verify-aggregate-candidates.csv`. The base candidate stays
unconfirmed; do not use 4.0/10 as a Page-observed value.

## 2. Atria Cranford rating — NOT VISIBLE on the Page

- Assignment: nj-doh-NJ82472, 10 Jackson Drive, Cranford.
- Base candidate: 4.9/5, 18 reviews, from a search-indexed place card.
- Page: https://www.facebook.com/AtriaCranford

Methods and what each returned:

- `facebook-cli profile info --profile-id AtriaCranford` → HTTP 403,
  same "Profile Not Accessible" gate as the VNA Page.
- Browser read of `https://www.facebook.com/AtriaCranford` → profile stub
  only: name, URL, account type professional, 711 followers. No rating
  block, no reviews, no address.
- Browser read of `https://www.facebook.com/AtriaCranford/reviews` →
  the same stub.
- Web search (context only, not confirmation): the search-indexed place
  card for place_id 5444735062274667, 10 Jackson Dr, Cranford, still shows
  "five stars (4.9), Based on 18 reviews" in the web index. That is index
  data, not the Page itself, so the 4.9/18 value is NOT confirmed.

Outcome: rating_value, rating_scale and review_count left blank in
`verify-aggregate-candidates.csv`. The base candidate stays
unconfirmed; do not use 4.9/18 as a Page-observed value.

## 3. Arbor Terrace nested reply — RETRIEVED, does NOT name Mountainside

- Observation: fb-nju-a-007 (Arbor Terrace, unresolved, provider_id
  blank). Resident firsthand account naming only "Arbor Terrace".
- Post: https://www.facebook.com/sandie.siciliano/posts/pfbid0YtgaastikV1Xmp8VED6c8y97cJbznug91TgppDAiG94buSZYNEDKJcvSb1eNecxzl
  (posted 2026-09-07). The CLI canonicalises the post to post_id
  10232363162892402 with a different pfbid in its URL; it is the same
  post.

Methods and what each returned:

- `facebook-cli post read --url <post>` → the post (caption matches the
  recorded summary), comments count 2, retrieved 2026-11-12T16:09:19Z.
- `facebook-cli post comments read --post-id 10232363162892402` → two
  top-level comments, retrieved 2026-11-12T16:09:28Z:
  (a) comment 1099907339143755, 2026-09-08T13:23:02Z, "Sandie how long
  have you been at Arbor Terrace?", reply_count 1;
  (b) comment 1399899484816480, 2026-09-07T18:28:20Z, an unrelated
  account of living in independent retirement homes.
- `facebook-cli post comments read --post-id 1099907339143755` (the
  parent comment ID passed as the post ID) → the nested reply,
  retrieved 2026-11-12T16:09:32Z: comment 1082973757538336,
  2026-09-08T13:58:49Z. Quoted excerpt (20 words): "it will be three
  years in January. Highly recommend moving here! Location is only 1
  mile from our former home"

Outcome: the reply does NOT name Mountainside or any town. It says the
location is 1 mile from the author's former home, but the former home's
location is not stated anywhere in the retrieved material. No upgrade
is warranted. **No amendment is proposed: fb-nju-a-007 stays
unresolved with provider_id blank.** Do not guess the location from
the "1 mile from our former home" remark.

Method note for future runs: nested replies ARE retrievable via the CLI
by passing the parent comment ID as `--post-id` to `post comments read`.
The base run's note that nested replies are "not retrievable via CLI"
is therefore too broad — top-level pagination and reply retrieval work
when the parent comment ID is known. The known gaps that remain are
Facebook Recommendations tabs (not enumerable via CLI) and unmanaged
Page timelines (only search-found posts readable).

## Blocks

- CLI `profile info` is 403-gated for both public Pages checked; it
  returns profile metadata for neither. This is a command-level gate,
  not an authentication problem.
- Logged-out browser reads of Facebook Pages return a profile stub only
  (name, URL, account type, follower count). Rating blocks, reviews
  and addresses are not exposed to that fetch. A logged-in human
  browser session would be the remaining route to see either rating
  on the Page itself.
- No private groups, no contact, no new observations in this pass.
