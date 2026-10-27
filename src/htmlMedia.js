import { decode } from 'html-entities';

export function normalizeHtml(value) {
    return decode(String(value || '')
        .replace(/\\\//g, '/')
        .replace(/\\u0025/g, '%')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003d/g, '=')
        .replace(/\\u003f/g, '?')
        .replace(/\\u003a/g, ':')
        .replace(/\\u003A/g, ':')
        .replace(/\\u002F/g, '/')
        .replace(/\\u003C/g, '<')
        .replace(/\\u003E/g, '>'));
}

export function extractImageUrlsFromHtml(text) {
    const decoded = normalizeHtml(text);
    const urls = [];
    const patterns = [
        /https?:\/\/[^"'<>\\\s]+?(?:jpg|jpeg|png|webp)[^"'<>\\\s]*/gi,
        /https?:\\\/\\\/[^"'<>\\\s]+?(?:jpg|jpeg|png|webp)[^"'<>\\\s]*/gi,
    ];
    for (const pattern of patterns) {
        for (const match of decoded.matchAll(pattern)) {
            const url = normalizeHtml(match[0]);
            if (/(?:fbcdn|scontent)/i.test(url)) urls.push(url);
        }
    }
    return unique(urls).filter((url) => /\/v\/t\d|\/m1\/v\/|scontent/i.test(url));
}

export function mediaKey(url) {
    const value = String(url || '');
    const match = value.match(/\/([^/?]+?_n\.(?:jpg|jpeg|png|webp))/i);
    return match?.[1] || value.split('?')[0];
}

function mediaScore(url) {
    const value = String(url || '');
    let score = 0;
    if (/\/v\/t39\.30808-6\//.test(value)) score += 50;
    if (/\/v\/t45\.5328-4\//.test(value)) score += 50;
    if (/[?&]ctp=s/i.test(value)) score += 20;
    if (/[?&]ctp=p/i.test(value)) score += 5;
    for (const [, width, height] of value.matchAll(/(?:s|p|mx)(\d{2,4})x(\d{2,4})/gi)) {
        score += Math.min(Number(width) * Number(height), 3_000_000) / 100_000;
    }
    return score;
}

function isLikelyAvatar(url) {
    const value = String(url || '');
    const small = '(?:24|32|40|50|60|80)';
    return /\/v\/t39\.30808-1\//.test(value)
        || /\/v\/t1\.30497-1\//.test(value)
        || new RegExp(`[?&]ctp=s${small}x${small}`, 'i').test(value)
        || new RegExp(`[?&]stp=[^&]*s${small}x${small}`, 'i').test(value)
        || /[?&]_nc_sid=(?:e99d92|7565cd|33e84f)/i.test(value);
}

export function cleanImageUrls(urls) {
    const best = new Map();
    for (const url of urls || []) {
        if (!url || isLikelyAvatar(url)) continue;
        const key = mediaKey(url);
        const previous = best.get(key);
        if (!previous || mediaScore(url) > mediaScore(previous)) best.set(key, url);
    }
    return [...best.values()];
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}
