# Changelog

All notable changes to this project are documented here.

## v0.3.2-beta.0 - 2026-06-28

### Changed

- Suppressed the generic "Returned fewer posts than requested" warning for healthy boundary completions such as `complete_until_known_post` and `complete_until_since_date`.

## v0.3.1-beta.0 - 2026-06-27

### Changed

- Added explicit `blocked_login_wall` run diagnostics when Facebook returns a temporary login wall during public group bootstrap.
- Added `bootstrapFailureReason` and nested `bootstrap.failureReason` / `bootstrap.loginWallDetected` fields to `SUMMARY`.
- Added `bootstrap_failure_reason` to `SUMMARY.outputCheckpoint` for downstream pipelines.
- Added per-group `bootstrapFailureReason` to compact multi-group summaries.

### Documentation

- Documented login-wall retry handling for humans, API clients, and AI agents.
- Expanded output schema notes with `coverageStatus` meanings.

## v0.3.0-beta.0 - 2026-06-24

Initial public beta release.

### Added

- Public Apify Actor package for scraping public Facebook group posts.
- One dataset row per Facebook group post.
- Public group URL input with numeric and vanity group support.
- `CHRONOLOGICAL`, `RECENT_ACTIVITY`, and `TOP_POSTS` feed sort modes.
- Cursor-page mode for monitoring and historical backfills.
- Stable post IDs and permalinks when Facebook exposes them.
- Post creation timestamps when Facebook exposes them.
- Author ID, name, and profile URL when available.
- Engagement counters when available.
- Normal post text and nested/attached-story text extraction.
- Feed preview photo extraction.
- Hidden `+N` photo-grid recovery attempts through media-set expansion.
- Deferred retry path for suspicious media rows.
- Media quality flags: `media_review_severity`, `media_plus_n_risk`, `media_completeness`.
- `SUMMARY.pointer.nextCursor` for older-post continuation.
- Agent-oriented docs, examples, and output schema.
- GitHub Actions CI with syntax checks and parser tests.

### Boundaries

- Public Facebook groups only.
- No private or login-only group access.
- No expanded comments.
- No video download or transcript guarantee.
- Photo URLs are returned; image binaries are not downloaded into Apify storage.
