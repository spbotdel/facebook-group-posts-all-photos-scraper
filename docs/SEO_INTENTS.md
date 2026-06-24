# SEO and Recommender Intent Map

Apify Store search now behaves more like a recommender than a static keyword index. This page maps the Actor to the jobs users and AI agents are likely trying to complete.

## Primary positioning

**Public Facebook group posts scraper with all recoverable photo URLs.**

The strongest differentiator is not "Facebook scraping" in general. It is:

- public Facebook groups;
- one row per post;
- timestamps, authors, engagement, and permalinks;
- hidden `+N` photo-grid recovery;
- agent/API/MCP-ready output;
- cursor monitoring and backfill.

## High-intent searches

| Search intent | Landing emphasis |
| --- | --- |
| facebook group posts scraper | Public group posts, text, timestamps, author, post URL. |
| scrape facebook group posts | Quick start with `groupUrls`, latest posts, output JSON. |
| facebook group photos scraper | Hidden `+N` photo-grid recovery. |
| facebook group posts with images | One post row with all recoverable photo URLs. |
| latest facebook group posts scraper | `CHRONOLOGICAL`, `cursor_page`, monitoring pattern. |
| facebook group monitoring | `knownPostIds`, `sinceDate`, schedules, webhooks. |
| facebook group backfill | 1,000-post chunks, `SUMMARY.pointer.nextCursor`. |
| facebook group scraper mcp | Apify MCP, agent-readable schema, `llms.txt`. |
| facebook group scraper api | API example and dataset output fields. |
| facebook group post timestamps | `created_at`, `created_at_source`, timestamp caveat. |

## Negative intents

The Actor should not try to rank or convert for these:

| Intent | Better answer |
| --- | --- |
| Facebook Marketplace search | Use a Marketplace Actor. |
| Facebook page posts | Use a page/profile posts Actor. |
| Facebook comments scraper | Use a comments Actor. |
| Facebook private group scraper | Unsupported. |
| Facebook videos downloader | Unsupported. |
| global Facebook post search | Use a keyword search Actor. |

## README keywords to keep

- public Facebook group posts;
- all recoverable photo URLs;
- hidden `+N` photo grids;
- text, timestamps, authors, engagement;
- stable post URLs;
- Apify API;
- Apify MCP;
- AI agents;
- cursor continuation;
- daily monitoring;
- historical backfill.

## Recommender signals to improve over time

- successful runs from distinct users;
- repeat runs and scheduled runs;
- fast support replies;
- low failure rate;
- clear input field descriptions;
- reliable dataset schema;
- task pages for common use cases;
- external links from GitHub, docs, examples, and demo content.
