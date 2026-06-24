# Public Task Page Guide

Public task pages are small landing pages for concrete jobs. They help both humans and AI agents pick the Actor without reading the whole README.

## Field selection

For most public task pages, expose only these input fields:

- `groupUrls`;
- `maxPostsPerGroup`;
- `sortMode`;
- `paginationMode`;
- `expandAllPhotos`;
- `knownPostIds` only for monitoring tasks;
- `sinceDate` only for monitoring tasks;
- `startCursor` only for backfill tasks.

Hide advanced fields unless the task is explicitly about tuning reliability or debugging. A public task should feel like a recipe, not a cockpit after a lightning strike.

## Dataset schema

Use the `Posts` dataset schema view.

The visible promise should be:

> One result = one public Facebook group post. Recovered photo URLs are included in the same row.

## Recommended task pages

### Latest public Facebook group posts

SEO title:

```text
Latest public Facebook group posts scraper
```

SEO description:

```text
Collect latest posts from a public Facebook group with text, timestamps, authors, engagement, stable post URLs, and recoverable photo URLs.
```

Input:

```json
{
  "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
  "maxPostsPerGroup": 50,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true
}
```

### Facebook group posts with all photos

SEO title:

```text
Facebook group posts with all photos
```

SEO description:

```text
Scrape public Facebook group posts and recover photo URLs hidden behind +N grids. Output one JSON row per post.
```

Input:

```json
{
  "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
  "maxPostsPerGroup": 100,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

### Daily Facebook group monitoring

SEO title:

```text
Daily Facebook group monitoring
```

SEO description:

```text
Monitor public Facebook groups for new posts and stop at known post IDs or a date boundary. Includes text, timestamps, authors, and photo URLs.
```

Input:

```json
{
  "groupUrls": ["https://www.facebook.com/groups/1564552680458634/"],
  "maxPostsPerGroup": 200,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "knownPostIds": ["LAST_SEEN_POST_ID"],
  "expandAllPhotos": true
}
```

### Historical Facebook group backfill

SEO title:

```text
Historical Facebook group posts backfill
```

SEO description:

```text
Backfill older public Facebook group posts in 1,000-post chunks using cursor continuation and all recoverable photo URLs.
```

Input:

```json
{
  "groupUrls": ["https://www.facebook.com/groups/167625939644211/"],
  "maxPostsPerGroup": 1000,
  "sortMode": "CHRONOLOGICAL",
  "paginationMode": "cursor_page",
  "startCursor": "PREVIOUS_SUMMARY_POINTER_NEXT_CURSOR",
  "expandAllPhotos": true,
  "mediaExpansionConcurrency": 3
}
```

### Multi-group public Facebook monitoring

SEO title:

```text
Monitor multiple public Facebook groups
```

SEO description:

```text
Collect posts from several public Facebook groups in one run with text, timestamps, author profile URLs, engagement, permalinks, and photos.
```

Input:

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
  "expandAllPhotos": true
}
```
