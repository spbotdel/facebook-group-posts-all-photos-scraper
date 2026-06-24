# Comparison Notes

This project is built around one specific gap: photo-heavy Facebook group posts.

| Capability | Preview-oriented group scraper | This Actor |
| --- | --- | --- |
| Public group post text | Yes | Yes |
| Stable post IDs and URLs | Varies | Yes when exposed |
| Timestamps | Varies | Yes when exposed |
| Author profile URL | Varies | Yes when exposed |
| Feed preview images | Often | Yes |
| Hidden `+N` photo recovery | Often missing | Core feature |
| One row per post | Usually | Yes |
| Media quality flags | Rare | Yes |
| Cursor backfill | Varies | Yes |
| Agent-readable docs and schema | Varies | Yes |

Use a different Actor if your primary target is Marketplace, pages, profiles, comments, or global keyword search.
