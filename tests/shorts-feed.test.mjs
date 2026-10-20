import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shouldShowInFeed } from '../js/feed-state.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const renderFeed = main.slice(main.indexOf('    function renderFeed()'), main.indexOf('    function visibleItems()'));
const isShort = main.match(/    function isShort\(item\) .*\n/)[0];

for (const enabled of [true, false]) {
    test(`Shorts ${enabled ? 'appear in' : 'are excluded from'} the regular feed when ${enabled ? 'enabled' : 'disabled'}`, () => {
        const context = vm.createContext({
            feedEl: {}, feedRenderObserver: null,
            rssSettings: { disableShorts: !enabled },
            feedData: [
                { id: 'video', link: 'https://www.youtube.com/watch?v=normal' },
                { id: 'short', link: 'https://www.youtube.com/shorts/short' },
                { id: 'read-short', link: 'https://www.youtube.com/shorts/read' },
                { id: 'starred-short', link: 'https://www.youtube.com/shorts/starred' }
            ],
            displayedStarGroup: new Map(), starredIds: new Set(['starred-short']),
            metaById: new Map([
                ['read-short', { seen: true }],
                ['starred-short', { starred: true }]
            ]),
            meta: { items: [] }, archivedItems: () => [], shouldShowInFeed,
            appendFeedBatch() {}, $: () => null
        });
        vm.runInContext(isShort + renderFeed + '\nrenderFeed();', context);
        const ids = Array.from(context.feedRenderQueue).filter(entry => entry.item).map(entry => entry.item.id);
        assert.deepEqual(ids, enabled ? ['video', 'short', 'starred-short'] : ['video']);
    });
}

test('custom Shorts controls and viewer are removed', () => {
    for (const file of ['index.html', 'index.template.html']) {
        const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(html, /id="(?:shorts-btn|shorts-viewer|shorts-stage|shorts-empty-status|mark-shorts-done-btn)"/);
    }
    assert.doesNotMatch(main, /openShorts|shortsViewer|shortsTouch/);
});
