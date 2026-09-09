import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mergeFeedItems, rememberFeedItems, isSeenVersion } from '../js/feed-state.js';
import { sanitizeItemForStorage } from '../js/storage.js';

const source = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');

function setup(remote) {
    let saved;
    const events = {};
    const context = vm.createContext({
        getRetentionDays: () => 5,
        getTimeOrZero: value => Date.parse(value) || 0,
        sanitizeItemForStorage,
        mergeFeedItems,
        GIST_FILENAME: 'blink-data.json',
        getGitHubConfig: () => ({ gistId: 'test', token: 'test' }),
        isLocalDevelopment: () => false,
        window: { addEventListener: (name, fn) => { events[name] = fn; }, dispatchEvent() {} },
        document: { addEventListener() {} },
        CustomEvent: class {}, console, setTimeout, clearTimeout, URL,
        fetch: async (url, options) => {
            if (options.method === 'PATCH') {
                saved = JSON.parse(JSON.parse(options.body).files['blink-data.json'].content);
                remote = saved;
            }
            return { ok: true, headers: { get: () => null }, json: async () => ({
                updated_at: new Date().toISOString(),
                files: { 'blink-data.json': { content: JSON.stringify(remote) } }
            }) };
        }
    });
    vm.runInContext(source, context);
    return { context, events, saved: () => saved };
}

const now = new Date().toISOString();
const later = new Date(Date.now() + 1000).toISOString();

test('immediate save preserves other device records and merges independent star/read changes', async () => {
    const app = setup({ items: [
        { id: 'remote-only', seen: true, date: now },
        { id: 'shared', seen: false, read_changed_at: later, starred: false, starred_changed_at: now }
    ] });
    app.context.setLocal({ items: [
        { id: 'shared', seen: true, read_changed_at: now, starred: true, starred_changed_at: later }
    ] });
    await app.context.upload();
    const items = app.saved().items;
    assert.equal(items.length, 2);
    const shared = items.find(item => item.id === 'shared');
    assert.equal(shared.seen, false);
    assert.equal(shared.starred, true);
});

test('explicit unread wins over legacy seen flag', async () => {
    const app = setup({ items: [{ id: 'one', seen: true, published: now, date: now }] });
    app.context.setLocal({ items: [{ id: 'one', seen: false, read_changed_at: later, date: now }] });
    await app.context.upload();
    assert.equal(app.saved().items[0].seen, false);
});

test('network reconnect pulls remote changes', async () => {
    const app = setup({ items: [{ id: 'other-device', seen: true, date: now }] });
    app.context.setLocal({ items: [] });
    assert.equal(app.events.focus, undefined);
    await app.events.online();
    assert.equal(app.context.getLocal().items[0].id, 'other-device');
});

test('invalid remote data prevents save', async () => {
    const app = setup({ invalid: true });
    app.context.setLocal({ items: [] });
    await assert.rejects(app.context.upload(), /Invalid Gist data/);
    assert.equal(app.saved(), undefined);
});

const old = '2020-01-01T00:00:00.000Z';
const feedItem = (id, published = old) => ({
    id, published, link: `https://example.com/${id}`, title: id,
    description: 'Full description', thumbnail: 'https://example.com/image.jpg',
    video_id: 'video', feed_title: 'Example'
});

test('unread backlog survives save, reload, empty feeds and retention cutoff', async () => {
    const app = setup({ items: [] });
    const state = { items: [] };
    rememberFeedItems(state, [feedItem('unread')]);
    state.items[0].date = old;
    app.context.setLocal(state);
    await app.context.upload();
    const reloaded = setup(app.saved());
    await reloaded.context.syncOnStartup();
    const items = mergeFeedItems(reloaded.context.getLocal().items.map(item => item.feed_item), []);
    assert.deepEqual(items, [feedItem('unread')]);
    assert.equal(reloaded.context.getLocal().items[0].seen, false);
});

test('read backlog drops content but keeps old read marker against stale tabs', async () => {
    const snapshot = feedItem('read');
    const app = setup({ items: [{
        id: 'read', tracked: true, seen: true, published: old, read_changed_at: old, date: old
    }] });
    app.context.setLocal({ items: [{
        id: 'read', tracked: true, seen: false, date: old, feed_item: snapshot
    }] });
    await app.context.upload();
    const record = app.saved().items[0];
    assert.equal(record.seen, true);
    assert.equal(record.tracked, true);
    assert.equal(record.feed_item, undefined);
});

test('new feed version stays unread without changing previously read version', async () => {
    const state = { items: [{
        id: 'updated', tracked: true, seen: true, published: old, read_changed_at: old, date: old
    }] };
    rememberFeedItems(state, [feedItem('updated', now)]);
    const app = setup({ items: [] });
    app.context.setLocal(state);
    await app.context.upload();
    const record = app.saved().items[0];
    assert.equal(record.published, old);
    assert.equal(record.read_changed_at, old);
    assert.equal(record.feed_item.published, now);
    assert.equal(isSeenVersion(record.feed_item, record), false);
});

test('backlog merges across devices without duplicate IDs or older snapshot replacing new', async () => {
    const remote = { items: [] };
    rememberFeedItems(remote, [feedItem('shared', now), feedItem('remote-only')]);
    const local = { items: [] };
    rememberFeedItems(local, [feedItem('shared'), feedItem('local-only')]);
    const app = setup(remote);
    app.context.setLocal(local);
    await app.context.upload();
    const items = app.saved().items;
    assert.equal(items.length, 3);
    assert.equal(items.find(item => item.id === 'shared').feed_item.published, now);
});

test('large truncated Gist downloads raw content without sending OAuth token', async () => {
    const app = setup({ items: [] });
    const requests = [];
    app.context.fetch = async (url, options) => {
        requests.push({ url, options });
        if (requests.length === 1) return {
            ok: true, headers: { get: () => null }, json: async () => ({ files: {
                'blink-data.json': { truncated: true, content: '{', raw_url: 'https://gist.githubusercontent.com/test/raw/data' }
            } })
        };
        return { ok: true, text: async () => JSON.stringify({ items: [{ id: 'large', seen: false }] }) };
    };
    assert.equal(await app.context.syncOnStartup(), true);
    assert.equal(app.context.getLocal().items[0].id, 'large');
    assert.equal(requests[1].options.headers, undefined);
    assert.equal(requests[1].options.credentials, 'omit');
});

test('newly fetched content with unchanged publication date wins over old content', async () => {
    const remote = { items: [{
        id: 'shared', tracked: true, seen: false, date: old,
        feed_item: feedItem('shared'), feed_item_updated_at: old
    }] };
    const state = { items: [structuredClone(remote.items[0])] };
    const updated = { ...feedItem('shared'), title: 'Corrected title' };
    rememberFeedItems(state, [updated]);
    const app = setup(remote);
    app.context.setLocal(state);
    await app.context.upload();
    assert.equal(app.saved().items[0].feed_item.title, 'Corrected title');
    assert.equal(rememberFeedItems(app.context.getLocal(), [updated]), false);
});

test('local development persists and restores unread content using the same storage format', async () => {
    const app = setup({ items: [] });
    const store = new Map();
    app.context.isLocalDevelopment = () => true;
    app.context.localStorage = {
        getItem: key => store.get(key) || null,
        setItem: (key, value) => store.set(key, value)
    };
    const state = { items: [] };
    rememberFeedItems(state, [feedItem('local')]);
    app.context.setLocal(state);
    await app.context.upload();
    app.context.setLocal({ items: [] });
    assert.equal(await app.context.syncOnStartup(), true);
    assert.equal(app.context.getLocal().items[0].feed_item.description, 'Full description');
});
