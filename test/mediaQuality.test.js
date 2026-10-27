import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createMediaExpansionController,
    isMediaExpansionRetryCandidate,
    legacyMediaCompleteness,
    mediaCompleteness,
    mediaReviewSeverity,
} from '../src/mediaQuality.js';

test('mediaCompleteness separates feed fallback from likely incomplete +N posts', () => {
    assert.equal(
        mediaCompleteness({
            feedImages: ['a', 'b', 'c'],
            expandedImages: [],
            expansionAttempted: true,
            mediaSetTokens: ['pcb.1'],
        }),
        'media_set_failed_feed_fallback',
    );

    assert.equal(
        mediaCompleteness({
            feedImages: ['a', 'b', 'c', 'd', 'e'],
            expandedImages: [],
            expansionAttempted: true,
            mediaSetTokens: ['pcb.1'],
        }),
        'likely_incomplete_plusN',
    );
});

test('mediaCompleteness marks partial expansion as feed-preserved instead of a hard problem', () => {
    assert.equal(
        mediaCompleteness({
            feedImages: ['a', 'b', 'c'],
            expandedImages: ['a', 'b'],
            expansionAttempted: true,
            mediaSetTokens: ['pcb.1'],
        }),
        'feed_preserved_after_partial_expansion',
    );
});

test('legacyMediaCompleteness keeps old benchmark buckets available', () => {
    assert.equal(
        legacyMediaCompleteness({
            feedImages: ['a', 'b', 'c', 'd', 'e'],
            expandedImages: [],
            expansionAttempted: true,
        }),
        'failed_expansion',
    );
});

test('media expansion controller lowers concurrency when recent +N risk is high', () => {
    const controller = createMediaExpansionController({
        requestedConcurrency: 5,
        enabled: true,
        minConcurrency: 3,
        minSamples: 4,
        likelyIncompleteThreshold: 2,
    });

    const decision = controller.recordRows([
        { media_expansion: { attempted: true }, media_completeness: 'expanded' },
        { media_expansion: { attempted: true }, media_completeness: 'likely_incomplete_plusN' },
        { media_expansion: { attempted: true }, media_completeness: 'expanded' },
        { media_expansion: { attempted: true }, media_completeness: 'likely_incomplete_plusN' },
    ]);

    assert.equal(controller.currentConcurrency, 3);
    assert.equal(decision.action, 'lower_concurrency');
    assert.equal(decision.reason, 'likely_incomplete_plusN_threshold');
});

test('isMediaExpansionRetryCandidate selects only risky media rows', () => {
    assert.equal(isMediaExpansionRetryCandidate({ media_completeness: 'likely_incomplete_plusN' }), true);
    assert.equal(isMediaExpansionRetryCandidate({ media_completeness: 'feed_preserved_after_partial_expansion' }), false);
    assert.equal(isMediaExpansionRetryCandidate({
        media_completeness: 'media_set_failed_feed_fallback',
        media_preview_count: 3,
    }), false);
    assert.equal(isMediaExpansionRetryCandidate({
        media_completeness: 'media_set_failed_feed_fallback',
        media_preview_count: 5,
    }), true);
    assert.equal(isMediaExpansionRetryCandidate({ media_completeness: 'feed_complete' }), false);
    assert.equal(isMediaExpansionRetryCandidate({ media_completeness: 'expanded' }), false);
});

test('mediaReviewSeverity separates high-risk retry rows from audit-only rows', () => {
    assert.equal(mediaReviewSeverity({ media_completeness: 'likely_incomplete_plusN' }), 'high');
    assert.equal(mediaReviewSeverity({
        media_completeness: 'media_set_failed_feed_fallback',
        media_preview_count: 4,
    }), 'low');
    assert.equal(mediaReviewSeverity({
        media_completeness: 'media_set_failed_feed_fallback',
        media_preview_count: 5,
    }), 'high');
    assert.equal(mediaReviewSeverity({
        media_completeness: 'feed_preserved_after_partial_expansion',
        media_preview_count: 6,
        media_expanded_count: 4,
    }), 'medium');
    assert.equal(mediaReviewSeverity({ media_completeness: 'feed_complete' }), 'none');
});
