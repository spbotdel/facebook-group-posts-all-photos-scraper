import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanImageUrls, extractImageUrlsFromHtml, normalizeHtml } from '../src/htmlMedia.js';

test('normalizeHtml decodes Facebook escaped URL separators', () => {
    const escaped = 'https\\u003A\\/\\/scontent.example.com\\/v\\/t39.30808-6\\/photo_n.jpg?oh=1\\u0026oe=2';
    assert.equal(
        normalizeHtml(escaped),
        'https://scontent.example.com/v/t39.30808-6/photo_n.jpg?oh=1&oe=2',
    );
});

test('extractImageUrlsFromHtml finds escaped scontent image URLs', () => {
    const html = '{"uri":"https\\u003A\\/\\/scontent.example.com\\/v\\/t39.30808-6\\/photo_n.jpg?stp=dst-jpg\\u0026oh=1"}';
    const urls = extractImageUrlsFromHtml(html);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^https:\/\/scontent\.example\.com\/v\/t39\.30808-6\/photo_n\.jpg/);
});

test('cleanImageUrls removes small profile/avatar URLs', () => {
    const urls = cleanImageUrls([
        'https://scontent.example.com/v/t39.30808-1/avatar_n.jpg?stp=cp0_dst-jpg&ctp=s40x40',
        'https://scontent.example.com/v/t39.30808-6/photo_n.jpg?stp=dst-jpg&ctp=s960x960',
    ]);
    assert.deepEqual(urls, [
        'https://scontent.example.com/v/t39.30808-6/photo_n.jpg?stp=dst-jpg&ctp=s960x960',
    ]);
});
