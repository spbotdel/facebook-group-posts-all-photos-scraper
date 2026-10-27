# Benchmarks and Runtime Expectations

Runtime depends on group size, Facebook response quality, proxy behavior, and whether `expandAllPhotos` is enabled.

## Public release validation

The June 19, 2026 Apify cloud validation used real photo-heavy public groups with all-photo recovery enabled.

| Validation | Unique posts | Final photo URLs | Extra photos beyond feed preview | Duplicate post IDs | Medium/high media-review rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 groups x 200 posts | 1,200 | 6,307 | 1,975 | 0 | 0 |
| 1 group x 1,000 posts | 1,000 | 4,959 | 1,662 | 0 | 0 |

The maximum observed photo count was 24 on one post. The 1,000-post depth validation returned a continuation cursor. Separate continuation tests collected more than 5,000 posts by persisting the cursor between runs.

These are observed validation results, not guaranteed throughput or media counts. Facebook responses, group activity, proxy sessions, and media-set availability vary.

## Practical guidance

| Run type | Suggested settings | Notes |
| --- | --- | --- |
| Smoke test | 10-20 posts | Useful before scheduling a new group. |
| Daily monitoring | 50-200 posts | Stop with `knownPostIds` or `onlyPostsNewerThan`. |
| Photo-heavy group | `expandAllPhotos=true`, concurrency 3 | Better completeness, more runtime. |
| Historical chunk | 1,000 posts | Store `SUMMARY.pointer.nextCursor`. |
| Deep backfill | Repeated 1,000-post chunks | Works best as scheduled/queued chunks. |

## Cost model

The public Apify Store pricing is per dataset item: one result equals one Facebook group post. Photo URLs recovered for that post are included in the same result.

Platform runtime cost can vary because Facebook and proxies vary. The Store charge shown on the Actor page is the user-facing price.

## Speed tuning

- Keep `mediaExpansionConcurrency=3` for stable all-photos runs.
- Increase cautiously for faster experiments.
- Disable `expandAllPhotos` only when you want preview media, not full photo recovery.
- Use chunks for very deep history instead of one enormous run.
