export function legacyMediaCompleteness({ feedImages, expandedImages, expansionAttempted }) {
    if (!feedImages.length && !expandedImages.length) return 'none';
    if (expandedImages.length && expandedImages.length >= feedImages.length) return 'expanded';
    if (expansionAttempted && expandedImages.length) return 'partial_expansion';
    if (expansionAttempted) return 'failed_expansion';
    return 'preview_only';
}

export function mediaCompleteness({ feedImages, expandedImages, expansionAttempted, mediaSetTokens }) {
    const feedCount = feedImages.length;
    const expandedCount = expandedImages.length;
    const tokenCount = mediaSetTokens.length;

    if (!feedCount && !expandedCount) return 'none';
    if (expandedCount && expandedCount >= feedCount) return 'expanded';
    if (expandedCount && expandedCount < feedCount) return 'feed_preserved_after_partial_expansion';
    if (expansionAttempted && tokenCount && feedCount >= 5) return 'likely_incomplete_plusN';
    if (expansionAttempted && tokenCount) return 'media_set_failed_feed_fallback';
    if (feedCount > 0) return 'feed_complete';
    return 'unknown';
}

function numericMediaCount(row, flatKey, nestedKey) {
    const value = row?.[flatKey] ?? row?.media_counts?.[nestedKey] ?? 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function mediaReviewSeverity(row) {
    const status = row?.media_completeness || 'unknown';
    const legacyStatus = row?.media_completeness_legacy || status;
    const previewCount = numericMediaCount(row, 'media_preview_count', 'feed_photo_count');
    const expandedCount = numericMediaCount(row, 'media_expanded_count', 'expanded_photo_count');

    if (status === 'likely_incomplete_plusN') return 'high';
    if (status === 'media_set_failed_feed_fallback') return previewCount >= 5 ? 'high' : 'low';
    if (legacyStatus === 'failed_expansion') return previewCount >= 5 ? 'high' : 'low';
    if (
        status === 'feed_preserved_after_partial_expansion'
        || status === 'expanded_partial'
        || legacyStatus === 'partial_expansion'
    ) {
        return previewCount >= 5 && expandedCount < previewCount ? 'medium' : 'low';
    }
    return 'none';
}

export function isMediaExpansionProblem(row) {
    return mediaReviewSeverity(row) === 'high';
}

export function isMediaExpansionRetryCandidate(row) {
    return mediaReviewSeverity(row) === 'high';
}

export function createMediaExpansionController({
    requestedConcurrency,
    enabled,
    minConcurrency = 3,
    windowSize = 40,
    minSamples = 20,
    problemRateThreshold = 0.15,
    likelyIncompleteThreshold = 3,
} = {}) {
    const requested = Math.max(1, Number(requestedConcurrency) || 1);
    const minimum = Math.max(1, Math.min(requested, Number(minConcurrency) || 1));
    const state = {
        requestedConcurrency: requested,
        currentConcurrency: requested,
        minConcurrency: minimum,
        adaptiveEnabled: Boolean(enabled) && requested > minimum,
        windowSize,
        minSamples,
        problemRateThreshold,
        likelyIncompleteThreshold,
        observedAttempted: 0,
        observedProblems: 0,
        decisions: [],
    };
    const window = [];

    function snapshot() {
        return {
            ...state,
            recentWindow: {
                attempted: window.length,
                problems: window.filter((item) => item.problem).length,
                likelyIncomplete: window.filter((item) => item.likelyIncomplete).length,
            },
        };
    }

    return {
        get currentConcurrency() {
            return state.currentConcurrency;
        },
        get adaptiveEnabled() {
            return state.adaptiveEnabled;
        },
        recordRows(rows, context = {}) {
            const attemptedRows = rows.filter((row) => row?.media_expansion?.attempted);
            for (const row of attemptedRows) {
                const problem = isMediaExpansionProblem(row);
                const likelyIncomplete = row.media_completeness === 'likely_incomplete_plusN';
                window.push({ problem, likelyIncomplete });
                if (window.length > windowSize) window.shift();
                state.observedAttempted += 1;
                if (problem) state.observedProblems += 1;
            }

            if (!state.adaptiveEnabled || state.currentConcurrency <= state.minConcurrency) return null;
            if (window.length < minSamples) return null;

            const recentProblems = window.filter((item) => item.problem).length;
            const recentLikelyIncomplete = window.filter((item) => item.likelyIncomplete).length;
            const problemRate = recentProblems / window.length;
            if (problemRate < problemRateThreshold && recentLikelyIncomplete < likelyIncompleteThreshold) return null;

            const previousConcurrency = state.currentConcurrency;
            state.currentConcurrency = state.minConcurrency;
            const decision = {
                at: new Date().toISOString(),
                action: 'lower_concurrency',
                previousConcurrency,
                newConcurrency: state.currentConcurrency,
                reason: recentLikelyIncomplete >= likelyIncompleteThreshold
                    ? 'likely_incomplete_plusN_threshold'
                    : 'problem_rate_threshold',
                recentAttempted: window.length,
                recentProblems,
                recentLikelyIncomplete,
                problemRate: Number(problemRate.toFixed(4)),
                context,
            };
            state.decisions.push(decision);
            return decision;
        },
        snapshot,
    };
}
