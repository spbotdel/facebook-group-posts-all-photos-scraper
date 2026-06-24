# Contributing

Thanks for helping improve Facebook Group Posts & All Photos Scraper.

## Scope

This project targets public Facebook group posts only. Please keep changes inside that boundary:

- no private or login-only groups;
- no credential sharing;
- no checkpoint or login bypass logic;
- no raw private data in tests, issues, fixtures, or screenshots.

## Development

Install dependencies:

```bash
npm ci
```

Run checks:

```bash
npm run check
npm test
```

Run locally with Apify CLI:

```bash
apify run --input-file examples/latest-posts.input.json
```

## Pull requests

Good pull requests usually include:

- a small, focused change;
- a test when parser behavior changes;
- an update to README/docs/examples when input or output changes;
- no real tokens, cookies, local paths, or raw user data.

## Parser changes

Facebook markup and payloads move around. When changing extraction logic, prefer:

- small pure helper functions;
- fixtures or sanitized examples;
- explicit output flags for uncertainty;
- fail-soft behavior with clear warnings in `SUMMARY`.
