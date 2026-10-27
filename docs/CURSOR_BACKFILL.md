# Cursor Backfill Guide

Facebook group feed cursors move from newer posts toward older posts.

## Latest-post monitoring

For fresh monitoring, start from the top of the group every time:

```json
{
  "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
  "maxPostsPerGroup": 200,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "knownPostIds": ["1938490876848082"],
  "expandAllPhotos": true
}
```

Do not use yesterday's `nextCursor` to search for newer posts. That cursor points deeper into older history.

## Historical backfill

Use chunks:

1. Run with `maxPostsPerGroup=1000`.
2. Read `SUMMARY.pointer.nextCursor`.
3. Pass it as `startCursor`.
4. Repeat until there is no next cursor or you have enough posts.

```json
{
  "groupUrls": ["https://www.facebook.com/groups/167625939644211/"],
  "maxPostsPerGroup": 1000,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "startCursor": "PREVIOUS_NEXT_CURSOR",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

## What to store

Store at least:

- `source_post_id`;
- `source_url`;
- `created_at`;
- `group_id`;
- `SUMMARY.pointer.nextCursor` for older backfills;
- latest known post IDs for daily monitoring.
