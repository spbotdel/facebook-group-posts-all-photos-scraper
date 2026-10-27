export const MAX_POSTS_PER_GROUP = 1000;
export const MAX_GRAPHQL_PAGES = 500;
export const MAX_CANDIDATE_POSTS = 3000;

export function readMaxCandidatesSetting(input, maxPosts) {
    const hasValue = input.maxCandidates !== undefined && input.maxCandidates !== null && input.maxCandidates !== '';
    const raw = hasValue ? Number(input.maxCandidates) : 0;
    if (!Number.isFinite(raw)) throw new Error('Invalid maxCandidates: expected a number.');
    if (!Number.isInteger(raw)) throw new Error('Invalid maxCandidates: expected an integer.');
    if (raw === 0) {
        return Math.min(MAX_CANDIDATE_POSTS, Math.max(maxPosts * 3, maxPosts + 20, maxPosts));
    }
    if (raw < maxPosts || raw > MAX_CANDIDATE_POSTS) {
        throw new Error(`Invalid maxCandidates: ${raw}. Supported range is ${maxPosts}..${MAX_CANDIDATE_POSTS}; use 0 for auto.`);
    }
    return raw;
}

export function readMaxPagesSetting(input, maxPosts) {
    const hasValue = input.maxPages !== undefined && input.maxPages !== null && input.maxPages !== '';
    const raw = hasValue ? Number(input.maxPages) : 0;
    if (!Number.isFinite(raw)) throw new Error('Invalid maxPages: expected a number.');
    if (!Number.isInteger(raw)) throw new Error('Invalid maxPages: expected an integer.');
    if (raw === 0) {
        return Math.min(MAX_GRAPHQL_PAGES, Math.max(20, Math.ceil(maxPosts * 0.85)));
    }
    if (raw < 1 || raw > MAX_GRAPHQL_PAGES) {
        throw new Error(`Invalid maxPages: ${raw}. Supported range is 0..${MAX_GRAPHQL_PAGES}; use 0 for auto.`);
    }
    return raw;
}

export function readMaxPaidDatasetItemsSetting(env = process.env) {
    const rawValue = env?.actorMaxPaidDatasetItems ?? env?.ACTOR_MAX_PAID_DATASET_ITEMS;
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;

    const raw = Number(rawValue);
    if (!Number.isFinite(raw)) throw new Error('Invalid ACTOR_MAX_PAID_DATASET_ITEMS: expected a number.');
    if (!Number.isInteger(raw)) throw new Error('Invalid ACTOR_MAX_PAID_DATASET_ITEMS: expected an integer.');
    if (raw < 0) throw new Error('Invalid ACTOR_MAX_PAID_DATASET_ITEMS: expected a non-negative integer.');
    return raw;
}
