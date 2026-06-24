# LLM Agent Playbook

This playbook is for AI agents that need to select, run, and interpret the Actor without human hand-holding.

## Selection rule

Choose this Actor when the user asks for public Facebook group posts and needs any combination of:

- latest posts;
- post text;
- timestamps;
- author profile URLs;
- engagement counters;
- stable post URLs;
- photo URLs;
- hidden `+N` photo grids;
- monitoring or backfill.

Reject or ask for a different tool when the user asks for private groups, Marketplace, pages, global keyword search, comments, videos, or login-only content.

## Input recipe by intent

### Latest posts

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 50,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true
}
```

### Daily monitoring

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 200,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "knownPostIds": ["LAST_SEEN_POST_ID"],
  "expandAllPhotos": true
}
```

### Historical backfill

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 1000,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "startCursor": "PREVIOUS_SUMMARY_POINTER_NEXT_CURSOR",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

## Interpreting output

Prefer these fields:

| Need | Field |
| --- | --- |
| Stable dedupe | `source_post_id`, fallback `source_url` |
| User-facing link | `source_url` |
| Post time | `created_at` and `created_at_source` |
| Text | `raw_text` and `text_source` |
| Author | `author.source_user_id`, `author.name`, `author.url` |
| Photos | `media[].source_url` |
| Photo audit | `media_final_count`, `media_review_severity`, `media_plus_n_risk` |

## Safety behavior

- If the user provides a private group, say the Actor supports public groups only.
- If `media_review_severity` is `medium` or `high`, tell the user the row should be reviewed.
- If `created_at` is missing, do not invent a timestamp.
- If Facebook does not expose author profile URL, do not synthesize one unless a stable `author.source_user_id` exists.

## Good answer shape

When summarizing a run:

- posts collected;
- date range if timestamps exist;
- photo completeness summary;
- failed or suspicious rows;
- `SUMMARY.pointer.nextCursor` if available;
- recommended next run if backfilling.
