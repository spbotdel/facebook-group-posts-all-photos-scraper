const MAX_APIFY_PROXY_SESSION_ID_LENGTH = 50;

export function buildProxySessionId(reason = 'initial', attempt = 1, now = Date.now()) {
    const safeReason = String(reason || 'initial')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 22) || 'initial';
    const safeAttempt = Number.isFinite(Number(attempt)) ? Math.max(0, Math.trunc(Number(attempt))) : 0;
    const timePart = Math.max(0, Math.trunc(Number(now) || Date.now())).toString(36);
    return `fb_gp_${safeReason}_${timePart}_${safeAttempt}`.slice(0, MAX_APIFY_PROXY_SESSION_ID_LENGTH);
}

export { MAX_APIFY_PROXY_SESSION_ID_LENGTH };
