import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const auth = readFileSync(new URL('../js/github-auth.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '')
    .replace(/export /g, '')
    .replace('{ GIST_FILENAME };', '');
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

for (const repository of ['someone/my-reader', 'another/fork']) {
    test(`footer links to deployed repository ${repository}`, () => {
        const repoLink = {};
        const context = vm.createContext({ FEED_REPOSITORY: repository, repoLink });
        vm.runInContext(auth, context);
        const assignment = main.match(/    if \(repoLink\) repoLink.href = .*;/)[0];
        vm.runInContext(assignment, context);
        assert.equal(repoLink.href, `https://github.com/${repository}`);
    });
}

test('unconfigured local repository uses the project fallback', () => {
    const context = vm.createContext({ FEED_REPOSITORY: '__FEED_REPOSITORY__' });
    vm.runInContext(auth, context);
    assert.equal(vm.runInContext('getFeedRepository()', context), 'tinykings/blink');
});

for (const file of ['index.html', 'index.template.html']) {
    test(`${file} has a GitHub footer link and no feed manager or settings`, () => {
        const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(html, /<a id="repo-link"[^>]*class="btn floating-btn github-btn"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
        assert.equal((html.match(/id="repo-link"/g) || []).length, 1);
        assert.doesNotMatch(html, /id="(?:settings-link|settings-modal|feeds-modal|manage-feeds-btn|disable-shorts-toggle)"/);
        assert.match(html, /id="setup-connect-github-btn"/);
        assert.match(html, /id="mark-read-btn"/);
    });
}
