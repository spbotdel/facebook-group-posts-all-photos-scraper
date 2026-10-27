# Release Process

Use this checklist before publishing a new public release.

## 1. Validate locally

```bash
npm ci
npm run check
npm test
```

## 2. Validate Actor metadata

Check:

- `.actor/actor.json`;
- `.actor/input_schema.json`;
- `.actor/output_schema.json`;
- `.actor/dataset_schema.json`;
- `README.md`;
- `CHANGELOG.md`.

## 3. Push to Apify

```bash
apify push
```

Confirm the Actor page renders:

- title and description;
- README;
- input schema;
- output schema;
- dataset schema view;
- pricing label;
- public task pages.

## 4. Push to GitHub

```bash
git status -sb
git push
```

Confirm GitHub Actions pass.

## 5. Create a GitHub release

```bash
gh release create v0.3.0-beta.0 --title "v0.3.0-beta.0" --notes-file CHANGELOG.md
```

Use a short release title and point users to the Apify Store page.

## 6. After release

- Check a small Apify smoke run.
- Review GitHub issues.
- Review Apify Actor issues.
- Update README/FAQ if users ask the same question twice. Once is feedback; twice is documentation debt wearing a fake mustache.
