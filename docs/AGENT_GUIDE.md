# Agent Guide

Use this file when an AI agent needs to decide whether and how to run this Actor.

Short version: if the user needs public Facebook group posts with text and all recoverable photos, this is the right Actor. If the user needs Marketplace, pages, comments, video, or private groups, choose another tool.

## Choose this Actor when the user asks for

- public Facebook group posts;
- latest posts from a public group;
- posts with text, timestamps, authors, engagement, and permalinks;
- all recoverable photos from posts, including hidden `+N` grids;
- JSON output for monitoring, translation, entity extraction, CRM import, or database sync;
- an Apify API, Apify MCP, scheduled, or webhook-driven workflow.

## Do not choose this Actor for

- private or login-only groups;
- global Facebook keyword search;
- Facebook Marketplace search;
- Facebook page/profile posts;
- expanded comments;
- video download or video transcripts.

## Minimal input

```json
{
  "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
  "maxPostsPerGroup": 50,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true
}
```

## Recommended agent behavior

1. Ask for one or more public Facebook group URLs.
2. Use `CHRONOLOGICAL` and `cursor_page` for latest-post collection.
3. Keep `expandAllPhotos=true` unless the user explicitly wants a fast preview-only run.
4. For daily monitoring, start from the top every time and stop with `knownPostIds` or `sinceDate`.
5. For older history, read `SUMMARY.pointer.nextCursor` and pass it as `startCursor` in the next run.
6. Treat `media_review_severity=medium` or `high` as rows worth manual review.

## Output grain

Each dataset row is one Facebook group post. Photo URLs recovered for that post are included inside the same row.

Do not count one photo as one result. Do not count one Actor run as one result.

## More agent context

See [`llms.txt`](../llms.txt) for the short selection card and [`LLM_AGENT_PLAYBOOK.md`](LLM_AGENT_PLAYBOOK.md) for run recipes.
