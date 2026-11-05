# n8n workflow: Group posts -> Google Sheets + Slack

[`importable workflow JSON`](n8n/group-to-google-sheets-slack.json) watches one public Facebook group, writes each post to Google Sheets, and sends a Slack message after a successful or failed Apify run.

## What the workflow does

1. Runs every six hours.
2. Starts **Facebook Group Posts & All Photos Scraper** with a safe default:
   - one public group;
   - 50 posts per group;
   - `maxTotalChargeUsd = 0.25`;
   - `CHRONOLOGICAL` + `cursor_page` + `expandAllPhotos`.
3. Polls the Apify run every 20 seconds, with a maximum of 40 polls (about 13 minutes).
4. Reads up to 1,000 dataset items.
5. Checks whether the dataset contains post rows.
6. Normalizes the useful post fields.
7. Appends or updates the Google Sheet by `source_post_id`.
8. Sends a compact success, empty-result, missing-key, or failure message to a Slack incoming webhook.

The template deliberately uses one group and one small charge cap. Increase `maxPostsPerGroup` and `maxTotalChargeUsd` only after a manual run proves that the group is readable and the desired fields land in the sheet.

The cap is per Actor run, not a monthly budget. At six-hour scheduling, the template's upper bound is roughly `$1.00/day` if every run reaches its cap; actual spend can be lower.

## Prerequisites

- An Apify token with permission to run the Actor.
- A Google Sheet with a tab named `Posts` and this header row:

```text
created_at	group_name	author_name	post_text	post_url	source_post_id	reactions	comments	shares	media_final_count	media_review_severity	coverage_status
```

- A Google Sheets OAuth2 credential selected in the `Append or update Google Sheet` node.
- A Slack incoming webhook.
- These n8n environment variables:

```text
APIFY_TOKEN=apify_api_...
GROUP_SHEET_ID=your_google_sheet_id
GROUP_SHEET_NAME=Posts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

`GROUP_SHEET_NAME` defaults to `Posts` when omitted. The workflow never contains the Apify token or webhook URL.

## Import

1. Download [`group-to-google-sheets-slack.json`](n8n/group-to-google-sheets-slack.json).
2. In n8n, choose **Workflows -> Import from File**.
3. Select the Google Sheets credential in the sheet node.
4. Set the environment variables above on the n8n instance.
5. Open `Configure safe run` and replace the example group URL.
6. Run manually once and inspect both the Apify dataset and the Google Sheet.
7. Activate the workflow only after the manual run succeeds.

Direct link for a public import:

```text
https://raw.githubusercontent.com/spbotdel/facebook-group-posts-all-photos-scraper/main/docs/n8n/group-to-google-sheets-slack.json
```

## Output contract

`Append or update Google Sheet` matches on `source_post_id`, so repeated scheduled runs update an existing post instead of appending a second copy. When Facebook does not expose a stable post ID, the normalization step falls back to `source_url`; a row with neither value is skipped and reported through the missing-key Slack warning instead of being accepted as a normal row.

The workflow's success message is operational, not a data-quality certificate. Before treating a run as complete, inspect `coverage_status`, `media_review_severity`, the Apify `SUMMARY` record, and the group-level warnings described in the main README.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Run stays in `RUNNING` | The workflow polls up to 40 times, then reports the run as unfinished; inspect the Apify run instead of letting the schedule overlap. |
| Slack receives a failure message | Read the Apify run status and dataset diagnostics; do not retry blindly. |
| Sheet has no rows | Confirm the tab exists, the header names match, and the Google Sheets credential is selected. |
| Slack says the run succeeded with 0 posts | Inspect `SUMMARY` and `coverage_status`; do not interpret a zero-row run as a healthy empty group. |
| `blocked_login_wall` | Facebook temporarily refused the public group; retry with a fresh run, not by treating the group as empty. |
| More than 1,000 posts | This starter template reads one dataset page. Keep the default 50 posts or add dataset pagination before increasing the limit. |

## Limits

- Public groups only.
- The Actor returns photo URLs, not downloaded image files.
- The example group URL is a placeholder and must be replaced.
- The template uses `$env` expressions, which require a self-hosted n8n instance with environment access enabled. If your n8n setup does not expose `$env`, replace those expressions with n8n credentials or workflow variables.
