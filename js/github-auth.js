import { GIST_AUTH_URL } from './config.js';

const OAUTH_APP = 'blink';
const GIST_FILENAME = 'blink-data.json';
const GIST_DESCRIPTION = 'Blink Sync Data';
const API_BASE = 'https://api.github.com';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_KEY = `${OAUTH_APP}:github-token`;
const GIST_KEY = `${OAUTH_APP}:gist-id`;
const LOGIN_KEY = `${OAUTH_APP}:github-login`;
const FEED_REPOSITORY = 'tinykings/blink';
const FEED_WORKFLOW = 'main.yml';
const WORKFLOW_TIMEOUT_MS = 10 * 60 * 1000;
const WORKFLOW_POLL_MS = 3000;

function workerUrl() {
    if (!GIST_AUTH_URL || GIST_AUTH_URL === '__GIST_AUTH_URL__') {
        throw new Error('GitHub connection is not configured');
    }
    const url = new URL(GIST_AUTH_URL);
    return url;
}

function githubHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

async function githubRequest(path, token, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...githubHeaders(token),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    if (!response.ok) {
        let message = `GitHub request failed: ${response.status}`;
        try {
            const body = await response.json();
            if (body.message) message = body.message;
        } catch { /* Keep status message. */ }
        throw new Error(message);
    }
    return response.json();
}

async function findOrCreateGist(token) {
    for (let page = 1; page <= 10; page += 1) {
        const gists = await githubRequest(`/gists?per_page=100&page=${page}`, token);
        const match = gists.find(gist => gist.files && gist.files[GIST_FILENAME]);
        if (match) return match.id;
        if (gists.length < 100) break;
    }

    const gist = await githubRequest('/gists', token, {
        method: 'POST',
        body: JSON.stringify({
            description: GIST_DESCRIPTION,
            public: false,
            files: {
                [GIST_FILENAME]: { content: JSON.stringify({ items: [] }, null, 2) }
            }
        })
    });
    return gist.id;
}

function waitForOAuthMessage(popup, expectedOrigin) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            window.removeEventListener('message', onMessage);
            clearInterval(closedCheck);
            clearTimeout(timeout);
            callback(value);
        };
        const onMessage = event => {
            if (event.origin !== expectedOrigin || event.source !== popup) return;
            if (!event.data || event.data.type !== 'gist-oauth:complete') return;
            if (event.data.error) finish(reject, new Error(event.data.error));
            else if (event.data.code) finish(resolve, event.data.code);
            else finish(reject, new Error('OAuth response did not include a code'));
        };
        window.addEventListener('message', onMessage);
        const closedCheck = setInterval(() => {
            if (popup.closed) finish(reject, new Error('GitHub connection was cancelled'));
        }, 500);
        const timeout = setTimeout(() => {
            try { popup.close(); } catch { /* Popup may already be closed. */ }
            finish(reject, new Error('GitHub connection timed out'));
        }, OAUTH_TIMEOUT_MS);
    });
}

function workerEndpoint(baseUrl, path) {
    return new URL(`${baseUrl.href.replace(/\/+$/, '')}${path}`);
}

async function redeemCode(baseUrl, code) {
    const redeemUrl = workerEndpoint(baseUrl, '/auth/redeem');
    const response = await fetch(redeemUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) {
        throw new Error(data.error || `OAuth redeem failed: ${response.status}`);
    }
    return data;
}

export async function connectGitHub() {
    const baseUrl = workerUrl();
    const startUrl = workerEndpoint(baseUrl, '/auth/github/start');
    startUrl.searchParams.set('app', OAUTH_APP);
    startUrl.searchParams.set('origin', window.location.origin);

    const popup = window.open(startUrl, 'gist-github-oauth', 'popup,width=600,height=720');
    if (!popup) throw new Error('Popup blocked. Allow popups and try again.');

    const code = await waitForOAuthMessage(popup, baseUrl.origin);
    try { popup.close(); } catch { /* Popup may already be closed. */ }
    const { token, login } = await redeemCode(baseUrl, code);
    const gistId = await findOrCreateGist(token);

    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(GIST_KEY, gistId);
    if (login) localStorage.setItem(LOGIN_KEY, login);
    else localStorage.removeItem(LOGIN_KEY);
    return { login, gistId };
}

export function disconnectGitHub() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    localStorage.removeItem(LOGIN_KEY);
}

export function getGitHubConfig() {
    return {
        token: localStorage.getItem(TOKEN_KEY),
        gistId: localStorage.getItem(GIST_KEY),
        login: localStorage.getItem(LOGIN_KEY)
    };
}

export function getGitHubLogin() {
    return getGitHubConfig().login;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function actionsRequest(path, token, options = {}) {
    const response = await fetch(`${API_BASE}/repos/${FEED_REPOSITORY}${path}`, {
        ...options,
        headers: {
            ...githubHeaders(token),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    if (!response.ok) {
        let message = `GitHub Actions request failed: ${response.status}`;
        try {
            const body = await response.json();
            if (body.message) message = body.message;
        } catch { /* Keep status message. */ }
        if (response.status === 401 || response.status === 403 || response.status === 404) {
            message = 'GitHub connection lacks Actions access. Update OAuth permissions, then reconnect.';
        }
        throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
}

export async function refreshFeeds(onProgress = () => {}) {
    const { token } = getGitHubConfig();
    if (!token) throw new Error('Connect GitHub before refreshing feeds.');

    const dispatchedAt = Date.now();
    onProgress('Starting feed refresh...');
    await actionsRequest(`/actions/workflows/${FEED_WORKFLOW}/dispatches`, token, {
        method: 'POST',
        body: JSON.stringify({ ref: 'main' })
    });

    const deadline = dispatchedAt + WORKFLOW_TIMEOUT_MS;
    let runId = null;
    let lastState = '';
    let requestFailures = 0;

    while (Date.now() < deadline) {
        await wait(WORKFLOW_POLL_MS);
        try {
            const data = await actionsRequest(`/actions/workflows/${FEED_WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=10`, token);
            requestFailures = 0;
            const run = runId
                ? data.workflow_runs.find(candidate => candidate.id === runId)
                : data.workflow_runs.find(candidate => new Date(candidate.created_at).getTime() >= dispatchedAt - 5000);
            if (!run) {
                if (lastState !== 'waiting') {
                    onProgress('Waiting for GitHub Actions...');
                    lastState = 'waiting';
                }
                continue;
            }
            runId = run.id;
            if (run.status === 'completed') {
                if (run.conclusion !== 'success') {
                    throw new Error(`Feed refresh ${run.conclusion || 'failed'}. Open GitHub Actions for details.`);
                }
                onProgress('Feeds refreshed. Reloading...');
                return run;
            }
            const state = run.status === 'queued' ? 'queued' : 'running';
            if (state !== lastState) {
                onProgress(state === 'queued' ? 'Feed refresh queued...' : 'Fetching RSS feeds...');
                lastState = state;
            }
        } catch (error) {
            if (error.message.startsWith('Feed refresh ')) throw error;
            requestFailures += 1;
            if (requestFailures >= 3) throw error;
        }
    }
    throw new Error('Feed refresh timed out. Check GitHub Actions for status.');
}

export { GIST_FILENAME };
