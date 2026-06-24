# Output Schema

Each dataset item is one public Facebook group post.

## Core fields

| Field | Type | Description |
| --- | --- | --- |
| `record_type` | string | Usually `post`. |
| `source_platform` | string | `facebook`. |
| `provider` | string | Actor provider identifier. |
| `rank` | number | Result order within the run. |
| `group_id` | string/null | Facebook group ID when available. |
| `group_url` | string | Input group URL normalized by the Actor. |
| `group_name` | string/null | Group name when exposed. |
| `source_post_id` | string/null | Stable Facebook post ID when exposed. |
| `source_url` | string/null | Facebook post permalink. |
| `created_at` | string/null | Post creation time when exposed. |
| `created_at_source` | string/null | Evidence used for `created_at`. |
| `raw_text` | string | Extracted post text. |
| `text_source` | string | Extraction path, such as direct or nested text. |
| `author` | object | Author ID, name, and profile URL when exposed. |
| `stats` | object | Engagement counters when available. |

## Media fields

| Field | Description |
| --- | --- |
| `media` | Final list of recovered photo URL objects. |
| `media_preview_count` | Photo count visible in the feed preview. |
| `media_expanded_count` | Count recovered through media-set expansion. |
| `media_final_count` | Final photo count returned in the row. |
| `media_completeness` | Media status classification. |
| `media_review_severity` | `none`, `low`, `medium`, or `high`. |
| `media_plus_n_risk` | `true` if Facebook likely hid more photos than were recovered. |
| `media_set_tokens` | Facebook photo-set tokens found in the post payload. |

## Media object

```json
{
  "source_media_id": "photo_1",
  "media_type": "photo",
  "source_url": "https://scontent...",
  "thumbnail_url": "https://scontent...",
  "width": 0,
  "height": 0,
  "ocr_text": null,
  "source": "media_set",
  "index": 0
}
```

The Actor returns photo URLs. It does not download binary image files into Apify storage.
