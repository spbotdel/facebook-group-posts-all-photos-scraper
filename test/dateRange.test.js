import assert from 'node:assert/strict';
import test from 'node:test';
import { dateRangeHit, readDateRange } from '../src/dateRange.js';

test('reads the explicit lower and upper date boundaries', () => {
    const range = readDateRange({
        onlyPostsNewerThan: '2026-05-01T00:00:00Z',
        onlyPostsOlderThan: '2026-06-01T00:00:00Z',
    });

    assert.equal(range.onlyPostsNewerThan.iso, '2026-05-01T00:00:00.000Z');
    assert.equal(range.onlyPostsOlderThan.iso, '2026-06-01T00:00:00.000Z');
    assert.equal(range.newerThanSource, 'onlyPostsNewerThan');
});

test('keeps sinceDate as a backward-compatible lower-bound alias', () => {
    const range = readDateRange({ sinceDate: '2026-05-01' });

    assert.equal(range.onlyPostsNewerThan.iso, '2026-05-01T00:00:00.000Z');
    assert.equal(range.newerThanSource, 'sinceDate');
});

test('rejects conflicting lower-bound aliases', () => {
    assert.throws(
        () => readDateRange({
            onlyPostsNewerThan: '2026-05-01',
            sinceDate: '2026-05-02',
        }),
        /conflicts with legacy sinceDate/,
    );
});

test('rejects an empty or reversed date interval', () => {
    assert.throws(
        () => readDateRange({
            onlyPostsNewerThan: '2026-06-01',
            onlyPostsOlderThan: '2026-06-01',
        }),
        /must be earlier/,
    );
});

test('classifies the date interval as lower-inclusive and upper-exclusive', () => {
    const range = readDateRange({
        onlyPostsNewerThan: '2026-05-01T00:00:00Z',
        onlyPostsOlderThan: '2026-06-01T00:00:00Z',
    });

    assert.equal(dateRangeHit(Date.parse('2026-05-01T00:00:00Z'), range), null);
    assert.equal(dateRangeHit(Date.parse('2026-05-15T00:00:00Z'), range), null);
    assert.deepEqual(
        dateRangeHit(Date.parse('2026-06-01T00:00:00Z'), range),
        {
            type: 'newer_than_or_equal_to_only_posts_older_than',
            kind: 'upper_date',
            action: 'skip',
            onlyPostsOlderThan: '2026-06-01T00:00:00.000Z',
        },
    );
    assert.equal(dateRangeHit(Date.parse('2026-04-30T23:59:59Z'), range)?.action, 'stop');
});

test('does not reject posts whose Facebook timestamp is unavailable', () => {
    const range = readDateRange({ onlyPostsOlderThan: '2026-06-01' });
    assert.equal(dateRangeHit(null, range), null);
});

test('accepts relative lower date boundaries', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const range = readDateRange({ onlyPostsNewerThan: '30 days' }, now);

    assert.equal(range.onlyPostsNewerThan.iso, '2026-09-24T12:00:00.000Z');
    assert.equal(range.onlyPostsNewerThan.input, '30 days');
});

test('accepts relative hour and week boundaries', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');

    assert.equal(
        readDateRange({ onlyPostsNewerThan: '12 hours' }, now).onlyPostsNewerThan.iso,
        '2026-10-24T00:00:00.000Z',
    );
    assert.equal(
        readDateRange({ onlyPostsNewerThan: '2 weeks' }, now).onlyPostsNewerThan.iso,
        '2026-10-10T12:00:00.000Z',
    );
});

test('accepts a relative lower boundary with an absolute upper boundary', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const range = readDateRange({
        onlyPostsNewerThan: '30 days',
        onlyPostsOlderThan: '2026-10-20T00:00:00Z',
    }, now);

    assert.equal(range.onlyPostsNewerThan.iso, '2026-09-24T12:00:00.000Z');
    assert.equal(range.onlyPostsOlderThan.iso, '2026-10-20T00:00:00.000Z');
});

test('accepts a relative upper boundary', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const range = readDateRange({ onlyPostsOlderThan: '12 hours' }, now);

    assert.equal(range.onlyPostsOlderThan.iso, '2026-10-24T00:00:00.000Z');
});

test('rejects overflowing relative durations with a clean error', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');

    assert.throws(
        () => readDateRange({ onlyPostsNewerThan: '999999999 days' }, now),
        /Invalid onlyPostsNewerThan/,
    );
    assert.throws(
        () => readDateRange({ onlyPostsNewerThan: '9999999 months' }, now),
        /Invalid onlyPostsNewerThan/,
    );
});

test('treats offsetless ISO datetimes as UTC', () => {
    const range = readDateRange({ onlyPostsNewerThan: '2026-05-01T00:00:00' });

    assert.equal(range.onlyPostsNewerThan.iso, '2026-05-01T00:00:00.000Z');
});

test('rejects numeric and zero relative boundaries', () => {
    assert.throws(
        () => readDateRange({ onlyPostsNewerThan: 0 }),
        /Invalid onlyPostsNewerThan/,
    );
    assert.throws(
        () => readDateRange({ onlyPostsNewerThan: '0 days' }),
        /Invalid onlyPostsNewerThan/,
    );
    assert.throws(
        () => readDateRange({ onlyPostsNewerThan: '1d' }),
        /Invalid onlyPostsNewerThan/,
    );
});
