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

## Transient login walls

Facebook may occasionally return a login wall for a public group bootstrap page. This does not always mean the group is private or empty.

When detected, the run summary uses:

- `coverageStatus: "blocked_login_wall"`;
- `bootstrapFailureReason: "login_wall"`;
- `bootstrap.loginWallDetected: true`.

Recommended handling:

1. Retry the same group with a fresh run.
2. For multi-group automation, keep healthy groups separate from the temporarily blocked group.
3. If repeated retries keep returning `blocked_login_wall`, treat the group as temporarily unavailable and try later.
