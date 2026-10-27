import test from 'node:test';
import assert from 'node:assert/strict';

import {
    readMaxCandidatesSetting,
    readMaxPagesSetting,
    readMaxPaidDatasetItemsSetting,
} from '../src/settings.js';

test('readMaxCandidatesSetting uses auto candidate budget when empty or zero', () => {
    assert.equal(readMaxCandidatesSetting({}, 30), 90);
    assert.equal(readMaxCandidatesSetting({ maxCandidates: 0 }, 160), 480);
    assert.equal(readMaxCandidatesSetting({ maxCandidates: '' }, 200), 600);
    assert.equal(readMaxCandidatesSetting({ maxCandidates: 0 }, 1000), 3000);
});

test('readMaxCandidatesSetting rejects explicit candidate budgets below target', () => {
    assert.equal(readMaxCandidatesSetting({ maxCandidates: 180 }, 160), 180);
    assert.throws(() => readMaxCandidatesSetting({ maxCandidates: 90 }, 160), /Supported range is 160..3000/);
    assert.throws(() => readMaxCandidatesSetting({ maxCandidates: 3001 }, 160), /Supported range/);
    assert.throws(() => readMaxCandidatesSetting({ maxCandidates: 1.5 }, 160), /integer/);
});

test('readMaxPagesSetting uses auto page budget when maxPages is empty or zero', () => {
    assert.equal(readMaxPagesSetting({}, 30), 26);
    assert.equal(readMaxPagesSetting({ maxPages: 0 }, 200), 170);
    assert.equal(readMaxPagesSetting({ maxPages: 0 }, 1000), 500);
    assert.equal(readMaxPagesSetting({ maxPages: '' }, 10), 20);
});

test('readMaxPagesSetting accepts explicit page budget up to product ceiling', () => {
    assert.equal(readMaxPagesSetting({ maxPages: 250 }, 200), 250);
    assert.equal(readMaxPagesSetting({ maxPages: 500 }, 200), 500);
});

test('readMaxPagesSetting rejects invalid page budgets', () => {
    assert.throws(() => readMaxPagesSetting({ maxPages: -1 }, 200), /Supported range/);
    assert.throws(() => readMaxPagesSetting({ maxPages: 501 }, 200), /Supported range/);
    assert.throws(() => readMaxPagesSetting({ maxPages: 1.5 }, 200), /integer/);
});

test('readMaxPaidDatasetItemsSetting accepts absent and explicit Apify paid result limits', () => {
    assert.equal(readMaxPaidDatasetItemsSetting({}), null);
    assert.equal(readMaxPaidDatasetItemsSetting({ ACTOR_MAX_PAID_DATASET_ITEMS: '0' }), 0);
    assert.equal(readMaxPaidDatasetItemsSetting({ ACTOR_MAX_PAID_DATASET_ITEMS: '25' }), 25);
    assert.equal(readMaxPaidDatasetItemsSetting({ actorMaxPaidDatasetItems: 30 }), 30);
});

test('readMaxPaidDatasetItemsSetting rejects invalid paid result limits', () => {
    assert.throws(() => readMaxPaidDatasetItemsSetting({ ACTOR_MAX_PAID_DATASET_ITEMS: 'abc' }), /expected a number/);
    assert.throws(() => readMaxPaidDatasetItemsSetting({ ACTOR_MAX_PAID_DATASET_ITEMS: '1.5' }), /integer/);
    assert.throws(() => readMaxPaidDatasetItemsSetting({ ACTOR_MAX_PAID_DATASET_ITEMS: '-1' }), /non-negative/);
});
