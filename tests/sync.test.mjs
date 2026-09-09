import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');

function setup(remote) {
    let saved;
    const events = {};
    const context = vm.createContext({
        getRetentionDays: () => 5,
        getTimeOrZero: value => Date.parse(value) || 0,
        sanitizeItemForStorage: value => value,
        GIST_FILENAME: 'blink-data.json',
        getGitHubConfig: () => ({ gistId: 'test', token: 'test' }),
        isLocalDevelopment: () => false,
        window: { addEventListener: (name, fn) => { events[name] = fn; }, dispatchEvent() {} },
        document: { addEventListener() {} },
        CustomEvent: class {}, console, setTimeout, clearTimeout,
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

test('tab focus pulls remote changes', async () => {
    const app = setup({ items: [{ id: 'other-device', seen: true, date: now }] });
    app.context.setLocal({ items: [] });
    await app.events.focus();
    assert.equal(app.context.getLocal().items[0].id, 'other-device');
});

test('invalid remote data prevents save', async () => {
    const app = setup({ invalid: true });
    app.context.setLocal({ items: [] });
    await assert.rejects(app.context.upload(), /Invalid Gist data/);
    assert.equal(app.saved(), undefined);
});
