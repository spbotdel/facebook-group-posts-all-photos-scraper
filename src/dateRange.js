function relativeDateToIso(value, now = Date.now()) {
    const match = String(value ?? '').trim().match(
        /^(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i,
    );
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = {
        minute: 60 * 1000,
        minutes: 60 * 1000,
        hour: 60 * 60 * 1000,
        hours: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        months: 30 * 24 * 60 * 60 * 1000,
    };
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const timestamp = now - amount * multipliers[unit];
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;
    return new Date(timestamp).toISOString();
}

function normalizeDateString(value) {
    const text = String(value).trim();
    // Offsetless ISO datetimes are interpreted in the host timezone by Date.parse.
    // Treat them as UTC to keep Apify runs deterministic across machines.
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)
        ? `${text}Z`
        : text;
}

function parseDateBoundary(value, fieldName, now = Date.now()) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
        throw new Error(`Invalid ${fieldName}: expected a string date or relative duration.`);
    }
    const relative = relativeDateToIso(value, now);
    const timestamp = Date.parse(relative || normalizeDateString(value));
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) {
        throw new Error(`Invalid ${fieldName}: ${value}. Expected an ISO date/time or datepicker value.`);
    }
    return {
        input: value,
        timestamp,
        iso: new Date(timestamp).toISOString(),
    };
}

export function readDateRange(input = {}, now = Date.now()) {
    const explicitNewerThan = parseDateBoundary(input.onlyPostsNewerThan, 'onlyPostsNewerThan', now);
    const legacySinceDate = parseDateBoundary(input.sinceDate, 'sinceDate', now);
    if (
        explicitNewerThan
        && legacySinceDate
        && explicitNewerThan.timestamp !== legacySinceDate.timestamp
    ) {
        throw new Error('onlyPostsNewerThan conflicts with legacy sinceDate. Provide one value or make both dates identical.');
    }

    const onlyPostsNewerThan = explicitNewerThan || legacySinceDate;
    const onlyPostsOlderThan = parseDateBoundary(input.onlyPostsOlderThan, 'onlyPostsOlderThan', now);
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
