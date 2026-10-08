import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeenVersion, isUnreadVersion, markFeedItemsRead, mergeFeedItems, rememberFeedItems, shouldShowInFeed } from '../js/feed-state.js';
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

test('fresh feed content wins when the publication timestamp is unchanged', () => {
    const previous = { ...item, title: 'Old title' };
    const state = { items: [{ id: item.id, seen: false, starred: true, feed_item: previous }] };
    assert.equal(rememberFeedItems(state, [item]), true);
    assert.equal(state.items[0].feed_item.title, item.title);
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

test('marking feed items read updates unstarred versions and preserves starred items', () => {
    const changedAt = '2025-02-01T00:00:00Z';
    const state = { items: [{ id: 'starred', starred: true, seen: false }] };
    const starred = { ...item, id: 'starred' };

    assert.equal(markFeedItemsRead(state, [item, starred], changedAt), true);
    assert.deepEqual(state.items.find(record => record.id === item.id), {
        id: item.id,
        date: changedAt,
        starred: false,
        tracked: true,
        seen: true,
        published: item.published,
        read_changed_at: changedAt
    });
    assert.deepEqual(state.items.find(record => record.id === 'starred'), { id: 'starred', starred: true, seen: false });
    assert.equal(state.updated_at, changedAt);
});

test('marking feed items read is idempotent for an already-read version', () => {
    const state = { items: [{ id: item.id, starred: false, seen: true, published: item.published }] };
    assert.equal(markFeedItemsRead(state, [item], '2025-02-01T00:00:00Z'), false);
    assert.equal(state.updated_at, undefined);
});

test('starred items are excluded from unread status but remain in the feed', () => {
    const readStarred = { id: item.id, seen: true, starred: true, published: item.published };
    const unreadStarred = { ...readStarred, seen: false };
    assert.equal(isUnreadVersion(item, readStarred), false);
    assert.equal(isUnreadVersion(item, unreadStarred), false);
    assert.equal(shouldShowInFeed(item, readStarred), true);
    assert.equal(shouldShowInFeed(item, unreadStarred), true);
});

test('unstarred items retain normal unread filtering', () => {
    assert.equal(isUnreadVersion(item, { seen: false, starred: false }), true);
    assert.equal(shouldShowInFeed(item, { seen: false, starred: false }), true);
    assert.equal(isUnreadVersion(item, { seen: true, starred: false, published: item.published }), false);
    assert.equal(shouldShowInFeed(item, { seen: true, starred: false, published: item.published }), false);
});

test('read markers refer to the read version, not the latest stored snapshot', () => {
    const state = { items: [{ id: item.id, seen: true, published: item.published }] };
    const newer = { ...item, published: '2025-01-01T00:00:00Z' };
    rememberFeedItems(state, [newer]);
    assert.equal(isSeenVersion(newer, state.items[0]), false);
    assert.equal(isSeenVersion(item, state.items[0]), true);
});
