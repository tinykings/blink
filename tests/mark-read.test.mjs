import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { markFeedItemsRead } from '../js/feed-state.js';

// Exercise actual mark-as-read UI function with DOM and sync effects stubbed.
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const markAsRead = main.slice(main.indexOf('    async function performMarkAsRead()'), main.indexOf("    markReadBtn?.addEventListener('click'"));

function setup(failSave = false) {
    const calls = [];
    const state = { items: [
        { id: 'read', seen: true, published: '2020-01-01' },
        { id: 'starred', seen: false, starred: true }
    ] };
    const context = vm.createContext({
        syncReady: true,
        markReadBtn: { disabled: false },
        document: { body: { setAttribute() {}, removeAttribute() {} } },
        setFeedSyncStatus() {}, showFeedSyncMessage() {}, markFeedItemsRead,
        gistSync: { getLocal: () => state, setLocal() {} },
        feedData: [
            { id: 'read', link: 'https://example.com/read', published: '2020-01-01' },
            { id: 'unread', link: 'https://example.com/unread', published: '2020-01-01' },
            { id: 'starred', link: 'https://example.com/starred', published: '2020-01-01' }
        ],
        upload: async () => {
            calls.push('save');
            if (failSave) throw new Error('Gist unavailable');
        },
        renderAll: () => { calls.push('render'); }
    });
    vm.runInContext(markAsRead, context);
    return { calls, state, context };
}

test('mark as read saves current unstarred items without fetching feeds', async () => {
    const app = setup();
    assert.equal(await app.context.performMarkAsRead(), true);
    assert.deepEqual(app.calls, ['save', 'render']);
    assert.equal(app.state.items.find(item => item.id === 'unread').seen, true);
    assert.equal(app.state.items.find(item => item.id === 'read').seen, true);
    assert.equal(app.state.items.find(item => item.id === 'starred').seen, false);
    assert.equal(app.context.markReadBtn.disabled, false);
});

test('failed read-state save leaves page open and restores button', async () => {
    const app = setup(true);
    assert.equal(await app.context.performMarkAsRead(), false);
    assert.deepEqual(app.calls, ['save']);
    assert.equal(app.context.markReadBtn.disabled, false);
});

test('no unread items skips save and still updates view', async () => {
    const app = setup();
    app.context.feedData = [{ id: 'read', link: 'https://example.com/read', published: '2020-01-01' }];
    assert.equal(await app.context.performMarkAsRead(), true);
    assert.deepEqual(app.calls, ['render']);
});
