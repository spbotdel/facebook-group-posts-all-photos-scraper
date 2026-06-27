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

## Run summary diagnostics

The Actor writes a `SUMMARY` record to the default key-value store. Agents and pipelines should inspect these fields before treating a run as complete:

| Field | Description |
| --- | --- |
| `coverageStatus` | High-level collection result for the run or group. |
| `stopReason` | Lower-level stop reason when available. |
| `bootstrapFailureReason` | `login_wall`, `group_id_not_found`, or `null`. |
| `bootstrap.loginWallDetected` | `true` when any bootstrap attempt saw a Facebook login wall. |
| `bootstrap.failureReason` | Same bootstrap failure reason, nested under bootstrap details. |
| `bootstrapAttempts[]` | Per-attempt status code, final URL, group ID detection, and login-wall flag. |
| `groups[]` | Multi-group compact summaries, including per-group `coverageStatus` and `bootstrapFailureReason`. |

Important `coverageStatus` values:

| Status | Meaning |
| --- | --- |
| `complete_target_reached` | Requested post count was collected. |
| `complete_until_known_post` | Collection reached a supplied known post ID. |
| `complete_until_since_date` | Collection reached a supplied date boundary. |
| `blocked_login_wall` | Facebook returned a temporary login wall during public group bootstrap. Retry the group. |
| `bootstrap_failed` | Bootstrap failed without a clear login-wall signal. Verify URL and retry. |
| `partial_before_target` | Collection began but stopped before the target count. |
| `partial_target_not_reached` | Fewer posts than requested were returned. Inspect warnings and attempts. |
