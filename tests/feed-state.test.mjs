import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeenVersion, isUnreadVersion, mergeFeedItems, rememberFeedItems, shouldShowInUnreadView } from '../js/feed-state.js';
import { sanitizeItemForStorage } from '../js/storage.js';

const item = { id: 'one', link: 'https://example.com/one', published: '2020-01-01T00:00:00Z', title: 'One', description: 'Keep this description' };

test('repeated snapshots are idempotent and do not change read/star state', () => {
    const state = { items: [{ id: 'one', seen: false, starred: true, read_changed_at: '2024-01-01T00:00:00Z' }] };
    assert.equal(rememberFeedItems(state, [item, item]), true);
    const saved = structuredClone(state);
    assert.equal(rememberFeedItems(state, [item, item]), false);
    assert.deepEqual(state, saved);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].seen, false);
    assert.equal(state.items[0].starred, true);
});

test('an older feed page cannot roll back the snapshot', () => {
    const newer = { ...item, published: '2025-01-01T00:00:00Z', title: 'Updated' };
    const state = { items: [] };
    rememberFeedItems(state, [newer]);
    assert.equal(rememberFeedItems(state, [item]), false);
    assert.deepEqual(mergeFeedItems([newer], [item]), [newer]);
});

test('read snapshot content is removed from storage, while unread and starred content survive', () => {
    const record = { id: item.id, tracked: true, seen: true, published: item.published, feed_item: item, title: item.title, url: item.link };
    assert.equal(sanitizeItemForStorage(record).feed_item, undefined);
    assert.equal(sanitizeItemForStorage({ ...record, seen: false }).feed_item.description, item.description);
    assert.equal(sanitizeItemForStorage({ ...record, starred: true }).feed_item.description, item.description);
    assert.equal(sanitizeItemForStorage(record).tracked, true);
    assert.equal(sanitizeItemForStorage(record).title, undefined);
    assert.equal(sanitizeItemForStorage(record).url, undefined);
});

test('starred items are excluded from unread status but remain in unread view', () => {
    const readStarred = { id: item.id, seen: true, starred: true, published: item.published };
    const unreadStarred = { ...readStarred, seen: false };
    assert.equal(isUnreadVersion(item, readStarred), false);
    assert.equal(isUnreadVersion(item, unreadStarred), false);
    assert.equal(shouldShowInUnreadView(item, readStarred), true);
    assert.equal(shouldShowInUnreadView(item, unreadStarred), true);
});

test('unstarred items retain normal unread filtering', () => {
    assert.equal(isUnreadVersion(item, { seen: false, starred: false }), true);
    assert.equal(shouldShowInUnreadView(item, { seen: false, starred: false }), true);
    assert.equal(isUnreadVersion(item, { seen: true, starred: false, published: item.published }), false);
    assert.equal(shouldShowInUnreadView(item, { seen: true, starred: false, published: item.published }), false);
});

test('read markers refer to the read version, not the latest stored snapshot', () => {
    const state = { items: [{ id: item.id, seen: true, published: item.published }] };
    const newer = { ...item, published: '2025-01-01T00:00:00Z' };
    rememberFeedItems(state, [newer]);
    assert.equal(isSeenVersion(newer, state.items[0]), false);
    assert.equal(isSeenVersion(item, state.items[0]), true);
});
