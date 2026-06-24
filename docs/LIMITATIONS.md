# Limitations

This Actor intentionally has a narrow, explicit scope.

## Supported

- Public Facebook group posts.
- Numeric group URLs and vanity group URLs.
- Post text, including nested/attached-story text when recoverable.
- Creation timestamp when Facebook exposes it.
- Author ID/name/profile URL when Facebook exposes it.
- Engagement counters when available.
- Preview photos and recoverable hidden `+N` photo sets.
- Cursor continuation for older posts.

## Not supported

- Private or login-only groups.
- Facebook login/session/cookie input.
- Access bypass, checkpoint bypass, or permission bypass.
- Global Facebook keyword search.
- Facebook Marketplace search.
- Facebook page/profile posts.
- Expanded comments.
- Video download or video transcripts.
- Binary image downloading into Apify storage.

## Data quality

Facebook can hide, remove, reorder, or expire content. For media audits, inspect:

- `media_review_severity`;
- `media_plus_n_risk`;
- `media_preview_count`;
- `media_final_count`;
- `warnings`;
- run `SUMMARY`.
