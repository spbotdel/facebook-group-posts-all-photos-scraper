function parseDateBoundary(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid ${fieldName}: ${value}. Expected an ISO date/time or datepicker value.`);
    }
    return {
        input: value,
        timestamp,
        iso: new Date(timestamp).toISOString(),
    };
}

export function readDateRange(input = {}) {
    const explicitNewerThan = parseDateBoundary(input.onlyPostsNewerThan, 'onlyPostsNewerThan');
    const legacySinceDate = parseDateBoundary(input.sinceDate, 'sinceDate');
    if (
        explicitNewerThan
        && legacySinceDate
        && explicitNewerThan.timestamp !== legacySinceDate.timestamp
    ) {
        throw new Error('onlyPostsNewerThan conflicts with legacy sinceDate. Provide one value or make both dates identical.');
    }

    const onlyPostsNewerThan = explicitNewerThan || legacySinceDate;
    const onlyPostsOlderThan = parseDateBoundary(input.onlyPostsOlderThan, 'onlyPostsOlderThan');
    if (
        onlyPostsNewerThan
        && onlyPostsOlderThan
        && onlyPostsNewerThan.timestamp >= onlyPostsOlderThan.timestamp
    ) {
        throw new Error('Invalid date range: onlyPostsNewerThan must be earlier than onlyPostsOlderThan.');
    }

    return {
        onlyPostsNewerThan,
        onlyPostsOlderThan,
        newerThanSource: explicitNewerThan ? 'onlyPostsNewerThan' : (legacySinceDate ? 'sinceDate' : null),
    };
}

export function dateRangeHit(timestamp, dateRange) {
    if (!Number.isFinite(timestamp)) return null;

    if (
        dateRange?.onlyPostsOlderThan
        && timestamp >= dateRange.onlyPostsOlderThan.timestamp
    ) {
        return {
            type: 'newer_than_or_equal_to_only_posts_older_than',
            kind: 'upper_date',
            action: 'skip',
            onlyPostsOlderThan: dateRange.onlyPostsOlderThan.iso,
        };
    }

    if (
        dateRange?.onlyPostsNewerThan
        && timestamp < dateRange.onlyPostsNewerThan.timestamp
    ) {
        return {
            type: dateRange.newerThanSource === 'sinceDate'
                ? 'older_than_since_date'
                : 'older_than_only_posts_newer_than',
            kind: 'lower_date',
            action: 'stop',
            onlyPostsNewerThan: dateRange.onlyPostsNewerThan.iso,
            sinceDate: dateRange.newerThanSource === 'sinceDate'
                ? dateRange.onlyPostsNewerThan.iso
                : undefined,
        };
    }

    return null;
}
