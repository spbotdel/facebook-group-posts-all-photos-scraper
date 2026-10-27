# MCP and API Usage

This Actor is designed for Apify Console, Apify API, Apify schedules, webhooks, and Apify MCP.

## Actor ID

```text
spbotdel/facebook-group-posts-all-photos-scraper
```

## Connect through Apify MCP

The hosted Apify MCP server exposes this Actor to compatible AI clients. A minimal configuration is:

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com?tools=spbotdel/facebook-group-posts-all-photos-scraper"
    }
  }
}
```

Authenticate through OAuth when prompted, or configure the server with your Apify token. See the [official Apify MCP documentation](https://docs.apify.com/integrations/mcp).

## Start a run with the Apify API

```bash
curl "https://api.apify.com/v2/acts/spbotdel~facebook-group-posts-all-photos-scraper/runs?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
    "maxPostsPerGroup": 50,
    "sortMode": "CHRONOLOGICAL",
    "paginationMode": "cursor_page",
    "expandAllPhotos": true
  }'
```

## Node.js client example

See [examples/run-with-apify-api.mjs](../examples/run-with-apify-api.mjs).

## Post-run validation for agents

After every run, an agent should:

1. Read the default dataset.
2. Read `SUMMARY` from the default key-value store.
3. Confirm `SUMMARY.coverageStatus` before calling the run complete.
4. Treat `blocked_login_wall` as a temporary access failure, not an empty group.
5. Review rows with `media_review_severity` equal to `medium` or `high`.
6. Save `SUMMARY.pointer.nextCursor` only for older-post continuation.

## Agent prompt examples

- "Run the Facebook Group Posts & All Photos Scraper for this public group and return the latest 50 posts with text, timestamps, author URLs, and photo URLs."
- "Backfill 1,000 older posts from this public group and save the next cursor."
- "Monitor these public groups daily and stop when this known post ID is reached."
- "Return only posts where `media_final_count` is greater than `media_preview_count`."

## Reading results

After a run completes:

1. Read dataset items from the default dataset.
2. Read `SUMMARY` from the default key-value store.
3. Store `SUMMARY.pointer.nextCursor` if you need older-post continuation.
4. Store the latest `source_post_id` values if you need daily monitoring.
