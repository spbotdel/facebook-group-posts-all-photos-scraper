import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProxySessionId, MAX_APIFY_PROXY_SESSION_ID_LENGTH } from '../src/proxySession.js';

test('buildProxySessionId stays within Apify proxy session length limit', () => {
    const sessionId = buildProxySessionId('graphql_error_123456789_recovery_session_with_extra_words', 12, 1781801190474);
    assert.ok(sessionId.length <= MAX_APIFY_PROXY_SESSION_ID_LENGTH);
    assert.match(sessionId, /^[a-zA-Z0-9_-]+$/);
});

test('buildProxySessionId keeps short readable reason and attempt', () => {
    const sessionId = buildProxySessionId('empty_page_67_1', 2, 1781801190474);
    assert.ok(sessionId.includes('empty_page_67_1'));
    assert.ok(sessionId.endsWith('_2'));
});
