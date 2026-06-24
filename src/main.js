import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';
import { cleanImageUrls, extractImageUrlsFromHtml, mediaKey, normalizeHtml } from './htmlMedia.js';
import {
    createMediaExpansionController,
    isMediaExpansionRetryCandidate,
    legacyMediaCompleteness,
    mediaCompleteness as classifyMediaCompleteness,
    mediaReviewSeverity,
} from './mediaQuality.js';
import { buildProxySessionId } from './proxySession.js';
import {
    MAX_POSTS_PER_GROUP,
    readMaxCandidatesSetting,
    readMaxPagesSetting,
    readMaxPaidDatasetItemsSetting,
} from './settings.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const QUERY_NAME = 'GroupsCometFeedRegularStoriesPaginationQuery';
const PROVIDER_NAME = 'dachapify_facebook_group_posts_all_photos';
const ACTOR_VERSION = '0.3.0-beta.0';
const DATASET_PUSH_BATCH_SIZE = 20;
const STATUS_UPDATE_POST_INTERVAL = 10;
const RUNTIME_STATE_KEY = 'RUNTIME_STATE';
const RUNTIME_STATE_VERSION = 3;
const RUNTIME_ROOT_STATE_VERSION = 1;
const MAX_GROUPS_PER_RUN = 10;
const FALLBACK_DOC_IDS = [
    '6617440634998224',
];
let runStatusPrefix = '';

function decodeEscapedText(value) {
    const text = normalizeHtml(value);
    if (!text) return null;
    if (!/\\u[0-9a-f]{4}|\\n|\\t|\\r/i.test(text)) return text;
    try {
        return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
    } catch {
        return text;
    }
}

function firstMatch(text, patterns, fallback = null) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1] !== undefined) return match[1];
    }
    return fallback;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function countBy(items, getKey) {
    const counts = {};
    for (const item of items || []) {
        const key = getKey(item);
        if (!key) continue;
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

async function setRunStatus(message) {
    try {
        await Actor.setStatusMessage(runStatusPrefix ? `${runStatusPrefix}: ${message}` : message);
    } catch (error) {
        log.debug('Could not update Actor status message', { message: error.message });
    }
}

function contextAround(text, needle, radius = 160) {
    const source = String(text || '');
    const index = source.indexOf(needle);
    if (index < 0) return null;
    return source.slice(Math.max(0, index - radius), Math.min(source.length, index + needle.length + radius));
}

function cleanDisplayName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || /^(error|facebook)$/i.test(text)) return null;
    return text;
}

function scanPaginationFields(responseText, parsedValues) {
    const text = String(responseText || '');
    const probes = [
        'page_info',
        'pageInfo',
        'end_cursor',
        'start_cursor',
        'has_next_page',
        'has_previous_page',
        'hasPreviousPage',
        'previous_cursor',
        'prev_cursor',
        '"before"',
        '"after"',
        '"cursor"',
    ];
    const textMatches = {};
    const contexts = {};
    for (const probe of probes) {
        const count = (text.match(new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        textMatches[probe] = count;
        if (count) contexts[probe] = contextAround(text, probe);
    }

    const keyHits = {};
    const seen = new Set();
    function walk(value, path = '', depth = 0) {
        if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.slice(0, 80).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            const lower = key.toLowerCase();
            if (
                lower.includes('cursor')
                || lower.includes('page_info')
                || lower.includes('pageinfo')
                || lower.includes('previous')
                || lower === 'before'
                || lower === 'after'
            ) {
                if (!keyHits[key]) keyHits[key] = [];
                if (keyHits[key].length < 8) {
                    keyHits[key].push({
                        path: path ? `${path}.${key}` : key,
                        value: typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean'
                            ? child
                            : (Array.isArray(child) ? `[array:${child.length}]` : '[object]'),
                    });
                }
            }
            walk(child, path ? `${path}.${key}` : key, depth + 1);
        }
    }
    for (const value of parsedValues || []) walk(value);

    return {
        textMatches,
        parsedKeyHits: keyHits,
        contexts,
    };
}

function readStartCursor(input) {
    if (typeof input.startCursor === 'string' && input.startCursor.trim()) return input.startCursor.trim();
    if (typeof input.cursor === 'string' && input.cursor.trim()) return input.cursor.trim();
    const pointer = input.pointer && typeof input.pointer === 'object' ? input.pointer : null;
    for (const key of ['nextCursor', 'cursor', 'endCursor']) {
        if (typeof pointer?.[key] === 'string' && pointer[key].trim()) return pointer[key].trim();
    }
    return null;
}

function parseSinceDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) {
        throw new Error(`Invalid sinceDate: ${value}. Expected an ISO date/time or datepicker value.`);
    }
    return {
        input: value,
        timestamp,
        iso: new Date(timestamp).toISOString(),
    };
}

function readKnownPostIds(input) {
    const values = [];
    if (Array.isArray(input.knownPostIds)) {
        for (const value of input.knownPostIds) {
            if (value !== undefined && value !== null && String(value).trim()) values.push(String(value).trim());
        }
    }
    const checkpoint = input.checkpoint && typeof input.checkpoint === 'object' ? input.checkpoint : null;
    for (const key of ['newest_seen_post_id', 'oldest_seen_post_id', 'last_seen_post_id']) {
        if (checkpoint?.[key]) values.push(String(checkpoint[key]).trim());
    }
    if (Array.isArray(checkpoint?.known_post_ids)) {
        for (const value of checkpoint.known_post_ids) {
            if (value !== undefined && value !== null && String(value).trim()) values.push(String(value).trim());
        }
    }
    return unique(values);
}

function checkpointForGroup(input, groupUrl) {
    const checkpoint = input.checkpoint && typeof input.checkpoint === 'object' ? input.checkpoint : null;
    if (!checkpoint) return null;
    const directMaps = [
        checkpoint.outputCheckpoints,
        checkpoint.checkpointsByGroup,
        checkpoint.groupCheckpoints,
    ];
    for (const map of directMaps) {
        if (map && typeof map === 'object' && !Array.isArray(map)) {
            if (map[groupUrl]) return map[groupUrl];
        }
    }
    if (Array.isArray(checkpoint.groups)) {
        return checkpoint.groups.find((entry) => (
            entry?.groupUrl === groupUrl
            || entry?.group_url === groupUrl
            || entry?.outputCheckpoint?.group_url === groupUrl
        ))?.outputCheckpoint || null;
    }
    if (checkpoint.groups && typeof checkpoint.groups === 'object') {
        const direct = checkpoint.groups[groupUrl];
        if (direct?.outputCheckpoint) return direct.outputCheckpoint;
        if (direct) return direct;
    }
    return null;
}

function readKnownPostIdsForGroup(input, groupUrl) {
    const values = readKnownPostIds(input);
    const checkpoint = checkpointForGroup(input, groupUrl);
    for (const key of ['newest_seen_post_id', 'oldest_seen_post_id', 'last_seen_post_id']) {
        if (checkpoint?.[key]) values.push(String(checkpoint[key]).trim());
    }
    if (Array.isArray(checkpoint?.known_post_ids)) {
        for (const value of checkpoint.known_post_ids) {
            if (value !== undefined && value !== null && String(value).trim()) values.push(String(value).trim());
        }
    }
    return unique(values);
}

function readStartCursorForGroup(input, groupUrl, groupCount) {
    const cursorMaps = [input.startCursorsByGroup, input.cursorsByGroup];
    for (const map of cursorMaps) {
        if (map && typeof map === 'object' && !Array.isArray(map) && typeof map[groupUrl] === 'string' && map[groupUrl].trim()) {
            return map[groupUrl].trim();
        }
    }
    const checkpoint = checkpointForGroup(input, groupUrl);
    if (typeof checkpoint?.next_backfill_cursor === 'string' && checkpoint.next_backfill_cursor.trim()) {
        return checkpoint.next_backfill_cursor.trim();
    }
    if (typeof checkpoint?.nextCursor === 'string' && checkpoint.nextCursor.trim()) return checkpoint.nextCursor.trim();
    if (typeof checkpoint?.cursor === 'string' && checkpoint.cursor.trim()) return checkpoint.cursor.trim();
    return groupCount === 1 ? readStartCursor(input) : null;
}

function postTimestampMs(post) {
    if (post?.created_at) {
        const parsed = Date.parse(post.created_at);
        if (Number.isFinite(parsed)) return parsed;
    }
    const unix = Number(post?.creation_time);
    if (Number.isFinite(unix) && unix > 0) return unix * 1000;
    return null;
}

function postBoundaryHit(post, boundary) {
    if (!post) return null;
    const postId = post.post_id ? String(post.post_id) : null;
    const postUrl = post.post_url ? String(post.post_url) : '';
    if (postId && boundary.knownPostIdSet?.has(postId)) {
        return {
            type: 'known_post_id',
            postId,
            createdAt: post.created_at || null,
        };
    }
    for (const known of boundary.knownPostIds || []) {
        if (known && postUrl.includes(known)) {
            return {
                type: 'known_post_url_fragment',
                postId,
                known,
                createdAt: post.created_at || null,
            };
        }
    }
    const timestamp = postTimestampMs(post);
    if (boundary.sinceDate && timestamp !== null && timestamp < boundary.sinceDate.timestamp) {
        return {
            type: 'older_than_since_date',
            postId,
            createdAt: post.created_at || null,
            sinceDate: boundary.sinceDate.iso,
        };
    }
    return null;
}

function splitPostsAtBoundary(posts, boundary, { stopAtBoundary }) {
    const accepted = [];
    const hits = [];
    let stopped = false;
    for (const [index, post] of posts.entries()) {
        const hit = postBoundaryHit(post, boundary);
        if (!hit) {
            if (!stopped) accepted.push(post);
            continue;
        }
        hits.push({ ...hit, index });
        if (stopAtBoundary) {
            stopped = true;
            break;
        }
    }
    return {
        posts: accepted,
        hits,
        stopped,
        discardedAfterBoundary: stopped ? Math.max(0, posts.length - accepted.length - 1) : 0,
    };
}

function numberSetting(input, key, fallback, min, max, { integer = false } = {}) {
    const hasValue = input[key] !== undefined && input[key] !== null && input[key] !== '';
    const number = hasValue
        ? Number(input[key])
        : Math.min(Math.max(fallback, min), max);
    if (!Number.isFinite(number)) throw new Error(`Invalid ${key}: expected a number.`);
    if (integer && !Number.isInteger(number)) throw new Error(`Invalid ${key}: expected an integer.`);
    if (number < min || number > max) {
        throw new Error(`Invalid ${key}: ${number}. Supported range is ${min}..${max}. Raise actor limits before running.`);
    }
    return number;
}


function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function resetRuntimeState(state, inputSignature) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, {
        version: RUNTIME_STATE_VERSION,
        actorVersion: ACTOR_VERSION,
        inputSignature,
        phase: 'initialized',
        createdAt: new Date().toISOString(),
        updatedAt: null,
        persistReason: null,
        migrationEvents: 0,
        resumed: false,
        feed: null,
        media: null,
    });
}

function resetRuntimeRootState(state, inputSignature) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, {
        rootVersion: RUNTIME_ROOT_STATE_VERSION,
        actorVersion: ACTOR_VERSION,
        inputSignature,
        phase: 'initialized',
        createdAt: new Date().toISOString(),
        updatedAt: null,
        persistReason: null,
        migrationEvents: 0,
        groups: {},
        finishedGroups: [],
    });
}

function runtimeGroupKey(groupUrl, groupIndex) {
    return `${groupIndex + 1}:${groupUrl}`;
}

function attachRuntimeRoot(groupState, rootState) {
    Object.defineProperty(groupState, '__rootState', {
        value: rootState,
        enumerable: false,
        configurable: true,
    });
    return groupState;
}

async function persistRuntimeState(state, reason) {
    state.updatedAt = new Date().toISOString();
    state.persistReason = reason;
    const persistedState = state.__rootState || state;
    if (persistedState !== state) {
        persistedState.updatedAt = state.updatedAt;
        persistedState.persistReason = reason;
    }
    try {
        await Actor.setValue(RUNTIME_STATE_KEY, JSON.parse(JSON.stringify(persistedState)));
    } catch (error) {
        log.warning('Could not persist runtime state', { reason, message: error.message });
    }
}

function postsSignature(posts) {
    return stableStringify((posts || []).map((post) => [
        post?.post_id || null,
        post?.creation_time || null,
    ]));
}

function absolutize(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://www.facebook.com${url}`;
    return url;
}

function extractAssetUrls(html) {
    const decoded = normalizeHtml(html);
    const urls = [];
    for (const match of decoded.matchAll(/<link[^>]+(?:rel=["']preload["'][^>]+href|href=["']([^"']+)["'][^>]+rel=["']preload["'])[^>]*>/gi)) {
        if (match[1]) urls.push(absolutize(match[1]));
    }
    for (const match of decoded.matchAll(/(?:href|src)=["']([^"']+\.js[^"']*)["']/gi)) {
        urls.push(absolutize(match[1]));
    }
    for (const match of decoded.matchAll(/https?:\/\/static\.[^"'<>\\\s]+?\.js[^"'<>\\\s]*/gi)) {
        urls.push(normalizeHtml(match[0]));
    }
    return unique(urls).filter((url) => /(?:\.js|rsrc\.php)/i.test(url));
}

function extractDocIdFromBundle(text) {
    const decoded = normalizeHtml(text);
    const idx = decoded.indexOf(QUERY_NAME);
    if (idx < 0) return null;
    const windowText = decoded.slice(Math.max(0, idx - 1500), idx + 2500);
    return firstMatch(windowText, [
        /e\.exports\s*=\s*["'](\d{8,})["']/,
        /["']doc_id["']\s*:\s*["'](\d{8,})["']/,
        /doc_id=(\d{8,})/,
        /["'](\d{8,})["'][^"']{0,120}GroupsCometFeedRegularStoriesPaginationQuery/,
        /GroupsCometFeedRegularStoriesPaginationQuery[^"']{0,300}["'](\d{8,})["']/,
    ]);
}

function extractBootstrap(html, finalUrl) {
    const decoded = normalizeHtml(html);
    const title = decodeEscapedText(firstMatch(decoded, [/<title[^>]*>(.*?)<\/title>/is]));
    const groupName = decodeEscapedText(firstMatch(decoded, [/"meta":\{"title":"([^"]+)"/, /<title[^>]*>(.*?)<\/title>/is]));
    const groupIdFromUrl = firstMatch(finalUrl, [/\/groups\/([^/?#]+)/]);
    const groupId = firstMatch(decoded, [/"groupID":"?(\d+)"?/, /"group_id":"?(\d+)"?/], /^\d+$/.test(groupIdFromUrl || '') ? groupIdFromUrl : null);
    const hasLoginWall = !groupId && /you must log in|log in to facebook to start sharing|login_required|checkpoint/i.test(decoded);
    return {
        title: cleanDisplayName(title),
        lsd: firstMatch(decoded, [
            /"LSD",\[\],\{"token":"([^"]+)"/,
            /"token":"([^"]+)","async_get_token"/,
            /name="lsd"\s+value="([^"]+)"/,
        ]),
        jazoest: firstMatch(decoded, [
            /&jazoest=(\d+)"/,
            /name="jazoest"\s+value="([^"]+)"/,
        ]),
        av: firstMatch(decoded, [/__user=(\d+)&/, /"USER_ID":"(\d+)"/], '0'),
        user: firstMatch(decoded, [/__user=(\d+)&/, /"USER_ID":"(\d+)"/], '0'),
        a: firstMatch(decoded, [/__a=(\d+)&/], '1'),
        hs: firstMatch(decoded, [/"haste_session":"([^"]+)"/]),
        dpr: firstMatch(decoded, [/"pr":([0-9.]+)/], '1'),
        ccg: firstMatch(decoded, [/"connectionClass":"([^"]+)"/], 'EXCELLENT'),
        rev: firstMatch(decoded, [/"__spin_r":(\d+)/, /\{"rev":(\d+)\}/]),
        hsi: firstMatch(decoded, [/"hsi":"([^"]+)"/]),
        cometReq: firstMatch(decoded, [/__comet_req=(\d+)&/], '15'),
        spinR: firstMatch(decoded, [/"__spin_r":(\d+)/]),
        spinB: firstMatch(decoded, [/"__spin_b":"([^"]+)"/]),
        spinT: firstMatch(decoded, [/"__spin_t":(\d+)/]),
        groupId,
        groupName: cleanDisplayName(groupName),
        vanity: firstMatch(decoded, [/"idorvanity":"([^"]+)"/]),
        feedLocation: firstMatch(decoded, [/"feedLocation":"([^"]+)"/], 'GROUP'),
        feedType: firstMatch(decoded, [/"feedType":"([^"]+)"/], 'DISCUSSION'),
        hasLoginWall,
        htmlLength: html.length,
    };
}

function buildVariables(bootstrap, cursor = null, count = 10, sortingSetting = null) {
    return {
        UFI2CommentsProvider_commentsKey: 'CometGroupDiscussionRootSuccessQuery',
        count,
        cursor,
        id: bootstrap.groupId,
        feedLocation: bootstrap.feedLocation || 'GROUP',
        feedType: bootstrap.feedType || 'DISCUSSION',
        renderLocation: 'group',
        stream_initial_count: 1,
        feedbackSource: 0,
        focusCommentID: null,
        scale: 1.5,
        sortingSetting,
        useDefaultActor: false,
        privacySelectorRenderLocation: 'COMET_STREAM',
        __relay_internal__pv__IsWorkUserrelayprovider: false,
        __relay_internal__pv__IsMergQAPollsrelayprovider: false,
        __relay_internal__pv__CometUFIIsRTAEnabledrelayprovider: false,
        __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: false,
        __relay_internal__pv__StoriesRingrelayprovider: false,
        displayCommentsContextEnableComment: null,
        displayCommentsContextIsAdPreview: null,
        displayCommentsContextIsAggregatedShare: null,
        displayCommentsContextIsStorySet: null,
        displayCommentsFeedbackContext: null,
    };
}

function buildPostBody(bootstrap, docId, variables) {
    const data = {
        av: bootstrap.av || '0',
        __user: bootstrap.user || '0',
        __a: bootstrap.a || '1',
        __req: '1',
        __hs: bootstrap.hs || '',
        dpr: bootstrap.dpr || '1',
        __ccg: bootstrap.ccg || 'EXCELLENT',
        __rev: bootstrap.rev || bootstrap.spinR || '',
        __hsi: bootstrap.hsi || '',
        __comet_req: bootstrap.cometReq || '15',
        lsd: bootstrap.lsd || '',
        jazoest: bootstrap.jazoest || '',
        __spin_r: bootstrap.spinR || bootstrap.rev || '',
        __spin_b: bootstrap.spinB || 'trunk',
        __spin_t: bootstrap.spinT || Math.floor(Date.now() / 1000).toString(),
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: QUERY_NAME,
        variables: JSON.stringify(variables),
        server_timestamps: 'true',
        doc_id: docId,
    };
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value !== null && value !== undefined) body.set(key, String(value));
    }
    return body;
}

async function fetchText(client, url, options = {}) {
    const { timeout = 30000, ...requestOptions } = options;
    const response = await client(url, {
        throwHttpErrors: false,
        timeout: typeof timeout === 'number' ? { request: timeout } : timeout,
        followRedirect: true,
        ...requestOptions,
    });
    return response;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverDocId(client, html, debug, discoverBundles) {
    const pageDocId = extractDocIdFromBundle(html);
    if (pageDocId || !discoverBundles) {
        return { docId: pageDocId, source: pageDocId ? 'homepage' : null, checked: debug ? [] : undefined };
    }
    const urls = extractAssetUrls(html).slice(0, 60);
    const checked = [];
    for (const url of urls) {
        try {
            const response = await fetchText(client, url, {
                headers: {
                    accept: '*/*',
                    referer: 'https://www.facebook.com/',
                },
                timeout: 20000,
            });
            const body = response.body || '';
            const docId = extractDocIdFromBundle(body);
            checked.push({ url, statusCode: response.statusCode, length: body.length, found: Boolean(docId) });
            if (docId) return { docId, source: 'bundle', checked: debug ? checked : undefined };
        } catch (error) {
            checked.push({ url, error: error.message });
        }
    }
    return { docId: null, source: null, checked: debug ? checked : undefined };
}

function parseJsonPayload(text) {
    const cleaned = String(text || '').replace(/^for\s*\(;;\);/, '');
    const values = [];
    const errors = [];
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines.length ? lines : [cleaned]) {
        try {
            values.push(JSON.parse(line));
        } catch (error) {
            errors.push(error.message);
        }
    }
    return { values, errors: unique(errors).slice(0, 5) };
}

function getPath(obj, path) {
    let cur = obj;
    for (const part of path) {
        if (cur == null) return undefined;
        cur = cur[part];
    }
    return cur;
}

function collectMedia(obj) {
    const urls = [];
    const tokens = [];
    const walk = (value) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.uri === 'string' && /(?:fbcdn|scontent)/i.test(value.uri)) urls.push(normalizeHtml(value.uri));
        if (typeof value.url === 'string' && /(?:fbcdn|scontent)/i.test(value.url)) urls.push(normalizeHtml(value.url));
        if (typeof value.id === 'string' && /^pcb\./.test(value.id)) tokens.push(value.id);
        for (const [key, child] of Object.entries(value)) {
            if (/mediaset|media_set|photoset/i.test(key) && typeof child === 'string') tokens.push(child);
            walk(child);
        }
    };
    walk(obj);
    const raw = JSON.stringify(obj);
    for (const match of raw.matchAll(/pcb\.\d+/g)) tokens.push(match[0]);
    return {
        imageUrls: unique(urls).filter((url) => /\.(?:jpg|jpeg|png|webp)|scontent|fbcdn/i.test(url)).slice(0, 80),
        mediaSetTokens: unique(tokens).slice(0, 20),
    };
}

function cleanText(value) {
    if (typeof value !== 'string') return null;
    return normalizeHtml(value).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function isUiText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) return true;
    return [
        'like',
        'comment',
        'share',
        'send',
        'see translation',
        'write a public comment',
        'write a comment',
        'most relevant',
        'new posts',
        'recent activity',
        'public group',
        'view more comments',
    ].some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function isUnavailableAttachmentText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized === "this content isn't available right now"
        || normalized.startsWith("when this happens, it's usually because the owner only shared it");
}

function isAttachmentTitlePath(path) {
    const lowerPath = String(path || '').toLowerCase();
    return /attachments\.\d+\.styles\.title$/.test(lowerPath)
        || /attachments\.\d+\.styles\.attachment\.title_with_entities\.text$/.test(lowerPath);
}

function collectTextSignals(obj) {
    const signals = {
        unavailableAttachment: false,
        accessibilityCaptionCount: 0,
        attachmentTitleCount: 0,
    };
    const seenObjects = new Set();

    function walk(value, path = '', depth = 0) {
        if (!value || depth > 18) return;
        if (typeof value === 'object') {
            if (seenObjects.has(value)) return;
            seenObjects.add(value);
            const entries = Array.isArray(value)
                ? value.map((child, index) => [String(index), child])
                : Object.entries(value);
            for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key, depth + 1);
            return;
        }
        if (typeof value !== 'string') return;

        const text = cleanText(value);
        if (!text) return;
        if (isUnavailableAttachmentText(text)) signals.unavailableAttachment = true;
        if (/accessibility_caption$/i.test(path)) signals.accessibilityCaptionCount += 1;
        if (isAttachmentTitlePath(path)) signals.attachmentTitleCount += 1;
    }

    walk(obj);
    return signals;
}

function collectTextCandidates(obj) {
    const candidates = [];
    const seenObjects = new Set();
    const seenTexts = new Set();

    function scoreCandidate(text, path) {
        const collapsed = text.replace(/\s+/g, ' ').trim();
        const lowerPath = path.toLowerCase();
        const attachmentTitle = isAttachmentTitlePath(path);
        let score = Math.min(collapsed.length, 400);

        if (/message(?:_container)?\.story\.message\.text/.test(lowerPath)) score += 140;
        if (/attached_story|story_attachment|subattachment|share/i.test(path)) score += 80;
        if (/comet_sections/i.test(path)) score += 35;
        if (attachmentTitle) score += 75;
        if (text.includes('\n')) score += 25;

        if (/actor|actors|name|url|wwwurl|tracking|feedback|reaction|comment|ufi|accessibility|caption|subtitle/i.test(path)) {
            score -= 100;
        }
        if (/title/i.test(path) && !attachmentTitle) score -= 100;
        if (/^\d+\s*(?:m|h|d|w)$/i.test(collapsed)) score -= 150;
        if (/^https?:\/\//i.test(collapsed)) score -= 150;
        if (isUnavailableAttachmentText(collapsed)) score -= 500;
        if (isUiText(collapsed)) score -= 200;

        return score;
    }

    function walk(value, path = '', depth = 0) {
        if (!value || depth > 18) return;
        if (typeof value === 'object') {
            if (seenObjects.has(value)) return;
            seenObjects.add(value);
            const entries = Array.isArray(value)
                ? value.map((child, index) => [String(index), child])
                : Object.entries(value);
            for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key, depth + 1);
            return;
        }
        if (typeof value !== 'string') return;

        const text = cleanText(value);
        if (!text || text.length < 3 || seenTexts.has(text)) return;
        seenTexts.add(text);

        const lowerPath = path.toLowerCase();
        const isMessageText = /(?:^|\.)message(?:\.|_|$)/.test(lowerPath) && lowerPath.endsWith('.text');
        const isCometText = /comet_sections|attached_story|story_attachment|subattachment|message_container/.test(lowerPath)
            && lowerPath.endsWith('.text');
        const isAttachmentTitle = isAttachmentTitlePath(path);
        if (!isMessageText && !isCometText && !isAttachmentTitle) return;

        const score = scoreCandidate(text, path);
        if (score <= 0) return;
        candidates.push({ text, path, score });
    }

    walk(obj);
    return candidates
        .toSorted((left, right) => right.score - left.score)
        .slice(0, 12);
}

function choosePostText(comet, directText) {
    const direct = cleanText(directText);
    const candidates = collectTextCandidates(comet);
    const signals = collectTextSignals(comet);
    if (direct) {
        return {
            text: direct,
            source: 'direct_message',
            missingReason: null,
            candidates: candidates.slice(0, 5),
        };
    }
    const best = candidates[0] || null;
    return {
        text: best?.text || null,
        source: best ? 'fallback_nested_message' : 'missing',
        missingReason: best
            ? null
            : (signals.unavailableAttachment
                ? 'content_unavailable'
                : (signals.accessibilityCaptionCount > 0
                    ? 'media_accessibility_caption_only'
                    : 'no_message_text')),
        candidates: candidates.slice(0, 5),
    };
}

function parseCometSections(holder) {
    const comet = holder?.comet_sections ? holder.comet_sections : holder;
    const actor = getPath(comet, ['context_layout', 'story', 'comet_sections', 'actor_photo', 'story', 'actors', 0])
        || getPath(comet, ['content', 'story', 'actors', 0]);
    const creationTime = getPath(comet, ['context_layout', 'story', 'comet_sections', 'metadata', 0, 'story', 'creation_time'])
        || getPath(comet, ['metadata', 0, 'story', 'creation_time']);
    const directText = getPath(comet, ['content', 'story', 'comet_sections', 'message', 'story', 'message', 'text'])
        || getPath(comet, ['content', 'story', 'comet_sections', 'message_container', 'story', 'message', 'text'])
        || getPath(comet, ['message', 'story', 'message', 'text']);
    const textExtraction = choosePostText(comet, directText);
    const text = textExtraction.text;
    const feedback = getPath(comet, ['feedback', 'story', 'feedback_context', 'feedback_target_with_context', 'ufi_renderer', 'feedback'])
        || getPath(comet, ['feedback', 'story']);
    const postUrl = getPath(comet, ['content', 'story', 'wwwURL']) || getPath(comet, ['content', 'story', 'url']);
    const postIdFromUrl = firstMatch(postUrl || '', [
        /\/permalink\/(\d+)/,
        /\/posts\/(\d+)/,
    ]);
    const postId = feedback?.subscription_target_id
        || feedback?.post_id
        || getPath(comet, ['feedback', 'story', 'post_id'])
        || postIdFromUrl;
    const media = collectMedia(comet);

    if (!postId && !text && !postUrl) return null;
    return {
        post_id: postId || null,
        post_url: postUrl || null,
        created_at: Number.isFinite(Number(creationTime)) ? new Date(Number(creationTime) * 1000).toISOString() : null,
        creation_time: creationTime || null,
        text: typeof text === 'string' ? text : null,
        text_source: textExtraction.source,
        text_missing_reason: textExtraction.missingReason,
        text_candidates: textExtraction.candidates,
        author: actor ? {
            id: actor.id || null,
            name: actor.name || null,
            url: actor.url || null,
        } : null,
        stats: {
            reactions: getPath(feedback, ['comet_ufi_summary_and_actions_renderer', 'feedback', 'reaction_count', 'count'])
                ?? feedback?.reaction_count?.count ?? null,
            comments: feedback?.comment_count?.total_count ?? null,
            shares: getPath(feedback, ['comet_ufi_summary_and_actions_renderer', 'feedback', 'share_count', 'count'])
                ?? feedback?.share_count?.count ?? null,
        },
        media,
    };
}

function makePostKeys(post) {
    const text = String(post.text || '').replace(/\s+/g, ' ').trim();
    return unique([
        post.post_id ? `id:${post.post_id}` : null,
        post.post_url ? `url:${post.post_url}` : null,
        text ? `text:${text.slice(0, 500)}` : null,
        text && post.creation_time ? `time_text:${post.creation_time}:${text.slice(0, 300)}` : null,
        text && post.author?.id ? `author_text:${post.author.id}:${text.slice(0, 300)}` : null,
    ]);
}

function extractPosts(values, maxPosts, { includeRawPayload = false } = {}) {
    const posts = [];
    const seen = new Set();
    const visit = (value) => {
        if (!value || typeof value !== 'object' || posts.length >= maxPosts) return;
        const parsed = value.comet_sections ? parseCometSections(value) : null;
        if (parsed && (parsed.post_id || parsed.post_url || parsed.creation_time)) {
            if (includeRawPayload) parsed.raw_comet_payload_json = value;
            const keys = makePostKeys(parsed);
            if (keys.length && !keys.some((key) => seen.has(key))) {
                for (const key of keys) seen.add(key);
                posts.push(parsed);
            }
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
    };
    for (const value of values) visit(value);
    return posts;
}

function mergePosts(target, posts, seen, maxPosts) {
    for (const post of posts) {
        if (target.length >= maxPosts) break;
        const keys = makePostKeys(post);
        if (!keys.length || keys.some((key) => seen.has(key))) continue;
        for (const key of keys) seen.add(key);
        target.push(post);
    }
}

function isUsablePost(post, boundary) {
    return Boolean(post?.post_id) && !postBoundaryHit(post, boundary);
}

function countUsablePosts(posts, boundary) {
    return posts.filter((post) => isUsablePost(post, boundary)).length;
}

function extractCursors(text) {
    const cursors = [];
    for (const pattern of [/"end_cursor":"([^"]+)"/g, /"cursor":"([^"]+)"/g]) {
        for (const match of String(text || '').matchAll(pattern)) cursors.push(normalizeHtml(match[1]));
    }
    return unique(cursors).slice(0, 20);
}

function mediaSetTokensForPost(post) {
    const tokens = [...(post?.media?.mediaSetTokens || [])];
    const postId = post?.post_id;
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    if (!tokens.length && postId && feedImages.length >= 4) tokens.push(`pcb.${postId}`);
    return unique(tokens);
}

function readGroupUrls(input) {
    const urls = [];
    if (Array.isArray(input.groupUrls)) {
        for (const value of input.groupUrls) {
            if (typeof value === 'string' && value.trim()) urls.push(value.trim());
        }
    }
    if (!urls.length && typeof input.groupUrl === 'string' && input.groupUrl.trim()) {
        urls.push(input.groupUrl.trim());
    }
    if (!urls.length) urls.push('https://www.facebook.com/groups/1564552680458634/');
    return unique(urls).map((value) => {
        if (/^\d+$/.test(value)) return `https://www.facebook.com/groups/${value}/`;
        return value;
    });
}

async function fetchMediaSetText(url, proxyConfiguration, client = null) {
    if (client) {
        return fetchText(client, url, {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                referer: 'https://www.facebook.com/',
            },
        });
    }
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    return gotScraping({
        url,
        proxyUrl,
        throwHttpErrors: false,
        timeout: { request: 30000 },
        headers: {
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        },
        followRedirect: true,
    });
}

function mediaSetUrlsForToken(token) {
    const encoded = encodeURIComponent(token);
    return [
        `https://www.facebook.com/media/set/?set=${encoded}&type=1`,
        `https://m.facebook.com/media/set/?set=${encoded}&type=1`,
    ];
}

function normalizeFacebookUrl(url) {
    const value = String(url || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return `https://www.facebook.com${value}`;
    return null;
}

function postPermalinkUrlsForPost(post) {
    const sourceUrl = normalizeFacebookUrl(post?.post_url);
    if (!sourceUrl) return [];
    const desktopUrl = sourceUrl.replace(/^https?:\/\/m\.facebook\.com/i, 'https://www.facebook.com');
    const mobileUrl = sourceUrl.replace(/^https?:\/\/(?:www\.)?facebook\.com/i, 'https://m.facebook.com');
    const postMatch = desktopUrl.match(/\/groups\/([^/?#]+)\/(?:permalink|posts)\/(\d+)/);
    const groupRef = postMatch?.[1];
    const postId = postMatch?.[2];
    const desktopPostsUrl = groupRef && postId ? `https://www.facebook.com/groups/${groupRef}/posts/${postId}/` : null;
    const mobilePostsUrl = groupRef && postId ? `https://m.facebook.com/groups/${groupRef}/posts/${postId}/` : null;
    return unique([desktopUrl, mobileUrl, desktopPostsUrl, mobilePostsUrl]);
}

function isMediaSetUrl(url) {
    return /\/media\/set\//.test(String(url || ''));
}

function isBetterMediaExpansionCandidate(candidate, best) {
    const candidateCount = candidate?.images?.length || 0;
    const bestCount = best?.images?.length || 0;
    if (candidateCount !== bestCount) return candidateCount > bestCount;
    if (!best?.url) return true;
    if (candidateCount > 0) return isMediaSetUrl(candidate.url) && !isMediaSetUrl(best.url);
    return false;
}

async function expandMediaSets(proxyConfiguration, client, post, retries, retryDelayMs) {
    const tokens = mediaSetTokensForPost(post);
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    const attempts = [];
    let best = { token: null, images: [], rawCount: 0, statusCode: null, url: null, source: null, attempts: [] };

    for (const token of tokens) {
        for (const url of mediaSetUrlsForToken(token)) {
            for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
                const startedAt = new Date().toISOString();
                try {
                    const response = await fetchMediaSetText(url, proxyConfiguration, client);
                    const rawUrls = extractImageUrlsFromHtml(response.body || '');
                    const images = cleanImageUrls(rawUrls);
                    attempts.push({
                        token,
                        url,
                        attempt,
                        startedAt,
                        statusCode: response.statusCode,
                        finalUrl: response.url,
                        rawCount: rawUrls.length,
                        cleanCount: images.length,
                        source: 'media_set',
                    });
                    const candidate = {
                        token,
                        images,
                        rawCount: rawUrls.length,
                        statusCode: response.statusCode,
                        url: response.url || url,
                        source: 'media_set',
                        attempts: [...attempts],
                    };
                    if (isBetterMediaExpansionCandidate(candidate, best)) {
                        best = {
                            ...candidate,
                            attempts: [...attempts],
                        };
                    }
                    if (response.statusCode < 500 && response.statusCode !== 429 && response.statusCode !== 400) break;
                } catch (error) {
                    attempts.push({
                        token,
                        url,
                        attempt,
                        startedAt,
                        error: error.message,
                        code: error.code || null,
                    });
                }
                if (attempt <= retries) await sleep(retryDelayMs * attempt);
            }
            if (best.images.length) break;
        }
    }

    const shouldTryPermalinkFallback = feedImages.length >= 5 && best.images.length <= feedImages.length;
    if (shouldTryPermalinkFallback) {
        let primaryPermalinkCleanMax = 0;
        for (const url of postPermalinkUrlsForPost(post)) {
            const isAlternatePostsUrl = /\/posts\/\d+\/?$/i.test(url);
            if (isAlternatePostsUrl && primaryPermalinkCleanMax >= feedImages.length) break;
            for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
                const startedAt = new Date().toISOString();
                try {
                    const response = await fetchMediaSetText(url, proxyConfiguration, client);
                    const rawUrls = extractImageUrlsFromHtml(response.body || '');
                    const permalinkImages = cleanImageUrls(rawUrls);
                    const images = permalinkImages.length
                        ? cleanImageUrls([...permalinkImages, ...feedImages])
                        : [];
                    attempts.push({
                        token: null,
                        url,
                        attempt,
                        startedAt,
                        statusCode: response.statusCode,
                        finalUrl: response.url,
                        rawCount: rawUrls.length,
                        cleanCount: images.length,
                        permalinkCleanCount: permalinkImages.length,
                        source: 'post_permalink_fallback',
                    });
                    const candidate = {
                        token: best.token || tokens[0] || null,
                        images,
                        rawCount: rawUrls.length,
                        statusCode: response.statusCode,
                        url: response.url || url,
                        source: 'post_permalink_fallback',
                        attempts: [...attempts],
                    };
                    if (isBetterMediaExpansionCandidate(candidate, best)) {
                        best = {
                            ...candidate,
                            attempts: [...attempts],
                        };
                    }
                    if (!isAlternatePostsUrl) {
                        primaryPermalinkCleanMax = Math.max(primaryPermalinkCleanMax, images.length);
                    }
                    if (images.length > feedImages.length) break;
                    if (response.statusCode < 500 && response.statusCode !== 429 && response.statusCode !== 400) break;
                } catch (error) {
                    attempts.push({
                        token: null,
                        url,
                        attempt,
                        startedAt,
                        error: error.message,
                        code: error.code || null,
                        source: 'post_permalink_fallback',
                    });
                }
                if (attempt <= retries) await sleep(retryDelayMs * attempt);
            }
            if (best.images.length > feedImages.length) break;
        }
    }

    return { ...best, attempts };
}

function normalizedPost(post, index, context, expansion, options = {}) {
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    const expandedImages = expansion?.images || [];
    const mediaSetTokens = mediaSetTokensForPost(post);
    const useExpanded = expandedImages.length >= feedImages.length && expandedImages.length > 0;
    const finalImages = useExpanded ? expandedImages : feedImages;
    const mediaSource = useExpanded ? (expansion?.source || 'media/set') : 'feed';
    const expansionAttempted = Boolean(expansion);
    const completeness = classifyMediaCompleteness({
        feedImages,
        expandedImages,
        expansionAttempted,
        mediaSetTokens,
    });
    const legacyCompleteness = legacyMediaCompleteness({ feedImages, expandedImages, expansionAttempted });
    const reviewSeverity = mediaReviewSeverity({
        media_completeness: completeness,
        media_completeness_legacy: legacyCompleteness,
        media_preview_count: feedImages.length,
        media_expanded_count: expandedImages.length,
        media_final_count: finalImages.length,
    });
    const confidence = useExpanded
        ? 'high'
        : (completeness === 'feed_complete' ? 'medium' : (mediaSetTokens.length ? 'unknown' : 'feed_only'));
    const author = post.author || {};
    const sourceUrl = post.post_url
        || (post.post_id ? `https://www.facebook.com/groups/${context.groupId}/permalink/${post.post_id}/` : null);
    const authorUrl = author.url || (author.id ? `https://www.facebook.com/profile.php?id=${author.id}` : null);

    return {
        record_type: 'post',
        source_platform: 'facebook',
        provider: PROVIDER_NAME,
        rank: index,
        group_id: context.groupId || null,
        group_url: context.groupUrl,
        group_name: context.groupName || null,
        source_group_id: context.groupId || null,
        source_group_url: context.groupUrl,
        source_post_id: post.post_id || null,
        source_url: sourceUrl,
        created_at: post.created_at || null,
        created_at_source: post.created_at ? 'graphql_creation_time' : null,
        created_at_precision: post.created_at ? 'second' : null,
        creation_time: post.creation_time || null,
        raw_text: post.text || '',
        text_source: post.text_source || (post.text ? 'direct_message' : 'missing'),
        text_missing_reason: post.text_missing_reason || null,
        text_candidates: post.text_candidates || [],
        author: {
            id: author.id || null,
            source_user_id: author.id || null,
            name: author.name || null,
            url: authorUrl,
        },
        stats: post.stats || {},
        media: finalImages.map((url, mediaIndex) => ({
            source_media_id: mediaKey(url),
            media_type: 'photo',
            source_url: url,
            thumbnail_url: url,
            width: 0,
            height: 0,
            ocr_text: null,
            source: mediaSource,
            index: mediaIndex + 1,
        })),
        media_set_tokens: mediaSetTokens,
        media_preview_count: feedImages.length,
        media_expanded_count: expandedImages.length,
        media_final_count: finalImages.length,
        media_completeness: completeness,
        media_completeness_legacy: legacyCompleteness,
        media_review_severity: reviewSeverity,
        media_plus_n_risk: completeness === 'likely_incomplete_plusN',
        media_counts: {
            feed_photo_count: feedImages.length,
            expanded_photo_count: expandedImages.length,
            final_photo_count: finalImages.length,
            expanded_raw_count: expansion?.rawCount || 0,
        },
        media_source: mediaSource,
        media_complete_confidence: confidence,
        media_expansion: {
            attempted: expansionAttempted,
            requested_retries: expansionAttempted ? (options.mediaSetRetries ?? null) : null,
            status_code: expansion?.statusCode || null,
            url: expansion?.url || null,
            attempts: expansion?.attempts || [],
        },
        coverage_status: context.coverageStatus || 'unknown',
        warnings: context.warnings || [],
        pagination: context.pagination || null,
        raw_payload_json: options.includeRawPayload ? post : null,
        raw_comet_payload_json: options.includeRawPayload ? (post.raw_comet_payload_json || null) : null,
    };
}

function mediaCompletenessScore(row) {
    const status = row?.media_completeness || row?.media_completeness_legacy || 'unknown';
    const scores = {
        none: 0,
        unknown: 0,
        likely_incomplete_plusN: 1,
        media_set_failed_feed_fallback: 1,
        failed_expansion: 1,
        feed_preserved_after_partial_expansion: 3,
        expanded_partial: 2,
        partial_expansion: 2,
        feed_complete: 3,
        preview_only: 3,
        expanded: 4,
    };
    return scores[status] ?? 0;
}

function isBetterMediaRow(candidate, current) {
    const candidateCount = candidate?.media_counts?.final_photo_count ?? candidate?.media_final_count ?? 0;
    const currentCount = current?.media_counts?.final_photo_count ?? current?.media_final_count ?? 0;
    if (candidateCount > currentCount) return true;
    if (candidateCount < currentCount) return false;
    return mediaCompletenessScore(candidate) > mediaCompletenessScore(current);
}

function attachDeferredRetry(row, retry) {
    return {
        ...row,
        media_deferred_retry: retry,
    };
}

await Actor.init();

const input = await Actor.getInput() || {};
const actorEnv = Actor.getEnv();
const maxPaidDatasetItems = readMaxPaidDatasetItemsSetting({
    ...process.env,
    actorMaxPaidDatasetItems: actorEnv?.actorMaxPaidDatasetItems,
});
const requestedGroupUrls = readGroupUrls(input);
if (!requestedGroupUrls.length) throw new Error('Provide at least one public Facebook group URL in groupUrls or groupUrl.');
const maxGroupsPerRun = numberSetting(input, 'maxGroupsPerRun', MAX_GROUPS_PER_RUN, 1, MAX_GROUPS_PER_RUN, { integer: true });
const selectedGroupUrls = requestedGroupUrls.slice(0, maxGroupsPerRun);
const skippedGroupUrlsByLimit = requestedGroupUrls.slice(maxGroupsPerRun);
const rootInputSignature = stableStringify({
    groupUrls: selectedGroupUrls,
    skippedGroupUrlsByLimit,
    maxGroupsPerRun,
    maxPostsPerGroup: input.maxPostsPerGroup ?? input.maxPosts ?? null,
    maxCandidates: input.maxCandidates ?? null,
    maxPages: input.maxPages ?? null,
    proxyCountry: input.proxyCountry || 'US',
    sortMode: input.sortMode || input.sortingSetting || 'CHRONOLOGICAL',
    outputMode: input.outputMode || 'posts',
    expandAllPhotos: input.expandAllPhotos !== false && input.expandMediaSets !== false,
    includeRawPayload: input.includeRawPayload === true,
    mediaSetRetries: input.mediaSetRetries ?? null,
    mediaSetRetryDelayMs: input.mediaSetRetryDelayMs ?? null,
    mediaExpansionConcurrency: input.mediaExpansionConcurrency ?? null,
    mediaExpansionAdaptive: input.mediaExpansionAdaptive !== false,
    mediaDeferredRetry: input.mediaDeferredRetry !== false,
    mediaDeferredRetryConcurrency: input.mediaDeferredRetryConcurrency ?? null,
    mediaDeferredRetryExtraRetries: input.mediaDeferredRetryExtraRetries ?? null,
    mediaDeferredRetryDelayMs: input.mediaDeferredRetryDelayMs ?? null,
    startCursor: readStartCursor(input),
    startCursorsByGroup: input.startCursorsByGroup ?? input.cursorsByGroup ?? null,
    sinceDate: input.sinceDate ?? null,
    knownPostIds: readKnownPostIds(input),
    checkpoint: input.checkpoint ?? null,
});
const runtimeRootState = await Actor.useState(RUNTIME_STATE_KEY, {});
if (runtimeRootState.rootVersion !== RUNTIME_ROOT_STATE_VERSION || runtimeRootState.inputSignature !== rootInputSignature) {
    resetRuntimeRootState(runtimeRootState, rootInputSignature);
} else {
    runtimeRootState.resumed = true;
}
if (!runtimeRootState.groups || typeof runtimeRootState.groups !== 'object') runtimeRootState.groups = {};

let currentGroupRuntimeState = null;
Actor.on('migrating', async () => {
    runtimeRootState.migrationEvents = (runtimeRootState.migrationEvents || 0) + 1;
    if (currentGroupRuntimeState) {
        currentGroupRuntimeState.migrationEvents = (currentGroupRuntimeState.migrationEvents || 0) + 1;
    }
    await persistRuntimeState(runtimeRootState, 'migrating');
});

Actor.on('persistState', async () => {
    await persistRuntimeState(runtimeRootState, 'persist_state_event');
});

const proxyCountryForRun = input.proxyCountry || 'US';
let sharedProxyConfiguration = null;
try {
    sharedProxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: proxyCountryForRun });
} catch (error) {
    log.warning('Could not create residential proxy configuration, falling back to direct request', { message: error.message });
}
const rootStartedAt = new Date().toISOString();

async function processGroup(groupUrl, groupIndex, groupRuntimeState, remainingPaidDatasetItems = null) {
const groupUrls = selectedGroupUrls;
const runtimeState = groupRuntimeState;
const maxPostsInput = input.maxPostsPerGroup ?? input.maxPosts;
const requestedMaxPosts = numberSetting({ maxPosts: maxPostsInput }, 'maxPosts', 30, 1, MAX_POSTS_PER_GROUP, { integer: true });
const maxPosts = remainingPaidDatasetItems === null
    ? requestedMaxPosts
    : Math.min(requestedMaxPosts, Math.max(0, remainingPaidDatasetItems));
const maxCandidates = readMaxCandidatesSetting(input, maxPosts);
const maxPages = readMaxPagesSetting(input, maxPosts);
const bootstrapRetries = numberSetting(input, 'bootstrapRetries', 4, 1, 10, { integer: true });
const graphqlPageRetries = numberSetting(input, 'graphqlPageRetries', 2, 0, 5, { integer: true });
const emptyPageRecoverySessions = Math.min(Math.max(bootstrapRetries, 1), 4);
const proxyCountry = input.proxyCountry || 'US';
const sortingSetting = typeof input.sortMode === 'string' && input.sortMode.trim()
    ? input.sortMode.trim()
    : (typeof input.sortingSetting === 'string' && input.sortingSetting.trim()
        ? input.sortingSetting.trim()
        : 'CHRONOLOGICAL');
const outputMode = ['posts', 'summary'].includes(input.outputMode) ? input.outputMode : 'posts';
const expandMediaSetsEnabled = input.expandAllPhotos !== false && input.expandMediaSets !== false;
const includeRawPayload = input.includeRawPayload === true;
const mediaSetRetries = numberSetting(input, 'mediaSetRetries', 1, 0, 5, { integer: true });
const mediaSetRetryDelayMs = numberSetting(input, 'mediaSetRetryDelayMs', 800, 0, 10000, { integer: true });
const mediaExpansionConcurrency = numberSetting(input, 'mediaExpansionConcurrency', 3, 1, 10, { integer: true });
const mediaExpansionAdaptive = input.mediaExpansionAdaptive !== false;
const mediaDeferredRetry = input.mediaDeferredRetry !== false;
const mediaDeferredRetryConcurrency = numberSetting(input, 'mediaDeferredRetryConcurrency', 2, 1, 5, { integer: true });
const mediaDeferredRetryExtraRetries = numberSetting(input, 'mediaDeferredRetryExtraRetries', 2, 0, 5, { integer: true });
const mediaDeferredRetryDelayMs = numberSetting(
    input,
    'mediaDeferredRetryDelayMs',
    Math.max(mediaSetRetryDelayMs * 2, 1500),
    0,
    20000,
    { integer: true },
);
const debug = input.debug === true;
const discoverBundles = input.discoverBundles === true;
const startCursor = readStartCursorForGroup(input, groupUrl, selectedGroupUrls.length);
const paginationMode = input.paginationMode === 'cursor_page' || startCursor
    ? 'cursor_page'
    : 'ranked_snapshot';
const collectionLimit = maxCandidates;
const sinceDate = parseSinceDate(input.sinceDate);
const knownPostIds = readKnownPostIdsForGroup(input, groupUrl);
const boundary = {
    sinceDate,
    knownPostIds,
    knownPostIdSet: new Set(knownPostIds),
};
const boundaryStopEnabled = sortingSetting === 'CHRONOLOGICAL' && (sinceDate || knownPostIds.length > 0);
const collectionGoalReached = (posts) => {
    if (paginationMode !== 'cursor_page') return posts.length >= maxCandidates;
    return countUsablePosts(posts, boundary) >= maxPosts || posts.length >= maxCandidates;
};
const graphqlPageCount = (posts) => {
    if (paginationMode !== 'cursor_page') return Math.min(Math.max(maxCandidates, 3), 20);
    const remainingTarget = Math.max(1, maxPosts - countUsablePosts(posts, boundary));
    const remainingCandidates = Math.max(1, maxCandidates - posts.length);
    return Math.min(remainingTarget, remainingCandidates, 20);
};
const inputSignature = stableStringify({
    groupUrl,
    requestedMaxPosts,
    maxPosts,
    remainingPaidDatasetItems,
    maxCandidates,
    maxPages,
    proxyCountry,
    sortingSetting,
    outputMode,
    expandMediaSetsEnabled,
    includeRawPayload,
    mediaSetRetries,
    mediaSetRetryDelayMs,
    mediaExpansionConcurrency,
    mediaExpansionAdaptive,
    mediaDeferredRetry,
    mediaDeferredRetryConcurrency,
    mediaDeferredRetryExtraRetries,
    mediaDeferredRetryDelayMs,
    startCursor,
    paginationMode,
    sinceDate: sinceDate?.iso || null,
    knownPostIds,
});
if (runtimeState.version !== RUNTIME_STATE_VERSION || runtimeState.inputSignature !== inputSignature) {
    resetRuntimeState(runtimeState, inputSignature);
} else {
    runtimeState.resumed = true;
}
runtimeState.groupUrl = groupUrl;
runtimeState.groupIndex = groupIndex;
const proxyConfiguration = sharedProxyConfiguration;

const startedAt = new Date().toISOString();
const bootstrapAttempts = [];
let client = null;
let homepage = { statusCode: null, url: groupUrl, headers: {} };
let html = '';
let bootstrap = extractBootstrap('', groupUrl);

async function bootstrapSession(reason = 'initial', maxAttempts = bootstrapRetries) {
    let latest = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await setRunStatus(`Bootstrapping public group (${reason} ${attempt}/${maxAttempts})`);
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl(buildProxySessionId(reason, attempt)) : undefined;
        const cookieJar = new CookieJar();
        const attemptClient = gotScraping.extend({
            proxyUrl,
            cookieJar,
            headers: {
                'user-agent': USER_AGENT,
                'accept-language': 'en-US,en;q=0.9',
            },
        });

        try {
            const attemptHomepage = await fetchText(attemptClient, groupUrl, {
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                },
            });
            const attemptHtml = attemptHomepage.body || '';
            const attemptBootstrap = extractBootstrap(attemptHtml, attemptHomepage.url || groupUrl);
            bootstrapAttempts.push({
                reason,
                attempt,
                statusCode: attemptHomepage.statusCode,
                finalUrl: attemptHomepage.url,
                htmlLength: attemptHtml.length,
                groupId: attemptBootstrap.groupId,
                hasLsd: Boolean(attemptBootstrap.lsd),
                hasLoginWall: attemptBootstrap.hasLoginWall,
            });

            latest = {
                client: attemptClient,
                homepage: attemptHomepage,
                html: attemptHtml,
                bootstrap: attemptBootstrap,
            };
            if (attemptBootstrap.groupId) return latest;
        } catch (error) {
            bootstrapAttempts.push({
                reason,
                attempt,
                error: error.message,
                code: error.code || null,
            });
        }

        if (!proxyConfiguration) break;
    }
    return latest;
}

const initialSession = await bootstrapSession('initial', bootstrapRetries);
if (initialSession) {
    client = initialSession.client;
    homepage = initialSession.homepage;
    html = initialSession.html;
    bootstrap = initialSession.bootstrap;
}

const discovery = client
    ? await discoverDocId(client, html, debug, discoverBundles)
    : { docId: null, source: null, checked: debug ? [] : undefined };
const candidateDocIds = unique([discovery.docId, ...FALLBACK_DOC_IDS]);

const resumeFeed = runtimeState.feed?.complete && runtimeState.feed?.finalGraphql
    ? runtimeState.feed
    : null;
const attempts = [...(runtimeState.feed?.graphqlAttempts || [])];
const boundaryHits = [...(runtimeState.feed?.boundaryHits || [])];
let finalGraphql = resumeFeed?.finalGraphql || null;
let usedDocId = resumeFeed?.usedDocId || null;
let parsedJsonObjects = resumeFeed?.parsedJsonObjects || 0;

async function saveFeedProgress(docId, state) {
    runtimeState.phase = 'collecting_feed';
    runtimeState.feed = {
        complete: false,
        docId,
        ...state,
    };
    await persistRuntimeState(runtimeState, 'feed_page_completed');
}

async function saveFeedComplete(docId) {
    runtimeState.phase = 'feed_complete';
    runtimeState.feed = {
        complete: true,
        docId,
        usedDocId,
        parsedJsonObjects,
        finalGraphql,
        graphqlAttempts: attempts,
        boundaryHits,
    };
    await persistRuntimeState(runtimeState, 'feed_complete');
}

if (resumeFeed) {
    log.info('Resuming from completed feed runtime state', {
        posts: resumeFeed.finalGraphql?.posts?.length || 0,
        docId: resumeFeed.usedDocId,
    });
}

if (!finalGraphql) {
    for (const docId of candidateDocIds) {
        if (!bootstrap.groupId) break;
        const savedFeed = runtimeState.feed?.complete === false && runtimeState.feed?.docId === docId
            ? runtimeState.feed
            : null;
        const collectedPosts = [...(savedFeed?.collectedPosts || [])];
        const seenPosts = new Set(savedFeed?.seenKeys || collectedPosts.flatMap((post) => makePostKeys(post)));
        const allCursors = [...(savedFeed?.allCursors || [])];
        let cursor = savedFeed?.cursor ?? startCursor;
        let lastCursorUsed = savedFeed?.lastCursorUsed || null;
        let nextCursorForResume = savedFeed?.nextCursorForResume || null;
        let pagesFetched = savedFeed?.pagesFetched || 0;
        let stopReason = savedFeed?.stopReason || null;
        let lastResponse = null;
        const firstPage = savedFeed?.nextPage || 1;
        const makeFeedProgress = (nextPage) => ({
            collectedPosts,
            seenKeys: [...seenPosts],
            allCursors: unique(allCursors),
            cursor,
            lastCursorUsed,
            nextCursorForResume,
            pagesFetched,
            nextPage,
            stopReason,
            parsedJsonObjects,
            graphqlAttempts: attempts,
            boundaryHits,
        });
        if (savedFeed) {
            log.info('Resuming partial feed collection from runtime state', {
                docId,
                firstPage,
                collectedPosts: collectedPosts.length,
            });
        }
        for (let page = firstPage; page <= maxPages && !collectionGoalReached(collectedPosts); page += 1) {
        if (page === 1 || page % 10 === 0) {
            await setRunStatus(`Collecting feed page ${page}/${maxPages}; posts ${countUsablePosts(collectedPosts, boundary)}/${maxPosts}`);
        }
        let response;
        let responseText = '';
        let currentParsed = { values: [], errors: [] };
        let pagePosts = [];
        let cursors = [];
        let shouldStopDoc = false;
        let emptyPageRecoverySessionsUsed = 0;
        let requestErrorRecoverySessionsUsed = 0;
        let boundaryStoppedPage = false;
        let boundaryStoppedReason = null;

        for (let pageAttempt = 1; pageAttempt <= graphqlPageRetries + 2; pageAttempt += 1) {
            lastCursorUsed = cursor;
            const requestedPageCount = graphqlPageCount(collectedPosts);
            const variables = buildVariables(bootstrap, cursor, requestedPageCount, sortingSetting);
            const body = buildPostBody(bootstrap, docId, variables);
            try {
                response = await fetchText(client, 'https://www.facebook.com/api/graphql/', {
                    method: 'POST',
                    body: body.toString(),
                    headers: {
                        accept: '*/*',
                        'content-type': 'application/x-www-form-urlencoded',
                        origin: 'https://www.facebook.com',
                        referer: homepage.url || groupUrl,
                        'x-fb-lsd': bootstrap.lsd || '',
                        'x-asbd-id': '359341',
                    },
                });
            } catch (error) {
                attempts.push({
                    docId,
                    page,
                    pageAttempt,
                    cursorUsed: cursor,
                    error: error.message,
                    code: error.code || null,
                    requestErrorRecoverySessionsUsed,
                });
                if (pageAttempt <= graphqlPageRetries) {
                    await sleep(750 * pageAttempt);
                    continue;
                }
                if (requestErrorRecoverySessionsUsed < emptyPageRecoverySessions) {
                    requestErrorRecoverySessionsUsed += 1;
                    log.warning('Refreshing bootstrap/proxy session after repeated GraphQL request error', {
                        page,
                        pageAttempt,
                        error: error.message,
                        code: error.code || null,
                        collectedPosts: collectedPosts.length,
                        recoverySession: requestErrorRecoverySessionsUsed,
                        maxRecoverySessions: emptyPageRecoverySessions,
                    });
                    attempts.push({
                        docId,
                        page,
                        pageAttempt,
                        cursorUsed: cursor,
                        recovery: 'fresh_bootstrap_session_after_request_error',
                        recoverySession: requestErrorRecoverySessionsUsed,
                        maxRecoverySessions: emptyPageRecoverySessions,
                        previousError: error.message,
                        previousCode: error.code || null,
                        totalPostsFound: collectedPosts.length,
                    });
                    const recoveryBootstrapRetries = Math.min(Math.max(bootstrapRetries, 6), 10);
                    const freshSession = await bootstrapSession(`graphql_error_${page}_${requestErrorRecoverySessionsUsed}`, recoveryBootstrapRetries);
                    if (freshSession?.bootstrap?.groupId) {
                        client = freshSession.client;
                        homepage = freshSession.homepage;
                        html = freshSession.html;
                        bootstrap = freshSession.bootstrap;
                        await sleep(750 * requestErrorRecoverySessionsUsed);
                        pageAttempt = 0;
                        continue;
                    }
                    stopReason = 'graphql_request_error_after_recovery';
                    shouldStopDoc = true;
                    break;
                }
                stopReason = 'graphql_request_error_after_retries';
                shouldStopDoc = true;
                break;
            }

            responseText = response.body || '';
            currentParsed = parseJsonPayload(responseText);
            pagePosts = extractPosts(currentParsed.values, requestedPageCount, { includeRawPayload });
            const rawPagePostsFound = pagePosts.length;
            const boundarySlice = splitPostsAtBoundary(pagePosts, boundary, { stopAtBoundary: boundaryStopEnabled });
            pagePosts = boundarySlice.posts;
            if (boundarySlice.hits.length) {
                boundaryHits.push({
                    docId,
                    page,
                    pageAttempt,
                    stopAtBoundary: boundaryStopEnabled,
                    stopped: boundarySlice.stopped,
                    discardedAfterBoundary: boundarySlice.discardedAfterBoundary,
                    hits: boundarySlice.hits,
                });
                if (boundarySlice.stopped) {
                    boundaryStoppedPage = true;
                    boundaryStoppedReason = boundarySlice.hits[0]?.type === 'older_than_since_date'
                        ? 'since_date_boundary_reached'
                        : 'known_post_boundary_reached';
                }
            }
            cursors = extractCursors(responseText);
            parsedJsonObjects += currentParsed.values.length;

            const isEmptyTinyPage = response.statusCode === 200
                && responseText.length < 2000
                && !pagePosts.length
                && !cursors.length;
            const retryEmptyPage = isEmptyTinyPage
                && (
                    pageAttempt <= graphqlPageRetries
                    || emptyPageRecoverySessionsUsed < emptyPageRecoverySessions
                );

            attempts.push({
                docId,
                page,
                pageAttempt,
                cursorUsed: cursor,
                statusCode: response.statusCode,
                responseLength: responseText.length,
                jsonObjects: currentParsed.values.length,
                jsonErrors: currentParsed.errors,
                rawPagePostsFound,
                pagePostsFound: pagePosts.length,
                requestedPageCount,
                usablePostsFound: countUsablePosts(collectedPosts, boundary) + pagePosts.filter((post) => isUsablePost(post, boundary)).length,
                boundaryHits: boundarySlice.hits,
                boundaryStopped: boundarySlice.stopped,
                totalPostsFound: collectedPosts.length + pagePosts.length,
                cursorsFound: cursors.length,
                retryEmptyPage,
                emptyPageRecoverySessionsUsed,
                paginationProbe: debug ? scanPaginationFields(responseText, currentParsed.values) : undefined,
                sample: debug ? responseText.slice(0, 1500) : undefined,
            });

            if (!isEmptyTinyPage) break;
            if (pageAttempt > graphqlPageRetries && emptyPageRecoverySessionsUsed < emptyPageRecoverySessions) {
                emptyPageRecoverySessionsUsed += 1;
                log.warning('Refreshing bootstrap/proxy session after repeated empty GraphQL page', {
                    page,
                    pageAttempt,
                    responseLength: responseText.length,
                    collectedPosts: collectedPosts.length,
                    recoverySession: emptyPageRecoverySessionsUsed,
                    maxRecoverySessions: emptyPageRecoverySessions,
                });
                attempts.push({
                    docId,
                    page,
                    pageAttempt,
                    cursorUsed: cursor,
                    recovery: 'fresh_bootstrap_session',
                    recoverySession: emptyPageRecoverySessionsUsed,
                    maxRecoverySessions: emptyPageRecoverySessions,
                    previousResponseLength: responseText.length,
                    totalPostsFound: collectedPosts.length,
                });
                const recoveryBootstrapRetries = Math.min(Math.max(bootstrapRetries, 6), 10);
                const freshSession = await bootstrapSession(`empty_page_${page}_${emptyPageRecoverySessionsUsed}`, recoveryBootstrapRetries);
                if (freshSession?.bootstrap?.groupId) {
                    client = freshSession.client;
                    homepage = freshSession.homepage;
                    html = freshSession.html;
                    bootstrap = freshSession.bootstrap;
                    await sleep(750 * emptyPageRecoverySessionsUsed);
                    pageAttempt = 0;
                    continue;
                }
                stopReason = 'empty_page_after_recovery';
                shouldStopDoc = true;
                break;
            }
            if (pageAttempt > graphqlPageRetries) {
                stopReason = 'empty_page_after_retries';
                shouldStopDoc = true;
                break;
            }
            log.warning('Retrying empty/small GraphQL page', { page, pageAttempt, responseLength: responseText.length });
            await sleep(750 * pageAttempt);
        }

        if (shouldStopDoc) {
            await saveFeedProgress(docId, makeFeedProgress(page + 1));
            break;
        }
        mergePosts(collectedPosts, pagePosts, seenPosts, collectionLimit);
        for (const foundCursor of cursors) allCursors.push(foundCursor);
        lastResponse = { response, responseText };
        pagesFetched = page;
        if (boundaryStoppedPage) {
            stopReason = boundaryStoppedReason;
            await saveFeedProgress(docId, makeFeedProgress(page + 1));
            break;
        }
        if (response.statusCode >= 400 || (!pagePosts.length && !cursors.length && !currentParsed.values.length)) {
            stopReason = response.statusCode >= 400 ? 'graphql_http_error' : 'empty_page_without_cursor';
            await saveFeedProgress(docId, makeFeedProgress(page + 1));
            break;
        }
        const nextCursor = cursors.find((value) => value && value !== cursor);
        if (!nextCursor) {
            stopReason = 'no_next_cursor';
            await saveFeedProgress(docId, makeFeedProgress(page + 1));
            break;
        }
        nextCursorForResume = nextCursor;
        cursor = nextCursor;
        await saveFeedProgress(docId, makeFeedProgress(page + 1));
    }
    if (collectedPosts.length || allCursors.length) {
        finalGraphql = {
            posts: collectedPosts,
            cursors: unique(allCursors),
            responseMeta: lastResponse?.response ? {
                statusCode: lastResponse.response.statusCode,
                url: lastResponse.response.url || null,
                responseLength: lastResponse.responseText?.length || 0,
            } : null,
            pointer: {
                version: 1,
                type: 'facebook_group_graphql_cursor',
                mode: paginationMode,
                groupUrl,
                groupId: bootstrap.groupId || null,
                sortingSetting,
                docId,
                startCursor,
                lastCursorUsed,
                nextCursor: nextCursorForResume,
                hasNext: Boolean(nextCursorForResume),
                pagesFetched,
                collectionLimit,
                targetPostLimit: maxPosts,
                candidateLimit: maxCandidates,
                usablePostsFound: countUsablePosts(collectedPosts, boundary),
                stopReason: stopReason || (
                    countUsablePosts(collectedPosts, boundary) >= maxPosts
                        ? 'post_limit_reached'
                        : (collectedPosts.length >= maxCandidates ? 'candidate_limit_reached' : null)
                ),
            },
        };
        usedDocId = docId;
        await saveFeedComplete(docId);
        break;
    }
}
}

const orderedPosts = paginationMode === 'cursor_page'
    ? (finalGraphql?.posts || [])
    : (finalGraphql?.posts || []).toSorted((left, right) => (
        Number(right.creation_time || 0) - Number(left.creation_time || 0)
    ));
const sortedPosts = orderedPosts
    .filter((post) => post?.post_id)
    .filter((post) => !postBoundaryHit(post, boundary))
    .slice(0, maxPosts);

const stopReason = finalGraphql?.pointer?.stopReason || null;
const warnings = [];
if ((sinceDate || knownPostIds.length > 0) && !boundaryStopEnabled) {
    warnings.push('sinceDate/knownPostIds filter output, but stop-at-boundary is only trusted for CHRONOLOGICAL sorting.');
}
if (!bootstrap.groupId) warnings.push('Could not reliably extract public Facebook group ID from bootstrap page.');
if (sortedPosts.length < maxPosts) warnings.push('Returned fewer posts than requested.');
let coverageStatus = 'partial_target_not_reached';
if (sortedPosts.length >= maxPosts) {
    coverageStatus = 'complete_target_reached';
} else if (stopReason === 'since_date_boundary_reached') {
    coverageStatus = 'complete_until_since_date';
} else if (stopReason === 'known_post_boundary_reached') {
    coverageStatus = 'complete_until_known_post';
} else if (stopReason && /empty|error|http/i.test(stopReason)) {
    coverageStatus = 'partial_before_target';
}

const normalizationContext = {
    groupId: bootstrap.groupId,
    groupUrl,
    groupName: bootstrap.groupName || bootstrap.title || null,
    pagination: finalGraphql?.pointer || null,
    coverageStatus,
    warnings,
};
const sortedPostsSignature = postsSignature(sortedPosts);
const resumeMedia = runtimeState.media?.postsSignature === sortedPostsSignature
    ? runtimeState.media
    : null;
const normalizedPosts = [...(resumeMedia?.normalizedPosts || [])];
const deferDatasetWrites = outputMode === 'posts' && expandMediaSetsEnabled && mediaDeferredRetry;
const pendingOutputRows = deferDatasetWrites ? [] : [...(resumeMedia?.pendingOutputRows || [])];
let pushedOutputRows = resumeMedia?.pushedOutputRows || 0;
async function flushOutputRows(force = false) {
    if (deferDatasetWrites) return;
    if (outputMode !== 'posts' || !pendingOutputRows.length) return;
    if (!force && pendingOutputRows.length < DATASET_PUSH_BATCH_SIZE) return;
    const batch = pendingOutputRows.splice(0, pendingOutputRows.length);
    await Actor.pushData(batch);
    pushedOutputRows += batch.length;
}

async function pushDeferredDatasetRows() {
    if (!deferDatasetWrites || outputMode !== 'posts') return;
    while (pushedOutputRows < normalizedPosts.length) {
        const end = Math.min(pushedOutputRows + DATASET_PUSH_BATCH_SIZE, normalizedPosts.length);
        await setRunStatus(`Writing final dataset rows ${pushedOutputRows + 1}-${end}/${normalizedPosts.length}`);
        await Actor.pushData(normalizedPosts.slice(pushedOutputRows, end));
        pushedOutputRows = end;
        await saveMediaProgress(sortedPosts.length, true, {
            datasetWriteComplete: pushedOutputRows >= normalizedPosts.length,
        });
    }
}

const mediaExpansionController = createMediaExpansionController({
    requestedConcurrency: expandMediaSetsEnabled ? mediaExpansionConcurrency : 1,
    enabled: expandMediaSetsEnabled && mediaExpansionAdaptive,
    minConcurrency: 3,
});

async function saveMediaProgress(nextIndex, complete = false, extra = {}) {
    runtimeState.phase = complete ? 'media_complete' : 'expanding_media';
    runtimeState.media = {
        complete,
        postsSignature: sortedPostsSignature,
        nextIndex,
        normalizedPosts,
        pendingOutputRows,
        pushedOutputRows,
        deferDatasetWrites,
        controller: mediaExpansionController.snapshot(),
        ...extra,
    };
    await persistRuntimeState(runtimeState, complete ? 'media_complete' : 'media_batch_completed');
}

await setRunStatus(`Expanding media and writing output 0/${sortedPosts.length}`);
let mediaStartIndex = Math.min(resumeMedia?.nextIndex || normalizedPosts.length, sortedPosts.length);
if (resumeMedia) {
    log.info('Resuming media expansion from runtime state', {
        mediaStartIndex,
        normalizedPosts: normalizedPosts.length,
        pendingOutputRows: pendingOutputRows.length,
        pushedOutputRows,
    });
    await flushOutputRows(true);
    await saveMediaProgress(mediaStartIndex, mediaStartIndex >= sortedPosts.length);
}

async function runDeferredMediaRetry() {
    const summary = {
        enabled: expandMediaSetsEnabled && mediaDeferredRetry,
        deferredDatasetWrites: deferDatasetWrites,
        concurrency: mediaDeferredRetryConcurrency,
        extraRetries: mediaDeferredRetryExtraRetries,
        retryDelayMs: mediaDeferredRetryDelayMs,
        candidates: 0,
        attempted: 0,
        improved: 0,
        unchanged: 0,
        errors: 0,
        previousStatusCounts: {},
        finalStatusCounts: {},
        freshSessionAttempted: false,
        freshSessionUsed: false,
        complete: false,
    };

    if (!summary.enabled || !normalizedPosts.length) {
        summary.complete = true;
        return summary;
    }
    if (resumeMedia?.deferredRetry?.complete) return resumeMedia.deferredRetry;

    const candidates = normalizedPosts
        .map((row, index) => ({ row, index, post: sortedPosts[index] }))
        .filter(({ row, post }) => (
            row
            && post
            && isMediaExpansionRetryCandidate(row)
            && mediaSetTokensForPost(post).length > 0
        ));

    summary.candidates = candidates.length;
    summary.previousStatusCounts = countBy(candidates, ({ row }) => row.media_completeness);
    if (!candidates.length) {
        summary.complete = true;
        return summary;
    }

    log.info('Starting deferred media retry', {
        candidates: candidates.length,
        concurrency: mediaDeferredRetryConcurrency,
        extraRetries: mediaDeferredRetryExtraRetries,
        retryDelayMs: mediaDeferredRetryDelayMs,
    });

    let retryClient = client;
    try {
        summary.freshSessionAttempted = true;
        const recoveryBootstrapRetries = Math.min(Math.max(bootstrapRetries, 4), 8);
        const freshSession = await bootstrapSession('deferred_media_retry', recoveryBootstrapRetries);
        if (freshSession?.client) {
            retryClient = freshSession.client;
            summary.freshSessionUsed = true;
        }
    } catch (error) {
        log.warning('Could not create fresh session for deferred media retry; reusing current client', {
            message: error.message,
        });
    }

    for (let batchStart = 0; batchStart < candidates.length; batchStart += mediaDeferredRetryConcurrency) {
        const batch = candidates.slice(batchStart, batchStart + mediaDeferredRetryConcurrency);
        const batchEnd = Math.min(batchStart + batch.length, candidates.length);
        await setRunStatus(`Deferred photo retry ${batchStart + 1}-${batchEnd}/${candidates.length}`);

        const results = await Promise.all(batch.map(async ({ row, index, post }) => {
            const previous = {
                media_completeness: row.media_completeness,
                media_completeness_legacy: row.media_completeness_legacy,
                media_final_count: row.media_counts?.final_photo_count ?? row.media_final_count ?? 0,
                media_expanded_count: row.media_counts?.expanded_photo_count ?? row.media_expanded_count ?? 0,
            };
            const feedPreviewCount = cleanImageUrls(post?.media?.imageUrls || []).length;
            const firstPassRetries = feedPreviewCount >= 5
                ? Math.min(mediaSetRetries + 1, 5)
                : mediaSetRetries;
            const retryRetries = Math.min(firstPassRetries + mediaDeferredRetryExtraRetries, 8);
            try {
                const expansion = await expandMediaSets(
                    proxyConfiguration,
                    retryClient,
                    post,
                    retryRetries,
                    mediaDeferredRetryDelayMs,
                );
                const retried = normalizedPost(
                    post,
                    index + 1,
                    normalizationContext,
                    expansion,
                    { includeRawPayload, mediaSetRetries: retryRetries },
                );
                const improved = isBetterMediaRow(retried, row);
                const selected = improved ? retried : row;
                return {
                    index,
                    improved,
                    row: attachDeferredRetry(selected, {
                        attempted: true,
                        improved,
                        previous,
                        final: {
                            media_completeness: selected.media_completeness,
                            media_completeness_legacy: selected.media_completeness_legacy,
                            media_final_count: selected.media_counts?.final_photo_count ?? selected.media_final_count ?? 0,
                            media_expanded_count: selected.media_counts?.expanded_photo_count ?? selected.media_expanded_count ?? 0,
                        },
                        requested_retries: retryRetries,
                        retry_delay_ms: mediaDeferredRetryDelayMs,
                        status_code: expansion?.statusCode || null,
                        url: expansion?.url || null,
                        error: null,
                    }),
                };
            } catch (error) {
                return {
                    index,
                    improved: false,
                    error,
                    row: attachDeferredRetry(row, {
                        attempted: true,
                        improved: false,
                        previous,
                        final: previous,
                        requested_retries: retryRetries,
                        retry_delay_ms: mediaDeferredRetryDelayMs,
                        status_code: null,
                        url: null,
                        error: error.message,
                    }),
                };
            }
        }));

        for (const result of results) {
            normalizedPosts[result.index] = result.row;
            summary.attempted += 1;
            if (result.error) summary.errors += 1;
            else if (result.improved) summary.improved += 1;
            else summary.unchanged += 1;
        }
        summary.finalStatusCounts = countBy(candidates, ({ index }) => normalizedPosts[index]?.media_completeness);
        await saveMediaProgress(sortedPosts.length, false, { deferredRetry: summary });
    }

    summary.complete = true;
    summary.finalStatusCounts = countBy(candidates, ({ index }) => normalizedPosts[index]?.media_completeness);
    await saveMediaProgress(sortedPosts.length, false, { deferredRetry: summary });
    log.info('Finished deferred media retry', summary);
    return summary;
}

let effectiveMediaConcurrency = expandMediaSetsEnabled ? mediaExpansionController.currentConcurrency : 1;
for (let batchStart = mediaStartIndex; batchStart < sortedPosts.length;) {
    const batchConcurrency = expandMediaSetsEnabled ? mediaExpansionController.currentConcurrency : 1;
    effectiveMediaConcurrency = Math.max(effectiveMediaConcurrency, batchConcurrency);
    const batch = sortedPosts.slice(batchStart, batchStart + batchConcurrency);
    const batchEnd = Math.min(batchStart + batch.length, sortedPosts.length);
    if (
        batchStart === 0
        || batchEnd % STATUS_UPDATE_POST_INTERVAL === 0
        || batchEnd === sortedPosts.length
    ) {
        await setRunStatus(`Expanding media and writing output ${batchStart + 1}-${batchEnd}/${sortedPosts.length}`);
    }
    const rows = await Promise.all(batch.map(async (post, batchIndex) => {
        const postNumber = batchStart + batchIndex + 1;
        const feedPreviewCount = cleanImageUrls(post?.media?.imageUrls || []).length;
        const mediaSetTokens = mediaSetTokensForPost(post);
        const postMediaSetRetries = feedPreviewCount >= 5
            ? Math.min(mediaSetRetries + 1, 5)
            : mediaSetRetries;
        const expansion = expandMediaSetsEnabled && mediaSetTokens.length
            ? await expandMediaSets(proxyConfiguration, client, post, postMediaSetRetries, mediaSetRetryDelayMs)
            : null;
        return normalizedPost(post, postNumber, normalizationContext, expansion, { includeRawPayload, mediaSetRetries: postMediaSetRetries });
    }));
    normalizedPosts.push(...rows);
    if (!deferDatasetWrites) pendingOutputRows.push(...rows);
    await flushOutputRows();
    const decision = mediaExpansionController.recordRows(rows, { batchStart, batchEnd });
    if (decision) {
        log.warning('Adaptive media expansion lowered concurrency', decision);
    }
    mediaStartIndex = batchEnd;
    await saveMediaProgress(mediaStartIndex, false);
    batchStart = batchEnd;
}
const mediaDeferredRetrySummary = await runDeferredMediaRetry();
if (deferDatasetWrites) {
    await pushDeferredDatasetRows();
} else {
    await flushOutputRows(true);
}
await saveMediaProgress(sortedPosts.length, true, {
    deferredRetry: mediaDeferredRetrySummary,
    datasetWriteComplete: outputMode !== 'posts' || pushedOutputRows >= normalizedPosts.length,
});

const newestPost = normalizedPosts[0] || null;
const oldestPost = normalizedPosts[normalizedPosts.length - 1] || null;
const outputCheckpoint = {
    version: 1,
    type: 'facebook_group_posts_media_scraper_checkpoint',
    provider: PROVIDER_NAME,
    group_id: bootstrap.groupId || null,
    group_url: groupUrl,
    sort_mode: sortingSetting,
    newest_seen_post_id: newestPost?.source_post_id || null,
    newest_seen_created_at: newestPost?.created_at || null,
    oldest_seen_post_id: oldestPost?.source_post_id || null,
    oldest_seen_created_at: oldestPost?.created_at || null,
    next_backfill_cursor: finalGraphql?.pointer?.nextCursor || null,
    coverage_status: coverageStatus,
    stop_reason: stopReason,
    last_complete_run_at: /^complete_/.test(coverageStatus) ? new Date().toISOString() : null,
};

const summary = {
    provider: PROVIDER_NAME,
    actorVersion: ACTOR_VERSION,
    runStatus: normalizedPosts.length ? 'succeeded' : 'partial_or_empty',
    coverageStatus,
    stopReason,
    warnings,
    groupUrls,
    groupUrl,
    processedGroupUrls: [groupUrl],
    skippedGroupUrls: [],
    sinceDate: sinceDate?.iso || null,
    knownPostIds,
    boundaryStopEnabled,
    boundaryHits,
    checkpoint: input.checkpoint || null,
    outputCheckpoint,
    startedAt,
    finishedAt: new Date().toISOString(),
    proxyCountry,
    sortingSetting,
    paginationMode,
    startCursor,
    maxCandidates,
    maxPages,
    collectionLimit,
    requestedMaxPosts,
    maxPosts,
    remainingPaidDatasetItemsAtGroupStart: remainingPaidDatasetItems,
    paidDatasetItemLimitApplied: remainingPaidDatasetItems !== null && maxPosts < requestedMaxPosts,
    emptyPageRecoverySessions,
    outputMode,
    datasetPushMode: outputMode === 'posts'
        ? (deferDatasetWrites ? 'final_batches_after_media_retry' : 'incremental_batches')
        : 'summary_only',
    datasetRowsPushed: pushedOutputRows,
    datasetPushBatchSize: DATASET_PUSH_BATCH_SIZE,
    expandMediaSets: expandMediaSetsEnabled,
    includeRawPayload,
    mediaSetRetries,
    mediaExpansionConcurrency,
    effectiveMediaExpansionConcurrency: effectiveMediaConcurrency,
    mediaExpansionAdaptive,
    mediaExpansionController: mediaExpansionController.snapshot(),
    mediaDeferredRetry,
    mediaDeferredRetryConcurrency,
    mediaDeferredRetryExtraRetries,
    mediaDeferredRetryDelayMs,
    mediaDeferredRetrySummary,
    runtimeState: {
        version: runtimeState.version,
        resumed: runtimeState.resumed,
        migrationEvents: runtimeState.migrationEvents,
        phase: runtimeState.phase,
        updatedAt: runtimeState.updatedAt,
    },
    homepage: {
        statusCode: homepage.statusCode,
        finalUrl: homepage.url,
        contentType: homepage.headers['content-type'] || null,
        htmlLength: html.length,
    },
    bootstrap: {
        title: bootstrap.title,
        groupId: bootstrap.groupId,
        groupName: bootstrap.groupName,
        vanity: bootstrap.vanity,
        feedLocation: bootstrap.feedLocation,
        feedType: bootstrap.feedType,
        hasLsd: Boolean(bootstrap.lsd),
        hasJazoest: Boolean(bootstrap.jazoest),
        hasHsi: Boolean(bootstrap.hsi),
        hasSpin: Boolean(bootstrap.spinR && bootstrap.spinB && bootstrap.spinT),
        hasLoginWall: bootstrap.hasLoginWall,
    },
    bootstrapAttempts,
    discovery,
    usedDocId,
    graphqlAttempts: attempts,
    candidatePostsFound: finalGraphql?.posts?.length || 0,
    validPostsFound: sortedPosts.length,
    outputPosts: normalizedPosts.length,
    textSourceCounts: countBy(normalizedPosts, (post) => post.text_source),
    textMissingReasonCounts: countBy(
        normalizedPosts.filter((post) => post.text_source === 'missing' || !post.raw_text),
        (post) => post.text_missing_reason || 'unknown',
    ),
    postsWithMediaSetTokens: normalizedPosts.filter((post) => post.media_set_tokens.length > 0).length,
    postsExpandedByMediaSet: normalizedPosts.filter((post) => post.media_source === 'media/set').length,
    mediaCompletenessCounts: countBy(normalizedPosts, (post) => post.media_completeness),
    mediaCompletenessLegacyCounts: countBy(normalizedPosts, (post) => post.media_completeness_legacy),
    mediaReviewSeverityCounts: countBy(normalizedPosts, (post) => post.media_review_severity || 'none'),
    mediaPlusNRiskPosts: normalizedPosts.filter((post) => post.media_plus_n_risk).length,
    feedPhotoTotal: normalizedPosts.reduce((sum, post) => sum + post.media_counts.feed_photo_count, 0),
    expandedPhotoTotal: normalizedPosts.reduce((sum, post) => sum + post.media_counts.expanded_photo_count, 0),
    finalPhotoTotal: normalizedPosts.reduce((sum, post) => sum + post.media_counts.final_photo_count, 0),
    extraPhotosFound: normalizedPosts.reduce((sum, post) => (
        sum + Math.max(0, post.media_counts.final_photo_count - post.media_counts.feed_photo_count)
    ), 0),
    candidatePostsRaw: debug || includeRawPayload ? (finalGraphql?.posts || []) : undefined,
    posts: outputMode === 'summary' ? normalizedPosts : undefined,
    postsSample: outputMode === 'posts' ? normalizedPosts.slice(0, 3) : undefined,
    cursors: finalGraphql?.cursors || [],
    pointer: finalGraphql?.pointer || null,
    nextCursor: finalGraphql?.pointer?.nextCursor || null,
    hasNextPage: finalGraphql?.pointer?.hasNext || false,
    parsedJsonObjects,
};

await setRunStatus(`Prepared group summary; output rows ${normalizedPosts.length}`);
runtimeState.phase = 'finished';
runtimeState.summary = {
    runStatus: summary.runStatus,
    coverageStatus,
    outputPosts: normalizedPosts.length,
    datasetRowsPushed: pushedOutputRows,
    mediaCompletenessCounts: summary.mediaCompletenessCounts,
    mediaReviewSeverityCounts: summary.mediaReviewSeverityCounts,
    mediaPlusNRiskPosts: summary.mediaPlusNRiskPosts,
    mediaDeferredRetry: {
        enabled: mediaDeferredRetrySummary.enabled,
        candidates: mediaDeferredRetrySummary.candidates,
        improved: mediaDeferredRetrySummary.improved,
        errors: mediaDeferredRetrySummary.errors,
    },
};
await persistRuntimeState(runtimeState, 'finished');
return summary;
}

function mergeCountMaps(summaries, key) {
    const merged = {};
    for (const summary of summaries) {
        for (const [name, count] of Object.entries(summary?.[key] || {})) {
            merged[name] = (merged[name] || 0) + count;
        }
    }
    return merged;
}

function compactGroupSummary(summary) {
    return {
        groupUrl: summary.groupUrl,
        groupId: summary.bootstrap?.groupId || null,
        groupName: summary.bootstrap?.groupName || summary.bootstrap?.title || null,
        runStatus: summary.runStatus,
        coverageStatus: summary.coverageStatus,
        stopReason: summary.stopReason,
        outputPosts: summary.outputPosts,
        candidatePostsFound: summary.candidatePostsFound,
        validPostsFound: summary.validPostsFound,
        outputCheckpoint: summary.outputCheckpoint,
        pointer: summary.pointer,
        nextCursor: summary.nextCursor,
        hasNextPage: summary.hasNextPage,
        warnings: summary.warnings || [],
        textSourceCounts: summary.textSourceCounts || {},
        textMissingReasonCounts: summary.textMissingReasonCounts || {},
        mediaCompletenessCounts: summary.mediaCompletenessCounts || {},
        mediaReviewSeverityCounts: summary.mediaReviewSeverityCounts || {},
        mediaPlusNRiskPosts: summary.mediaPlusNRiskPosts || 0,
        feedPhotoTotal: summary.feedPhotoTotal || 0,
        finalPhotoTotal: summary.finalPhotoTotal || 0,
        extraPhotosFound: summary.extraPhotosFound || 0,
        runtimeState: summary.runtimeState || null,
    };
}

function createPaidLimitSkippedGroupSummary(groupUrl) {
    return {
        provider: PROVIDER_NAME,
        actorVersion: ACTOR_VERSION,
        runStatus: 'skipped',
        coverageStatus: 'skipped_paid_dataset_item_limit',
        stopReason: 'paid_dataset_item_limit_reached',
        warnings: ['Skipped because ACTOR_MAX_PAID_DATASET_ITEMS was reached.'],
        groupUrls: selectedGroupUrls,
        groupUrl,
        processedGroupUrls: [],
        skippedGroupUrls: [groupUrl],
        outputCheckpoint: null,
        outputPosts: 0,
        datasetRowsPushed: 0,
        maxPaidDatasetItems,
        paidDatasetItemLimitReached: true,
        textSourceCounts: {},
        textMissingReasonCounts: {},
        mediaCompletenessCounts: {},
        mediaCompletenessLegacyCounts: {},
        mediaReviewSeverityCounts: {},
        mediaPlusNRiskPosts: 0,
        feedPhotoTotal: 0,
        expandedPhotoTotal: 0,
        finalPhotoTotal: 0,
        extraPhotosFound: 0,
        postsSample: [],
        posts: undefined,
        pointer: null,
        nextCursor: null,
        hasNextPage: false,
    };
}

const groupSummaries = [];
let totalDatasetRowsPushed = 0;
let totalOutputPostsSoFar = 0;
for (const [groupIndex, groupUrl] of selectedGroupUrls.entries()) {
    const groupKey = runtimeGroupKey(groupUrl, groupIndex);
    const groupState = attachRuntimeRoot(runtimeRootState.groups[groupKey] || {}, runtimeRootState);
    runtimeRootState.groups[groupKey] = groupState;
    currentGroupRuntimeState = groupState;
    runStatusPrefix = selectedGroupUrls.length > 1 ? `Group ${groupIndex + 1}/${selectedGroupUrls.length}` : '';
    const remainingPaidDatasetItems = maxPaidDatasetItems === null
        ? null
        : Math.max(0, maxPaidDatasetItems - totalOutputPostsSoFar);
    let groupSummary;
    if (remainingPaidDatasetItems === 0) {
        log.info('Skipping group because paid dataset item limit was reached', {
            groupUrl,
            maxPaidDatasetItems,
            totalOutputPostsSoFar,
        });
        await setRunStatus(`Skipping group; paid dataset item limit reached at ${totalOutputPostsSoFar}`);
        groupSummary = createPaidLimitSkippedGroupSummary(groupUrl);
    } else {
        groupSummary = await processGroup(groupUrl, groupIndex, groupState, remainingPaidDatasetItems);
    }
    groupSummaries.push(groupSummary);
    totalDatasetRowsPushed += groupSummary.datasetRowsPushed || 0;
    totalOutputPostsSoFar += groupSummary.outputPosts || 0;
    runtimeRootState.finishedGroups = unique([...(runtimeRootState.finishedGroups || []), groupKey]);
    runtimeRootState.phase = groupIndex === selectedGroupUrls.length - 1 ? 'groups_complete' : 'between_groups';
    await persistRuntimeState(runtimeRootState, `group_${groupIndex + 1}_finished`);
}
currentGroupRuntimeState = null;
runStatusPrefix = '';

const outputModeForRun = ['posts', 'summary'].includes(input.outputMode) ? input.outputMode : 'posts';
const compactGroups = groupSummaries.map(compactGroupSummary);
const totalOutputPosts = groupSummaries.reduce((sum, summary) => sum + (summary.outputPosts || 0), 0);
const skippedGroupUrlsByPaidLimit = groupSummaries
    .filter((summary) => summary.stopReason === 'paid_dataset_item_limit_reached')
    .map((summary) => summary.groupUrl);
const skippedGroupUrls = unique([...skippedGroupUrlsByLimit, ...skippedGroupUrlsByPaidLimit]);
const processedGroupUrls = groupSummaries
    .filter((summary) => summary.runStatus !== 'skipped')
    .map((summary) => summary.groupUrl);
const paidDatasetItemLimitReached = maxPaidDatasetItems !== null && totalOutputPosts >= maxPaidDatasetItems;
const finalSummary = selectedGroupUrls.length === 1
    ? {
        ...groupSummaries[0],
        warnings: [
            ...(groupSummaries[0].warnings || []),
            ...(skippedGroupUrlsByLimit.length ? [`Skipped ${skippedGroupUrlsByLimit.length} group URL(s) because maxGroupsPerRun=${maxGroupsPerRun}.`] : []),
            ...(skippedGroupUrlsByPaidLimit.length ? [`Skipped ${skippedGroupUrlsByPaidLimit.length} group URL(s) because ACTOR_MAX_PAID_DATASET_ITEMS=${maxPaidDatasetItems}.`] : []),
        ],
        groupUrls: requestedGroupUrls,
        processedGroupUrls,
        skippedGroupUrls,
        maxGroupsPerRun,
        maxPaidDatasetItems,
        paidDatasetItemLimitReached,
        outputCheckpoints: {
            [groupSummaries[0].groupUrl]: groupSummaries[0].outputCheckpoint,
        },
        multiGroup: {
            enabled: requestedGroupUrls.length > 1,
            requestedGroupUrls,
            processedGroupUrls,
            skippedGroupUrls,
            maxGroupsPerRun,
            maxPaidDatasetItems,
            paidDatasetItemLimitReached,
            groups: compactGroups,
        },
    }
    : {
        provider: PROVIDER_NAME,
        actorVersion: ACTOR_VERSION,
        runStatus: groupSummaries.every((summary) => summary.runStatus === 'succeeded') ? 'succeeded' : 'partial',
        coverageStatus: groupSummaries.every((summary) => /^complete_/.test(summary.coverageStatus || ''))
            ? 'complete_all_groups'
            : 'partial_some_groups',
        warnings: [
            ...(skippedGroupUrlsByLimit.length ? [`Skipped ${skippedGroupUrlsByLimit.length} group URL(s) because maxGroupsPerRun=${maxGroupsPerRun}.`] : []),
            ...(skippedGroupUrlsByPaidLimit.length ? [`Skipped ${skippedGroupUrlsByPaidLimit.length} group URL(s) because ACTOR_MAX_PAID_DATASET_ITEMS=${maxPaidDatasetItems}.`] : []),
            ...groupSummaries.flatMap((summary) => (summary.warnings || []).map((warning) => `${summary.groupUrl}: ${warning}`)),
        ],
        groupUrls: requestedGroupUrls,
        processedGroupUrls,
        skippedGroupUrls,
        maxGroupsPerRun,
        maxPaidDatasetItems,
        paidDatasetItemLimitReached,
        startedAt: rootStartedAt,
        finishedAt: new Date().toISOString(),
        proxyCountry: proxyCountryForRun,
        outputMode: outputModeForRun,
        datasetRowsPushed: totalDatasetRowsPushed,
        outputPosts: totalOutputPosts,
        groupsProcessed: processedGroupUrls.length,
        groupsRequested: requestedGroupUrls.length,
        groupsSkippedPaidLimit: skippedGroupUrlsByPaidLimit.length,
        groups: compactGroups,
        outputCheckpoints: Object.fromEntries(groupSummaries.map((summary) => [
            summary.groupUrl,
            summary.outputCheckpoint,
        ])),
        textSourceCounts: mergeCountMaps(groupSummaries, 'textSourceCounts'),
        textMissingReasonCounts: mergeCountMaps(groupSummaries, 'textMissingReasonCounts'),
        mediaCompletenessCounts: mergeCountMaps(groupSummaries, 'mediaCompletenessCounts'),
        mediaCompletenessLegacyCounts: mergeCountMaps(groupSummaries, 'mediaCompletenessLegacyCounts'),
        mediaReviewSeverityCounts: mergeCountMaps(groupSummaries, 'mediaReviewSeverityCounts'),
        mediaPlusNRiskPosts: groupSummaries.reduce((sum, summary) => sum + (summary.mediaPlusNRiskPosts || 0), 0),
        feedPhotoTotal: groupSummaries.reduce((sum, summary) => sum + (summary.feedPhotoTotal || 0), 0),
        expandedPhotoTotal: groupSummaries.reduce((sum, summary) => sum + (summary.expandedPhotoTotal || 0), 0),
        finalPhotoTotal: groupSummaries.reduce((sum, summary) => sum + (summary.finalPhotoTotal || 0), 0),
        extraPhotosFound: groupSummaries.reduce((sum, summary) => sum + (summary.extraPhotosFound || 0), 0),
        posts: outputModeForRun === 'summary' ? groupSummaries.flatMap((summary) => summary.posts || []) : undefined,
        postsSample: outputModeForRun === 'posts' ? groupSummaries.flatMap((summary) => summary.postsSample || []).slice(0, 3) : undefined,
        runtimeState: {
            rootVersion: runtimeRootState.rootVersion,
            resumed: runtimeRootState.resumed,
            migrationEvents: runtimeRootState.migrationEvents,
            phase: runtimeRootState.phase,
            updatedAt: runtimeRootState.updatedAt,
        },
    };

await setRunStatus(`Writing summary; output rows ${totalOutputPosts}`);
await Actor.setValue('SUMMARY', finalSummary);
if (outputModeForRun === 'summary') {
    await Actor.pushData(finalSummary);
}
runtimeRootState.phase = 'finished';
runtimeRootState.summary = {
    runStatus: finalSummary.runStatus,
    coverageStatus: finalSummary.coverageStatus,
    outputPosts: totalOutputPosts,
    datasetRowsPushed: totalDatasetRowsPushed,
    groupsProcessed: processedGroupUrls.length,
    maxPaidDatasetItems,
    paidDatasetItemLimitReached,
};
await persistRuntimeState(runtimeRootState, 'finished');
await setRunStatus(`Finished; output rows ${totalOutputPosts}`);
await Actor.exit();
