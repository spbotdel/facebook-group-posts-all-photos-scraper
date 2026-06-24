# Benchmarks and Runtime Expectations

Runtime depends on group size, Facebook response quality, proxy behavior, and whether `expandAllPhotos` is enabled.

## Practical guidance

| Run type | Suggested settings | Notes |
| --- | --- | --- |
| Smoke test | 10-20 posts | Useful before scheduling a new group. |
| Daily monitoring | 50-200 posts | Stop with `knownPostIds` or `sinceDate`. |
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
