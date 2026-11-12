# Union and Morris Facebook follow-up review

Reviewed research commit `ac85b0b0` against the seven Harbor follow-up assignments and the original batch at `0041ba3f`. All seven assignment ID and Harbor ID pairs match. All 19 observation IDs are unique and distinct from the original 65. All 19 carry the internal review flag. No observation qualifies for automatic publication or scoring.

| Assignment | Rows | Harbor disposition |
|---|---:|---|
| Cedar Crest Village | 16 | Exact campus matches, all positive. Eight are coded firsthand. Twelve of the 16 share one thread. Retain for private qualitative review at campus scope. |
| Lantern Hill | 2 | Hold both. The underlying comments were unavailable, and the indexed accounts conflict with the post's comment count. Human verification of original comments and campus context is required before use. |
| BAYADA Morristown | 1 | Probable employment account with a blank provider ID. Keep unassigned and outside family experience. |
| A1 Plus, AAK, CSS Morris and BAYADA Cranford | 0 | Searches returned no relevant public observations across these four assignments. |

The VNA and Atria Cranford aggregate rows have blank rating, scale and count fields. An index card cannot confirm the current Page rating. Direct Page verification is outstanding. The retrieved Arbor Terrace reply does not identify Mountainside. Preserve the original attribution decision.

Coverage uses assignment IDs in the provider ID column. Resolve those through the trusted crosswalk before counting exact locations. Morristown's declared one is a candidate, with zero exactly linked rows. Research commit `1a52d72a` resolves the six earlier count discrepancies. The base coverage counts include probable and unresolved candidates. Recounting the original observations gives these totals:

| Base assignment | Declared observations | Exactly linked | Blank provider ID |
|---|---:|---:|---:|
| Victoria Mews | 17 | 16 | 1 |
| Oaks at Denville assisted living | 3 | 0 | 3 |
| Amber Court | 3 | 2 | 1 |
| Arbor Terrace | 8 | 7 | 1 |
| Autumn Lake | 13 | 9 | 4 |
| Runnells | 3 | 2 | 1 |

The base file has 65 unique observation IDs. Across all assignments, 47 observations link through the trusted crosswalk, 11 have blank provider IDs, and seven carry the quarantined Lantern Hill provisional ID. The other three provisional assignments contribute zero observations. All four provisional assignments remain quarantined. Trusted follow-up assignments do not change the identity of any base observation. The [original row audit](row-audit.csv) preserves the source counts and dispositions.

The corrected follow-up assignment places Cedar Crest Village in Morris County, consistent with [Harbor’s campus roster](../campus-and-office-assignments.csv). Both the base and follow-up observation files are byte-identical to their versions at `ac85b0b0`. The correction changes the research assignment metadata only.

For a subsequent human check, prioritize the original Lantern Hill post and comments, then the two location-specific rating Pages. Record what is directly visible, the exact location and check date. A nested reply can be looked up by its parent comment ID where accessible. Keep private source text on the research branch.
