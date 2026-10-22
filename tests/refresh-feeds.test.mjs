import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const auth = readFileSync(new URL('../js/github-auth.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '')
    .replace(/export /g, '')
    .replace('{ GIST_FILENAME };', '');

function setup({ token = 'token', runs = [] } = {}) {
    const calls = [];
    const messages = [];
    let poll = 0;
    const context = vm.createContext({
        FEED_REPOSITORY: 'owner/repo',
        LOCAL_DEV: false,
        localStorage: {
            getItem: key => (key.endsWith(':github-token') ? token : null)
        },
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            if (options.method === 'POST') {
                return { ok: true, status: 204, json: async () => ({}) };
            }
            const run = runs[Math.min(poll, runs.length - 1)];
            poll += 1;
            return { ok: true, status: 200, json: async () => ({ workflow_runs: [run] }) };
        },
        setTimeout: callback => callback(),
        console
    });
    vm.runInContext(auth, context);
    return {
        calls,
        messages,
        refresh: () => context.refreshFeeds(message => messages.push(message))
    };
}

test('feed refresh dispatches the workflow and checks its status before finishing', async () => {
    const created = new Date().toISOString();
    const app = setup({ runs: [
        { id: 7, status: 'queued', conclusion: null, created_at: created },
        { id: 7, status: 'in_progress', conclusion: null, created_at: created },
        { id: 7, status: 'completed', conclusion: 'success', created_at: created }
    ] });
    const run = await app.refresh();
    assert.equal(run.id, 7);
    assert.match(app.calls[0].url, /\/repos\/owner\/repo\/actions\/workflows\/main\.yml\/dispatches$/);
    assert.equal(app.calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(app.calls[0].options.body), { ref: 'main' });
    assert.match(app.calls[1].url, /\/actions\/workflows\/main\.yml\/runs\?event=workflow_dispatch/);
    assert.deepEqual(app.messages, [
        'Starting feed refresh...',
        'Feed refresh queued...',
        'Fetching RSS feeds...',
        'Feeds refreshed. Reloading...'
    ]);
});

test('failed feed refresh reports the workflow conclusion', async () => {
    const app = setup({ runs: [
        { id: 7, status: 'completed', conclusion: 'failure', created_at: new Date().toISOString() }
    ] });
    await assert.rejects(app.refresh(), /Feed refresh failure/);
    assert.ok(!app.messages.includes('Feeds refreshed. Reloading...'));
});

test('feed refresh requires a connected GitHub token', async () => {
    const app = setup({ token: null });
    await assert.rejects(app.refresh(), /Connect GitHub/);
    assert.equal(app.calls.length, 0);
});
