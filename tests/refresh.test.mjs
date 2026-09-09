import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { rememberFeedItems } from '../js/feed-state.js';

// Exercise the actual UI refresh function with network and DOM effects stubbed.
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const refresh = main.slice(main.indexOf('    async function performFeedRefresh()'), main.indexOf("    refreshFeedsBtn?.addEventListener('click'"));

function setup(failSave = false) {
    const calls = [];
    const state = { items: [{ id: 'read', seen: true, published: '2020-01-01' }] };
    const context = vm.createContext({
        syncReady: true,
        refreshFeedsBtn: { disabled: false, classList: { add() {}, remove() {} } },
        $: () => null,
        document: { body: { setAttribute() {}, removeAttribute() {} } },
        window: { location: { reload() { calls.push('reload'); } } },
        setFeedSyncStatus() {}, toast() {}, rememberFeedItems,
        gistSync: { getLocal: () => state },
        feedData: [
            { id: 'read', link: 'https://example.com/read', published: '2020-01-01' },
            { id: 'unread', link: 'https://example.com/unread', published: '2020-01-01' }
        ],
        upload: async () => {
            calls.push('save');
            if (failSave) throw new Error('Gist unavailable');
        },
        refreshFeeds: async () => { calls.push('fetch'); }
    });
    vm.runInContext(refresh, context);
    return { calls, state, context };
}

test('refresh saves backlog before fetch and flushes state before reload without marking read', async () => {
    const app = setup();
    assert.equal(await app.context.performFeedRefresh(), true);
    assert.deepEqual(app.calls, ['save', 'fetch', 'save', 'reload']);
    assert.equal(app.state.items.find(item => item.id === 'unread').seen, false);
    assert.equal(app.state.items.find(item => item.id === 'read').seen, true);
    assert.equal(app.state.items.find(item => item.id === 'unread').feed_item.link, 'https://example.com/unread');
});

test('failed backlog save stops refresh and reload, and restores refresh button', async () => {
    const app = setup(true);
    assert.equal(await app.context.performFeedRefresh(), false);
    assert.deepEqual(app.calls, ['save']);
    assert.equal(app.context.refreshFeedsBtn.disabled, false);
});

test('a failed final save leaves the page open after feed fetch', async () => {
    const app = setup();
    let saves = 0;
    app.context.upload = async () => {
        app.calls.push('save');
        if (++saves === 2) throw new Error('Gist unavailable');
    };
    assert.equal(await app.context.performFeedRefresh(), false);
    assert.deepEqual(app.calls, ['save', 'fetch', 'save']);
    assert.equal(app.context.refreshFeedsBtn.disabled, false);
});
