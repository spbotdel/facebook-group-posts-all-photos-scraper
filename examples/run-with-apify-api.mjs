const token = process.env.APIFY_TOKEN;
if (!token) {
    throw new Error('Set APIFY_TOKEN before running this example.');
}

const actorId = 'spbotdel~facebook-group-posts-all-photos-scraper';

const input = {
    groupUrls: ['https://www.facebook.com/groups/1564552680458634/'],
    maxPostsPerGroup: 10,
    sortMode: 'CHRONOLOGICAL',
    paginationMode: 'cursor_page',
    expandAllPhotos: true,
};

async function apifyJson(url, options = {}) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}token=${token}`, options);
    if (!response.ok) {
        throw new Error(`Apify API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
}

const run = await apifyJson(`https://api.apify.com/v2/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
});

let finished = run.data;
while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(finished.status)) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = await apifyJson(`https://api.apify.com/v2/actor-runs/${run.data.id}`);
    finished = status.data;
    console.error(`Run ${finished.id}: ${finished.status}`);
}

if (finished.status !== 'SUCCEEDED') {
    throw new Error(`Run finished with status ${finished.status}`);
}

const dataset = await apifyJson(`https://api.apify.com/v2/datasets/${finished.defaultDatasetId}/items?limit=3&clean=true`);
const summary = await apifyJson(`https://api.apify.com/v2/key-value-stores/${finished.defaultKeyValueStoreId}/records/SUMMARY`);

console.log(JSON.stringify({
    runId: finished.id,
    sampleItems: dataset,
    summary,
}, null, 2));
