# Facebook Group Posts & All Photos Scraper

[![Run on Apify](https://img.shields.io/badge/Run%20on-Apify-2f7df6)](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper)
[![Source on GitHub](https://img.shields.io/badge/source-GitHub-24292f)](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper)
[![AI agents](https://img.shields.io/badge/AI%20agents-MCP%20ready-6f42c1)](https://docs.apify.com/integrations/mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Scrape **latest or historical posts from public Facebook groups** into clean, agent-ready JSON. Get post text, Facebook creation timestamps, authors, engagement counters, stable post URLs, and **all recoverable photo URLs**, including photos hidden behind Facebook `+N` grids.

> **One paid result = one Facebook group post.** Expanded photo URLs are included in the same dataset row and the same per-post price. No Facebook account or cookie input is required from the user.

| Best for | Not designed for |
| --- | --- |
| Public Facebook groups, latest-post monitoring, historical backfills, photo-heavy posts, AI agents, MCP, API and scheduled pipelines | Private/login-only groups, Facebook Pages or profiles, Marketplace search, global keyword search, expanded comments, video downloads or transcripts |

**Start here:** [Run the Actor](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper) · [Latest-post task](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/latest-public-facebook-group-posts) · [All-photos task](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/facebook-group-posts-with-all-photos) · [GitHub](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper) · [Agent guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/AGENT_GUIDE.md) · [Output schema](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/OUTPUT_SCHEMA.md)

## Table of contents

- [Why this Actor](#why-this-actor)
- [Quick start](#quick-start)
- [What data you get](#what-data-you-get)
- [How all-photo recovery works](#how-all-photo-recovery-works)
- [Run recipes](#run-recipes)
- [AI agents and MCP](#ai-agents-and-mcp)
- [API and integrations](#api-and-integrations)
- [Reliability and troubleshooting](#reliability-and-troubleshooting)
- [Pricing](#pricing)
- [FAQ](#faq)
- [Limitations and responsible use](#limitations-and-responsible-use)
- [Support and related tools](#support-and-related-tools)

## Why this Actor

### The missing-photo problem

Facebook often renders five preview images and a `+N` overlay, while the remaining photos live behind a separate media set. A preview-oriented scraper can return a valid post row and still silently lose most of the product, apartment, event, or evidence photos.

This Actor treats photo completeness as part of the post, not as an optional afterthought:

1. Collect the public group feed and post metadata.
2. Detect media-set tokens and suspicious `+N` layouts.
3. Expand recoverable photo sets.
4. Retry suspicious rows before final output.
5. Report media quality fields instead of quietly declaring victory over an incomplete album.

### Feature comparison

| Capability | Preview-only extraction | This Actor |
| --- | --- | --- |
| Public group post text | Usually | Yes, including recoverable nested/attached-story text |
| Stable post ID and permalink | Varies | Yes, when Facebook exposes them |
| Facebook creation time | Varies | `created_at` plus evidence in `created_at_source` |
| Author identity | Varies | ID, name and profile URL when exposed |
| Feed preview photos | Yes | Yes |
| Hidden `+N` photo set | Often truncated | Expansion and fallback attempts |
| Photo auditability | Rare | Preview/final counts, risk flag and review severity |
| Latest-post monitoring | Often reprocesses old rows | `knownPostIds`, `onlyPostsNewerThan` and checkpoints |
| Date-window collection | Often requires downstream cleanup | Native lower and upper Facebook timestamp boundaries |
| Historical continuation | Varies | Cursor-backed 1,000-post chunks |
| AI-agent selection | Generic input/output | Explicit schemas, MCP prompts, `llms.txt` and diagnostics |
| Result grain | Can be unclear | Exactly one dataset item per post |

### Measured validation

The public release was validated in Apify cloud against real photo-heavy public groups. These are observed test results, not a promise that Facebook will behave identically every Tuesday.

| Validation | Unique posts | Final photo URLs | Photos recovered beyond feed preview | Duplicate post IDs | Medium/high media-review rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 groups x 200 posts | 1,200 | 6,307 | 1,975 | 0 | 0 |
| 1 group x 1,000 posts | 1,000 | 4,959 | 1,662 | 0 | 0 |

The deepest validated single post contained 24 photos. Historical collection has also been tested beyond 5,000 posts through cursor continuation. See [benchmark guidance](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/BENCHMARKS.md).

### Trust signals

| Signal | Details |
| --- | --- |
| Open source | Review the implementation on [GitHub](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper). |
| CI tested | Parser, media-quality, proxy-session and settings tests run in GitHub Actions. |
| No user Facebook credentials | The Actor accepts public group URLs, not Facebook cookies or passwords. |
| Structured output | One post per row with stable IDs, timestamps, media and quality fields. |
| Explicit diagnostics | `SUMMARY` distinguishes complete runs, date/known-post boundaries, partial runs and temporary login walls. |
| Agent documentation | [`llms.txt`](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/llms.txt), [Agent guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/AGENT_GUIDE.md) and [MCP guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/MCP_USAGE.md). |

## Quick start

### Run from Apify Console

1. Open the [Actor input page](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/input).
2. Paste one or more public Facebook group URLs.
3. Keep **New posts first** and **Expand all photos** enabled.
4. Set the number of posts per group and click **Start**.

Minimal input:

```json
{
  "groupUrls": [
    "https://www.facebook.com/groups/1564552680458634/"
  ],
  "maxPostsPerGroup": 50,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true
}
```

Each result in the default dataset is one post. After the run, also read the `SUMMARY` record from the default key-value store for coverage, photo totals, warnings and continuation state.

### Supported group URL formats

```text
https://www.facebook.com/groups/1564552680458634/
https://www.facebook.com/groups/chothuenhanguyencannhatrang/
1564552680458634
```

Use a group root URL or group ID. Do not submit a post permalink, profile URL, Page URL or Marketplace URL.

### Multiple groups in one run

```json
{
  "groupUrls": [
    "https://www.facebook.com/groups/chothuenhanguyencannhatrang/",
    "https://www.facebook.com/groups/1564552680458634/",
    "https://www.facebook.com/groups/nhamatbangnhatrang/"
  ],
  "maxPostsPerGroup": 100,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

Up to 10 public groups can be processed in one run. Inspect `SUMMARY.groups[]` because one temporarily unavailable group should not erase healthy results from the others.

## What data you get

### One normalized row per post

| Data | Main fields |
| --- | --- |
| Identity | `source_post_id`, `source_url`, `group_id`, `group_url`, `group_name` |
| Time | `created_at`, `created_at_source` |
| Text | `raw_text`, `text_source`, `text_missing_reason` |
| Author | `author.source_user_id`, `author.name`, `author.url` |
| Engagement | `stats.likes`, `stats.comments`, `stats.shares` when available |
| Photos | `media[].source_media_id`, `source_url`, `thumbnail_url`, dimensions and source |
| Media audit | `media_preview_count`, `media_final_count`, `media_completeness`, `media_review_severity`, `media_plus_n_risk` |
| Run context | `coverage_status`, `warnings`, `pagination` |

<details>
<summary><strong>Example post result (media array shortened)</strong></summary>

```json
{
  "record_type": "post",
  "source_platform": "facebook",
  "provider": "dachapify_facebook_group_posts_all_photos",
  "rank": 1,
  "group_id": "1564552680458634",
  "group_url": "https://www.facebook.com/groups/1564552680458634/",
  "source_post_id": "1938490876848082",
  "source_url": "https://www.facebook.com/groups/1564552680458634/permalink/1938490876848082/",
  "created_at": "2026-06-19T10:22:11.000Z",
  "created_at_source": "creation_time",
  "raw_text": "Example post text...",
  "text_source": "direct_message",
  "author": {
    "source_user_id": "100000000000000",
    "name": "Example Author",
    "url": "https://www.facebook.com/profile.php?id=100000000000000"
  },
  "stats": {
    "likes": 12,
    "comments": 3,
    "shares": 1
  },
  "media": [
    {
      "source_media_id": "photo_1",
      "media_type": "photo",
      "source_url": "https://scontent.example/photo.jpg",
      "thumbnail_url": "https://scontent.example/thumb.jpg",
      "source": "media_set",
      "index": 0
    }
  ],
  "media_preview_count": 5,
  "media_expanded_count": 13,
  "media_final_count": 13,
  "media_completeness": "expanded",
  "media_review_severity": "none",
  "media_plus_n_risk": false
}
```

The production `media` array contains every recovered photo object; it is shortened above only to keep the README from becoming an accidental family album. A sanitized sample is available in [`examples/sample-output.sanitized.json`](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/examples/sample-output.sanitized.json).

</details>

### Run-level `SUMMARY`

The default key-value store receives a `SUMMARY` record. Agents and production pipelines should inspect it before accepting a run as complete.

| Field | Why it matters |
| --- | --- |
| `coverageStatus` | Says whether the target, known-post boundary or date boundary was reached, or whether the run was partial/blocked. |
| `outputPosts` | Number of post rows produced. |
| `groups[]` | Per-group status for multi-group runs. |
| `extraPhotosFound` | Photos recovered beyond feed previews. |
| `mediaReviewSeverityCounts` | Distribution of media-audit severity. |
| `pointer.nextCursor` | Cursor for the next older backfill chunk. |
| `outputCheckpoint` | State that can be stored by monitoring pipelines. |
| `warnings` | Non-fatal conditions that deserve inspection. |

See the complete [output schema and coverage statuses](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/OUTPUT_SCHEMA.md).

### Export formats

Use Apify Dataset to export results as JSON, JSONL, CSV, Excel or XML, or send them onward through an integration or webhook.

## How all-photo recovery works

When `expandAllPhotos=true`, media is resolved in stages:

```text
Public group feed
    -> preview photos
    -> media-set token detection
    -> photo-set expansion
    -> permalink fallback for suspicious +N rows
    -> deferred retry
    -> final media list + quality flags
```

| Field | Interpretation |
| --- | --- |
| `media_preview_count` | Photos visible in the group feed payload. |
| `media_expanded_count` | Photos found through media-set expansion. |
| `media_final_count` | Final deduplicated photo count returned. |
| `media_completeness` | Final recovery classification. |
| `media_review_severity` | `none`, `low`, `medium` or `high`; review `medium` and `high`. |
| `media_plus_n_risk` | `true` when evidence suggests Facebook hid more photos than were recovered. |

The Actor returns source photo URLs, not binary image files. Facebook CDN URLs can expire, so download files promptly if your workflow needs durable storage.

## Run recipes

| Goal | Recommended configuration |
| --- | --- |
| Small evaluation | 10-20 posts, `CHRONOLOGICAL`, `cursor_page`, all photos enabled |
| Latest posts | Start at the top with `CHRONOLOGICAL` and no `startCursor` |
| Daily monitoring | Start at the top and stop with `knownPostIds` or `onlyPostsNewerThan` |
| Specific time period | Combine `onlyPostsNewerThan` and `onlyPostsOlderThan` |
| Photo-complete collection | Keep `expandAllPhotos=true` and concurrency at `3` |
| Fast preview-only test | Set `expandAllPhotos=false` |
| Historical history | Up to 1,000 posts per group, then continue with `pointer.nextCursor` |
| Multi-group monitoring | Up to 10 group URLs; inspect every entry in `SUMMARY.groups[]` |

### Latest public posts

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 50,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true
}
```

Do not pass an old `startCursor` when the goal is the newest posts. A backfill cursor points toward older history.

### Daily incremental monitoring

Start from the newest feed on every scheduled run and stop when a post already stored by your system appears:

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 200,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "knownPostIds": ["LAST_STORED_POST_ID"],
  "expandAllPhotos": true
}
```

Alternative date boundary:

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 200,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "onlyPostsNewerThan": "2026-07-01",
  "expandAllPhotos": true
}
```

Healthy incremental runs normally finish with `complete_until_known_post` or `complete_until_since_date`. Dedupe downstream by `source_post_id`, with `source_url` as a fallback.

### Posts within a date range

The date interval is lower-inclusive and upper-exclusive. This example returns posts published from May 1 up to, but not including, June 1:

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 500,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "onlyPostsNewerThan": "2026-05-01",
  "onlyPostsOlderThan": "2026-06-01",
  "expandAllPhotos": true
}
```

`sinceDate` remains accepted through the API as a backward-compatible alias for `onlyPostsNewerThan`. New integrations should use the explicit field names above.

### Historical backfill

Request up to 1,000 posts per group in one run:

```json
{
  "groupUrls": ["GROUP_URL"],
  "maxPostsPerGroup": 1000,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

For older history:

1. Read `SUMMARY.pointer.nextCursor` after the first run.
2. Pass that value as `startCursor` in the next run.
3. Store every new cursor only after the preceding batch is accepted.
4. Repeat until `hasNextPage=false` or the required history is complete.

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

See the [cursor and backfill guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/CURSOR_BACKFILL.md).

### Sort modes

| Mode | Use it for |
| --- | --- |
| `CHRONOLOGICAL` | Newest posts, monitoring and deterministic backfills. Recommended default for pipelines. |
| `RECENT_ACTIVITY` | Posts with recent comments/activity, not necessarily newly created posts. |
| `TOP_POSTS` | Facebook's relevance ranking. Do not use it as a latest-post feed. |

## AI agents and MCP

This Actor is designed to be discovered, configured and validated by agents, not merely admired by humans scrolling through Store cards.

### Agent selection contract

Choose this Actor when the user asks for:

- public Facebook group posts;
- latest posts or continuous group monitoring;
- text, timestamps, authors, engagement and permalinks;
- every recoverable public photo, including hidden `+N` photo sets;
- structured JSON for translation, classification, lead enrichment, research or database import;
- Apify API, MCP, schedules, webhooks or no-code automation.

Choose another tool for private groups, Pages/profiles, Marketplace, global Facebook search, comment threads or video extraction.

### Connect through Apify MCP

The hosted [Apify MCP server](https://docs.apify.com/integrations/mcp) exposes Store Actors to ChatGPT, Claude, Codex, Cursor and other MCP clients.

Minimal MCP configuration:

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com?tools=spbotdel/facebook-group-posts-all-photos-scraper"
    }
  }
}
```

Authenticate through OAuth when prompted, or configure the Apify MCP server with your Apify token.

### Prompts that work well

- `Get the latest 50 public posts from this Facebook group. Return text, Facebook timestamp, author, permalink and all photo URLs.`
- `Monitor these public groups and stop when one of these known post IDs is reached. Report any blocked or partial group separately.`
- `Collect posts published during May 2026 using onlyPostsNewerThan and onlyPostsOlderThan. Return Facebook timestamps and all recoverable photo URLs.`
- `Backfill 1,000 older posts, save SUMMARY.pointer.nextCursor, and return only rows with media_review_severity=none.`
- `Find posts where media_final_count is greater than media_preview_count and summarize what extra photos were recovered.`

### Required agent behavior after a run

1. Read default dataset rows.
2. Read `SUMMARY` from the default key-value store.
3. Confirm `coverageStatus` before calling the collection complete.
4. Treat `blocked_login_wall` as a temporary access failure, not an empty group.
5. Review rows with `media_review_severity=medium` or `high`.
6. Store `outputCheckpoint` for monitoring or `pointer.nextCursor` for older backfills.

More context: [Agent guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/AGENT_GUIDE.md) · [LLM playbook](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/LLM_AGENT_PLAYBOOK.md) · [`llms.txt`](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/llms.txt)

## API and integrations

Actor ID:

```text
spbotdel/facebook-group-posts-all-photos-scraper
```

### REST API

```bash
curl -X POST "https://api.apify.com/v2/acts/spbotdel~facebook-group-posts-all-photos-scraper/runs?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
    "maxPostsPerGroup": 50,
    "sortMode": "CHRONOLOGICAL",
    "paginationMode": "cursor_page",
    "expandAllPhotos": true
  }'
```

The response contains the run ID. Wait for completion, then read the run's default dataset and the `SUMMARY` record in its default key-value store.

### Python

```python
import os
from apify_client import ApifyClient

client = ApifyClient(os.environ["APIFY_TOKEN"])

run = client.actor(
    "spbotdel/facebook-group-posts-all-photos-scraper"
).call(run_input={
    "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
    "maxPostsPerGroup": 50,
    "sortMode": "CHRONOLOGICAL",
    "paginationMode": "cursor_page",
    "expandAllPhotos": True,
})

posts = client.dataset(run["defaultDatasetId"]).list_items().items
summary = client.key_value_store(
    run["defaultKeyValueStoreId"]
).get_record("SUMMARY")["value"]

print(len(posts), summary["coverageStatus"])
```

### Node.js

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const run = await client
    .actor('spbotdel/facebook-group-posts-all-photos-scraper')
    .call({
        groupUrls: ['https://www.facebook.com/groups/1564552680458634/'],
        maxPostsPerGroup: 50,
        sortMode: 'CHRONOLOGICAL',
        paginationMode: 'cursor_page',
        expandAllPhotos: true,
    });

const { items: posts } = await client.dataset(run.defaultDatasetId).listItems();
const summaryRecord = await client
    .keyValueStore(run.defaultKeyValueStoreId)
    .getRecord('SUMMARY');

console.log(posts.length, summaryRecord.value.coverageStatus);
```

### Apify CLI

```bash
apify call spbotdel/facebook-group-posts-all-photos-scraper -p '{"groupUrls":["https://www.facebook.com/groups/1564552680458634/"],"maxPostsPerGroup":50,"sortMode":"CHRONOLOGICAL","paginationMode":"cursor_page","expandAllPhotos":true}'
```

### Schedules, webhooks and no-code tools

- Use **Apify Schedules** for daily or hourly monitoring.
- Add a **webhook** on `ACTOR.RUN.SUCCEEDED` to import the dataset into your application.
- Connect the Actor through Apify integrations in **Make, n8n or Zapier**.
- Export datasets directly to JSON, CSV or Excel for manual workflows.

## Reliability and troubleshooting

### Recommended settings

| Situation | Recommendation |
| --- | --- |
| First run on a new group | Start with 10-20 posts and verify output. |
| Normal all-photo run | Keep `mediaExpansionConcurrency=3`, adaptive expansion and deferred retry enabled. |
| Latest-post automation | Use `CHRONOLOGICAL`, `cursor_page`, no `startCursor`. |
| Deep history | Use cursor chunks and persist the cursor only after a successful import. |
| Several groups | Inspect each group in `SUMMARY.groups[]`; isolate retries by group. |
| Durable image storage | Download CDN URLs soon after collection. |

### Coverage statuses

| `SUMMARY.coverageStatus` | Meaning | Action |
| --- | --- | --- |
| `complete_target_reached` | Requested post count was collected. | Accept the dataset. |
| `complete_until_known_post` | Monitoring reached a supplied known post ID. | Accept as a healthy incremental run. |
| `complete_until_since_date` | Monitoring reached the requested date boundary. | Accept as a healthy incremental run. |
| `blocked_login_wall` | Facebook temporarily returned a login wall for a public group. | Retry that group in a fresh run/session. |
| `bootstrap_failed` | The public group page could not be initialized reliably. | Verify the URL and retry; inspect bootstrap attempts. |
| `partial_before_target` | Collection started but stopped before target. | Inspect `stopReason`, warnings and retry history. |
| `partial_target_not_reached` | Fewer rows than requested were returned. | Check whether the group ended or Facebook interrupted pagination. |

### Why did I receive fewer posts than requested?

Common reasons:

- the group has fewer publicly available posts;
- `knownPostIds` or `onlyPostsNewerThan` intentionally stopped the run;
- the paid-result or max-cost limit was reached;
- Facebook temporarily returned an empty page or login wall;
- a post was deleted, unavailable or lacked a stable post identity;
- pagination ended before the requested target.

The run should not be judged by dataset length alone. Read `SUMMARY.coverageStatus`, `stopReason`, `warnings`, `bootstrapAttempts[]` and `groups[]`.

### A public group returned zero posts

Do not immediately classify it as empty. If `coverageStatus=blocked_login_wall`, retry the same group with a new Actor run. For scheduled multi-group jobs, accept healthy groups and retry only the blocked source.

### Photo URLs stopped working later

Facebook CDN URLs are tokenized and can expire. The Actor returns source URLs at collection time; your pipeline is responsible for downloading files when long-term storage is required.

## Pricing

**$2.49 per 1,000 Facebook group posts**, plus a `$0.00005` Actor-start event.

| Results | Post-result charge |
| ---: | ---: |
| 20 posts | `$0.0498` |
| 100 posts | `$0.2490` |
| 1,000 posts | `$2.4900` |

The billable result is `Facebook group post`:

- one dataset item equals one public Facebook group post;
- all recovered photo URLs are included in that same result;
- there is no per-photo event charge;
- platform usage is included under the current Store pricing configuration.

The pricing card on the [Actor page](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper) is authoritative if pricing changes later.

## FAQ

### Do I need a Facebook account or cookies?

No Facebook credentials are requested from the user. The Actor targets content exposed by public Facebook groups. Facebook can still temporarily show a login wall; the Actor reports that condition in `SUMMARY` instead of pretending the group is empty.

### Does it work with private groups?

No. Private, closed or login-only groups are outside the Actor's scope.

### Does it really return every photo?

It returns every **recoverable public photo URL** and specifically expands hidden `+N` photo sets. Facebook can remove, hide or expire media, so the Actor also returns quality flags rather than making an impossible absolute guarantee.

### How can I audit possible missing photos?

Check `media_preview_count`, `media_final_count`, `media_review_severity`, `media_plus_n_risk` and run-level media counts in `SUMMARY`.

### Are post timestamps the Facebook creation time or scrape time?

`created_at` is the Facebook post creation time when exposed. `created_at_source` records the evidence used. The Actor does not replace a missing creation time with the scrape time.

### Does it recover text from attached or nested posts?

Yes, when that text is present in the public payload. `text_source` shows whether text came from the direct message or a nested fallback path.

### Can it collect 5,000 or more posts?

Yes, through cursor continuation. The current public input limit is 1,000 posts per group per run; save `SUMMARY.pointer.nextCursor` and continue older history in subsequent runs.

### Can it return only new posts every day?

Yes. Schedule a newest-first run and pass `knownPostIds`, `onlyPostsNewerThan` or a stored checkpoint as the stop boundary. Do not use yesterday's backfill cursor to search for today's new posts.

### Can I collect posts from a specific date range?

Yes. Set `onlyPostsNewerThan` as the inclusive lower boundary and `onlyPostsOlderThan` as the exclusive upper boundary. Use `CHRONOLOGICAL` with `cursor_page` for predictable traversal.

### Can I search posts by keyword?

This Actor collects a public group's feed; it is not Facebook-wide search. Filter `raw_text` downstream, or use a dedicated Facebook search Actor when the source group is unknown.

### Does it scrape comments?

It returns comment counters when Facebook exposes them, not expanded comment bodies or replies.

### What about video?

Video downloads, direct video URLs and transcripts are not part of the product guarantee. This Actor is deliberately focused on posts and photos.

### Does it download images into Apify storage?

No. It returns image source URLs. Download them in your own pipeline if durable binary storage is needed.

### Can I export to CSV or Excel?

Yes. Use the default dataset's export controls in Apify Console or the dataset API.

## Limitations and responsible use

| Boundary | Detail |
| --- | --- |
| Public groups only | No private-group membership, cookie or login workflows. |
| No access bypass | The Actor does not bypass checkpoints, permissions, rate limits or security controls. |
| Facebook variability | Fields can be absent when Facebook does not expose them. |
| Comments | Counters only, no expanded threads. |
| Videos | No guaranteed video URL, download or transcript. |
| Images | Source URLs only; URLs can expire. |
| Marketplace, Pages and profiles | Use a target-specific Actor. |
| Media completeness | Inspect quality fields for suspicious rows. |

Use this Actor only for public data you are allowed to collect and process. Respect Facebook's terms, group rules, privacy expectations and applicable law. Do not use the output for harassment, unauthorized profiling or other harmful activity.

## Support and related tools

### Ready-made task pages

| Task | Best for |
| --- | --- |
| [Latest public Facebook group posts](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/latest-public-facebook-group-posts) | A newest-first sample from one group. |
| [Facebook group posts with all photos](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/facebook-group-posts-with-all-photos) | Photo-heavy posts and hidden `+N` grids. |
| [Daily Facebook group monitoring](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/daily-facebook-group-monitoring) | Scheduled incremental collection. |
| [Historical Facebook group backfill](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/historical-facebook-group-backfill) | Older posts with cursor continuation. |
| [Monitor public Facebook groups](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/examples/monitor-public-facebook-groups) | Multi-group monitoring. |

### Related Actor

Need posts from public personal profiles instead of groups? Use [Facebook Profile Posts & All Photos Scraper](https://apify.com/spbotdel/facebook-profile-posts-all-photos-scraper).

### Documentation

| Document | Purpose |
| --- | --- |
| [Agent guide](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/AGENT_GUIDE.md) | Tool selection and safe run defaults. |
| [LLM playbook](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/LLM_AGENT_PLAYBOOK.md) | Agent recipes and post-run interpretation. |
| [MCP/API usage](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/MCP_USAGE.md) | Agent and API integration. |
| [Output schema](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/OUTPUT_SCHEMA.md) | Post fields and `SUMMARY` diagnostics. |
| [Cursor backfill](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/CURSOR_BACKFILL.md) | Incremental monitoring and historical continuation. |
| [Limitations](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/blob/main/docs/LIMITATIONS.md) | Supported and unsupported targets. |

### Get help

Open an issue on the [Apify Actor page](https://apify.com/spbotdel/facebook-group-posts-all-photos-scraper/issues) or [GitHub](https://github.com/spbotdel/facebook-group-posts-all-photos-scraper/issues). Include:

- public group URL;
- Apify run ID;
- approximate post URL when available;
- whether the problem concerns text, timestamp, photos, pagination or coverage;
- relevant `SUMMARY.coverageStatus`, `stopReason` and warnings.

For private support, contact `spbotdel@gmail.com`.
