import { createYouTubePlayer, stopVideoByItemId, videoPlayers } from './youtube.js';
import { getStarredItems } from './storage.js';
import { isUnreadVersion, mergeFeedItems, rememberFeedItems, shouldShowInUnreadView } from './feed-state.js';
import { gistSync, upload } from './sync.js';
import {
    connectGitHub,
    disconnectGitHub,
    getFeedRepository,
    getFeedsFile,
    getGitHubConfig,
    getGitHubLogin,
    isLocalDevelopment,
    refreshFeeds,
    updateFeedsFile
} from './github-auth.js';

let meta = { items: [] };
let rssSettings = { disableShorts: true };

function relTime(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (!isFinite(diff)) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatUpdatedAt(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (!isFinite(date.getTime())) return '';
    const datePart = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).format(date);
    return `${datePart}, ${timePart} PST`;
}

function makeLinksClickable(html) {
    // Only linkify URLs that aren't already inside anchor tags
    const urlRegex = /(?:^|[^">])((https?:\/\/[^\s<]+))/g;
    return html.replace(urlRegex, '$1<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function toast(msg, type = 'info', ms = 3000) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast${type !== 'info' ? ` ${type}` : ''}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
        t.classList.add('out');
        t.addEventListener('animationend', () => t.remove());
    }, ms);
}

function $(id) { return document.getElementById(id); }

function parseFeedsFile(content) {
    const feeds = [];
    let type = 'rss';
    let pendingName = '';
    content.split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;
        if (line.toLowerCase() === '#settings') {
            type = 'settings';
            pendingName = '';
        } else if (line.toLowerCase() === '#rss') {
            type = 'rss';
            pendingName = '';
        } else if (line.toLowerCase() === '#youtube') {
            type = 'youtube';
            pendingName = '';
        } else if (line.startsWith('#')) {
            pendingName = line.slice(1).trim();
        } else if (type === 'settings') {
            const [key, value] = line.split('=', 2);
            if (key === 'include_youtube_shorts') rssSettings.disableShorts = !['true', '1', 'yes', 'on'].includes((value || '').trim().toLowerCase());
            if (key === 'disable_shorts') rssSettings.disableShorts = ['true', '1', 'yes', 'on'].includes((value || '').trim().toLowerCase());
        } else {
            feeds.push({ type, url: line, name: pendingName });
            pendingName = '';
        }
    });
    return feeds;
}

function serializeFeedsFile(feeds, settings = { disableShorts: true }) {
    const rss = feeds.filter(feed => feed.type === 'rss');
    const youtube = feeds.filter(feed => feed.type === 'youtube');
    const lines = ['#settings', `include_youtube_shorts=${!settings.disableShorts}`, '', '#rss'];
    rss.forEach(feed => {
        if (feed.name) lines.push(`# ${feed.name}`);
        lines.push(feed.url.trim());
    });
    lines.push('', '#youtube');
    youtube.forEach(feed => {
        if (feed.name) lines.push(`# ${feed.name}`);
        lines.push(feed.url.trim());
    });
    return `${lines.join('\n')}\n`;
}

function validFeedUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function isYouTubeUrl(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
        return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    } catch {
        return false;
    }
}

function inferFeedType(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
        return hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
            ? 'youtube'
            : 'rss';
    } catch {
        return 'rss';
    }
}

function feedDisplayName(feed) {
    if (feed.name) return feed.name;
    try {
        return new URL(feed.url).hostname.replace(/^www\./, '');
    } catch {
        return 'Unnamed feed';
    }
}

function feedColor(name) {
    if (!name) return '';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `oklch(65% 0.08 ${hue})`;
}

let prevFocus = null;
let focusTrapEl = null;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapKeydown(e) {
    if (e.key !== 'Tab' || !focusTrapEl || !focusTrapEl.classList.contains('open')) return;
    const focusable = focusTrapEl.querySelectorAll(FOCUSABLE);
    if (!focusable.length) return;
    const current = document.activeElement;
    if (e.shiftKey) {
        if (current === focusable[0]) {
            e.preventDefault();
            focusable[focusable.length - 1].focus();
        }
    } else {
        if (current === focusable[focusable.length - 1]) {
            e.preventDefault();
            focusable[0].focus();
        }
    }
}

function openModal(modal) {
    if (modal.classList.contains('open')) return;
    prevFocus = document.activeElement;
    focusTrapEl = modal;
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('open');
    const first = modal.querySelector(FOCUSABLE);
    if (first) first.focus();
}

function closeModal(modal) {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    const onEnd = () => {
        if (!modal.classList.contains('open')) modal.style.display = 'none';
    };
    modal.addEventListener('transitionend', onEnd, { once: true });
    if (focusTrapEl === modal) focusTrapEl = null;
    if (prevFocus) {
        prevFocus.focus();
        prevFocus = null;
    }
}

document.addEventListener('keydown', trapKeydown);

document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = $('settings-modal');
    const statusEl = $('status');
    const setupStatusEl = $('setup-status');
    const connectBtn = $('connect-github-btn');
    const setupConnectBtn = $('setup-connect-github-btn');
    const disconnectBtn = $('disconnect-github-btn');
    const closeBtn = $('close-btn');
    const feedEl = $('feed');
    const viewBtn = $('view-btn');
    const manageFeedsBtn = $('manage-feeds-btn');
    const feedsModal = $('feeds-modal');
    const closeFeedsBtn = $('close-feeds-btn');
    const feedsStatus = $('feeds-status');
    const feedsSummary = $('feeds-summary');
    const feedList = $('feed-list');
    const feedSearch = $('feed-search');
    const addFeedForm = $('add-feed-form');
    const refreshFeedsBtn = $('refresh-feeds-btn');
    const feedSyncStatus = $('feed-sync-status');
    const feedSyncText = $('feed-sync-text');
    const emptyEl = $('empty');
    const repoLink = $('repo-link');
    const loadingEl = $('loading');
    const keyboardHelp = $('keyboard-help');
    const setupForm = $('setup-form');
    const shortsBtn = $('shorts-btn');
    const shortsEmptyStatus = $('shorts-empty-status');
    const shortsViewer = $('shorts-viewer');
    const shortsStage = $('shorts-stage');
    const shortsViewerTitle = $('shorts-viewer-title');
    const closeShortsBtn = $('close-shorts-btn');
    const markShortsDoneBtn = $('mark-shorts-done-btn');

    let feedData = [];
    let feedById = new Map();
    let firstFeedRender = true;
    let showingNew = true;
    let showingDesc = false;
    let currentIdx = -1;
    let syncReady = false;
    let starSyncPending = false;
    const displayedStarGroup = new Map();
    let managedFeeds = [];
    let feedsSha = '';
    let feedsDirty = false;
    let selectedFeedIndex = null;
    let addingFeed = false;
    const pageSettings = document.body?.dataset || {};
    rssSettings = {
        disableShorts: pageSettings.disableShorts !== 'false'
    };
    let shortsItems = [];
    let shortsIndex = 0;
    let shortsEmptyStatusTimer;
    let feedSyncStatusTimer;

    if (refreshFeedsBtn) refreshFeedsBtn.disabled = true;
    if (manageFeedsBtn) manageFeedsBtn.disabled = true;

    const emptyVariants = [
        ['All clear', 'Nothing new since last check'],
        ["You're all caught up", 'No new items right now'],
        ['Up to date', 'Check back whenever you like']
    ];
    const pick = emptyVariants[Math.floor(Math.random() * emptyVariants.length)];
    const emptyTitle = emptyEl?.querySelector('.title');
    const emptySub = emptyEl?.querySelector('.sub');
    if (emptyTitle && emptySub) { emptyTitle.textContent = pick[0]; emptySub.textContent = pick[1]; }

    const dataEl = $('feed-data');
    if (dataEl) {
        try {
            feedData = JSON.parse(dataEl.textContent);
            feedById = new Map(feedData.map(i => [i.id, i]));
        } catch (e) {
            console.error('Feed parse error:', e);
        }
    }

    const { gistId: hasGist, token: hasToken } = getGitHubConfig();
    const localDev = isLocalDevelopment();
    const floatingBtns = $('floating-buttons');
    const updateHeader = document.querySelector('.update-header');
    if (!localDev && (!hasGist || !hasToken)) {
        if (setupForm) setupForm.style.display = 'flex';
        if (loadingEl) loadingEl.style.display = 'none';
        if (feedEl) feedEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'none';
        if (floatingBtns) floatingBtns.style.display = 'none';
        if (updateHeader) updateHeader.style.display = 'none';
    }

    function setStatus(msg, type = 'info', target = statusEl) {
        if (!target) return;
        target.textContent = msg;
        target.className = `status ${type}`;
    }
    function clearStatus(target = statusEl) {
        if (!target) return;
        target.textContent = '';
        target.className = 'status';
    }

    function setFeedSyncStatus(message, type = 'progress') {
        if (!feedSyncStatus || !feedSyncText) return;
        clearTimeout(feedSyncStatusTimer);
        feedSyncText.textContent = message;
        feedSyncStatus.className = `feed-sync-status ${type}`;
        feedSyncStatus.hidden = false;
    }

    function showFeedSyncMessage(message, type, ms) {
        if (!feedSyncStatus) return;
        setFeedSyncStatus(message, type);
        feedSyncStatusTimer = setTimeout(() => { feedSyncStatus.hidden = true; }, ms);
    }

    function setUpdatedAtText() {
        const text = formatUpdatedAt(meta?.updated_at) || updateHeader?.textContent.trim() || '';
        if (text) {
            const starredCount = (meta.items || []).filter(i => i.starred).length;
            const display = starredCount > 0 ? `${text} · ★ ${starredCount}` : text;
            if (updateHeader) updateHeader.textContent = display;
        }
    }

    function openSettings() {
        openModal(settingsModal);
        clearStatus();
        const login = getGitHubLogin();
        const { token, gistId } = getGitHubConfig();
        const connected = token && gistId;
        const connectionEl = $('github-connection');
        if (connectionEl) connectionEl.textContent = localDev
            ? 'Local development · GitHub disabled'
            : connected
                ? `Connected${login ? ` as @${login}` : ' to GitHub'}`
                : 'Not connected';
        if (connectBtn) {
            connectBtn.textContent = connected ? 'Reconnect GitHub' : 'Connect GitHub';
            connectBtn.hidden = localDev;
        }
        if (disconnectBtn) disconnectBtn.hidden = localDev || !connected;
        const disable = $('disable-shorts-toggle');
        if (disable) disable.checked = rssSettings.disableShorts;
    }

    function closeSettings() { closeModal(settingsModal); }

    async function doConnect(isSetup) {
        const targetStatus = isSetup ? setupStatusEl : statusEl;
        const buttons = [connectBtn, setupConnectBtn].filter(Boolean);
        buttons.forEach(button => { button.disabled = true; });
        setStatus('Waiting for GitHub...', 'info', targetStatus);
        try {
            const { login } = await connectGitHub();
            setStatus(`Connected${login ? ` as @${login}` : ''}. Syncing...`, 'success', targetStatus);
            if (loadingEl) loadingEl.style.display = 'block';
            if (!await gistSync.pull()) throw new Error('Could not read sync Gist');
            syncReady = true;
            if (setupForm) setupForm.style.display = 'none';
            if (floatingBtns) floatingBtns.style.display = '';
            if (updateHeader) updateHeader.style.display = '';
            if (feedEl) feedEl.style.display = '';
            if (refreshFeedsBtn) refreshFeedsBtn.disabled = false;
            if (manageFeedsBtn) manageFeedsBtn.disabled = false;
            renderAll();
            if (!isSetup) openSettings();
        } catch (error) {
            setStatus(error.message || 'GitHub connection failed', 'error', targetStatus);
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    $('settings-link')?.addEventListener('click', openSettings);
    $('rss-settings-btn')?.addEventListener('click', openSettings);
    $('save-rss-settings-btn')?.addEventListener('click', async () => {
        const next = {
            disableShorts: $('disable-shorts-toggle')?.checked ?? true
        };
        try {
            // Refresh SHA first; feed refresh workflow may have updated feeds.txt.
            const file = await getFeedsFile();
            managedFeeds = parseFeedsFile(file.content);
            feedsSha = file.sha;
            const result = await updateFeedsFile(serializeFeedsFile(managedFeeds, next), feedsSha);
            feedsSha = result.content?.sha || feedsSha;
            rssSettings = next;
            closeSettings();
            updateShortsButton();
            toast('RSS settings saved. Refresh feeds to apply.', 'success', 2800);
        } catch (error) { setStatus(error.message || 'Could not save RSS settings.', 'error'); }
    });
    closeBtn?.addEventListener('click', closeSettings);
    connectBtn?.addEventListener('click', () => doConnect(false));
    setupConnectBtn?.addEventListener('click', () => doConnect(true));
    disconnectBtn?.addEventListener('click', () => {
        disconnectGitHub();
        window.location.reload();
    });
    settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

    function setFeedsDirty(dirty) {
        feedsDirty = dirty;
        if (feedsSummary) {
            const suffix = dirty ? ' · Unsaved changes' : '';
            feedsSummary.textContent = `${managedFeeds.length} subscription${managedFeeds.length === 1 ? '' : 's'}${suffix}`;
        }
    }

    async function persistManagedFeeds() {
        const invalid = managedFeeds.find(feed => !validFeedUrl(feed.url));
        if (invalid) {
            setStatus(`Invalid feed URL: ${invalid.url || 'empty URL'}`, 'error', feedsStatus);
            return false;
        }
        const normalized = managedFeeds.map(feed => feed.url.trim());
        if (new Set(normalized).size !== normalized.length) {
            setStatus('Remove duplicate feed URLs before saving.', 'error', feedsStatus);
            return false;
        }
        setStatus('Saving feeds...', 'info', feedsStatus);
        try {
            const result = await updateFeedsFile(serializeFeedsFile(managedFeeds, rssSettings), feedsSha);
            feedsSha = result.content?.sha || feedsSha;
            managedFeeds.forEach(feed => { delete feed.isNew; });
            setFeedsDirty(false);
            toast('Feeds saved', 'success', 2200);
            return true;
        } catch (error) {
            setStatus(error.message || 'Could not save feeds. Try again.', 'error', feedsStatus);
            return false;
        }
    }

    function renderManagedFeeds() {
        if (!feedList) return;
        feedList.innerHTML = '';
        const content = feedsModal?.querySelector('.feeds-content');
        const selectedFeed = selectedFeedIndex === null ? null : managedFeeds[selectedFeedIndex];
        content?.classList.toggle('editing-feed', !!selectedFeed || addingFeed);

        if (addingFeed) {
            const detail = document.createElement('div');
            detail.className = 'feed-detail feed-add-detail';

            const back = document.createElement('button');
            back.className = 'feed-detail-back';
            back.type = 'button';
            back.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg><span>All feeds</span>';
            back.addEventListener('click', () => {
                addingFeed = false;
                renderManagedFeeds();
            });

            const title = document.createElement('h3');
            title.textContent = 'Add feed';
            const rssLabel = document.createElement('label');
            rssLabel.textContent = 'RSS feed';
            const rss = document.createElement('input');
            rss.type = 'url';
            rss.inputMode = 'url';
            rss.autocomplete = 'url';
            rss.placeholder = 'https://example.com/feed.xml';
            const youtubeLabel = document.createElement('label');
            youtubeLabel.textContent = 'YouTube channel URL or name';
            const youtube = document.createElement('input');
            youtube.type = 'text';
            youtube.autocomplete = 'off';
            youtube.placeholder = 'https://www.youtube.com/@9to5Mac or 9to5Mac';
            const add = document.createElement('button');
            add.className = 'btn primary feed-detail-add';
            add.type = 'button';
            add.textContent = 'Add';
            add.addEventListener('click', async () => {
                const rssUrl = rss.value.trim();
                const channel = youtube.value.trim();
                if (!rssUrl && !channel) {
                    setStatus('Enter RSS feed or YouTube channel.', 'error', feedsStatus);
                    rss.focus();
                    return;
                }
                if (rssUrl && !validFeedUrl(rssUrl)) {
                    setStatus('Enter a valid RSS feed URL.', 'error', feedsStatus);
                    rss.focus();
                    return;
                }
                if (channel && validFeedUrl(channel) && !isYouTubeUrl(channel)) {
                    setStatus('Enter a YouTube channel URL or name.', 'error', feedsStatus);
                    youtube.focus();
                    return;
                }
                if (channel && !validFeedUrl(channel)) {
                    const handle = channel.replace(/^@/, '').replace(/\s+/g, '');
                    if (!handle) {
                        setStatus('Enter valid YouTube channel URL or name.', 'error', feedsStatus);
                        youtube.focus();
                        return;
                    }
                    youtube.value = `https://www.youtube.com/@${handle}`;
                }
                const entries = [];
                if (rssUrl) entries.push({ type: inferFeedType(rssUrl), url: rssUrl, name: '', isNew: true });
                if (channel) {
                    const channelUrl = youtube.value.trim();
                    entries.push({ type: 'youtube', url: channelUrl, name: '', isNew: true });
                }
                const duplicates = entries.some(entry => managedFeeds.some(feed => feed.url === entry.url));
                if (duplicates) {
                    setStatus('This feed is already in your list.', 'error', feedsStatus);
                    return;
                }
                managedFeeds.unshift(...entries.reverse());
                add.disabled = true;
                setFeedsDirty(true);
                if (await persistManagedFeeds()) {
                    addingFeed = false;
                    clearStatus(feedsStatus);
                    renderManagedFeeds();
                } else {
                    managedFeeds.splice(0, entries.length);
                    setFeedsDirty(false);
                    add.disabled = false;
                }
            });
            detail.append(back, title, rssLabel, rss, youtubeLabel, youtube, add);
            feedList.appendChild(detail);
            rss.focus();
            return;
        }

        if (selectedFeed) {
            const detail = document.createElement('div');
            detail.className = 'feed-detail';

            const back = document.createElement('button');
            back.className = 'feed-detail-back';
            back.type = 'button';
            back.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg><span>All feeds</span>';
            back.addEventListener('click', () => {
                selectedFeedIndex = null;
                renderManagedFeeds();
            });

            const title = document.createElement('h3');
            title.textContent = feedDisplayName(selectedFeed);

            const nameLabel = document.createElement('label');
            nameLabel.htmlFor = 'edit-feed-name';
            nameLabel.textContent = 'Name';
            const name = document.createElement('input');
            name.id = 'edit-feed-name';
            name.type = 'text';
            name.value = selectedFeed.name;
            name.placeholder = feedDisplayName(selectedFeed);
            name.addEventListener('input', () => {
                selectedFeed.name = name.value.trim();
                title.textContent = feedDisplayName(selectedFeed);
                setFeedsDirty(true);
            });

            const urlLabel = document.createElement('label');
            urlLabel.htmlFor = 'edit-feed-url';
            urlLabel.textContent = 'URL';
            const url = document.createElement('input');
            url.id = 'edit-feed-url';
            url.className = 'feed-url-input';
            url.type = 'url';
            url.value = selectedFeed.url;
            url.addEventListener('input', () => {
                selectedFeed.url = url.value.trim();
                selectedFeed.type = inferFeedType(selectedFeed.url);
                if (!selectedFeed.name) {
                    name.placeholder = feedDisplayName(selectedFeed);
                    title.textContent = feedDisplayName(selectedFeed);
                }
                setFeedsDirty(true);
            });

            const detailActions = document.createElement('div');
            detailActions.className = 'feed-detail-actions';
            const save = document.createElement('button');
            save.className = 'btn primary';
            save.type = 'button';
            save.textContent = 'Save';
            save.addEventListener('click', async () => {
                save.disabled = true;
                if (await persistManagedFeeds()) {
                    selectedFeedIndex = null;
                    renderManagedFeeds();
                } else {
                    save.disabled = false;
                }
            });
            const copy = document.createElement('button');
            copy.className = 'btn';
            copy.type = 'button';
            copy.textContent = 'Copy URL';
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(url.value);
                } catch {
                    url.select();
                    document.execCommand('copy');
                }
                toast('Feed URL copied', 'success', 1800);
            });
            const remove = document.createElement('button');
            remove.className = 'btn danger';
            remove.type = 'button';
            remove.textContent = 'Delete feed';
            remove.addEventListener('click', () => {
                managedFeeds.splice(selectedFeedIndex, 1);
                selectedFeedIndex = null;
                setFeedsDirty(true);
                renderManagedFeeds();
            });
            detailActions.append(save, copy, remove);
            detail.append(back, title, nameLabel, name, urlLabel, url, detailActions);
            feedList.appendChild(detail);
            return;
        }

        const query = feedSearch?.value.trim().toLowerCase() || '';
        const visible = managedFeeds
            .map((feed, index) => ({ feed, index }))
            .filter(({ feed }) => !query || `${feed.type} ${feedDisplayName(feed)} ${feed.url}`.toLowerCase().includes(query))
            .sort((a, b) => feedDisplayName(a.feed).localeCompare(feedDisplayName(b.feed), undefined, {
                sensitivity: 'base',
                numeric: true
            }));
        if (!visible.length) {
            const empty = document.createElement('p');
            empty.className = 'feed-empty';
            empty.textContent = query ? 'No feeds match your search.' : 'No feeds yet. Add one above.';
            feedList.appendChild(empty);
            return;
        }
        visible.forEach(({ feed, index }) => {
            const row = document.createElement('button');
            row.className = 'feed-row';
            row.type = 'button';
            row.setAttribute('aria-label', `Edit ${feedDisplayName(feed)}`);

            const name = document.createElement('span');
            name.className = 'feed-list-name';
            name.textContent = feedDisplayName(feed);
            const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            chevron.setAttribute('viewBox', '0 0 24 24');
            chevron.setAttribute('aria-hidden', 'true');
            chevron.innerHTML = '<path d="m9 18 6-6-6-6"/>';
            row.appendChild(name);
            if (feed.isNew) {
                const badge = document.createElement('span');
                badge.className = 'feed-new-badge';
                badge.textContent = 'New';
                row.appendChild(badge);
            }
            row.appendChild(chevron);
            row.addEventListener('click', () => {
                selectedFeedIndex = index;
                renderManagedFeeds();
                feedList.scrollTop = 0;
            });
            feedList.appendChild(row);
        });
    }

    async function openFeeds() {
        if (!feedsModal || manageFeedsBtn?.disabled) return;
        openModal(feedsModal);
        clearStatus(feedsStatus);
        if (feedList) feedList.innerHTML = '<p class="feed-empty">Loading feeds...</p>';
        if (feedsSummary) feedsSummary.textContent = 'Loading subscriptions...';
        try {
            const file = await getFeedsFile();
            managedFeeds = parseFeedsFile(file.content);
            selectedFeedIndex = null;
            addingFeed = false;
            feedsSha = file.sha;
            if (feedSearch) feedSearch.value = '';
            setFeedsDirty(false);
            renderManagedFeeds();
        } catch (error) {
            setStatus(error.message || 'Could not load feeds. Try again.', 'error', feedsStatus);
            if (feedList) feedList.innerHTML = '<p class="feed-empty">Feeds unavailable.</p>';
            if (feedsSummary) feedsSummary.textContent = 'Could not load subscriptions';
        }
    }

    function closeFeeds() {
        closeModal(feedsModal);
    }

    manageFeedsBtn?.addEventListener('click', openFeeds);
    closeFeedsBtn?.addEventListener('click', closeFeeds);
    feedsModal?.addEventListener('click', event => { if (event.target === feedsModal) closeFeeds(); });
    feedSearch?.addEventListener('input', renderManagedFeeds);
    addFeedForm?.addEventListener('submit', event => {
        event.preventDefault();
        addingFeed = true;
        selectedFeedIndex = null;
        clearStatus(feedsStatus);
        renderManagedFeeds();
    });

    if (repoLink) repoLink.href = `https://github.com/${getFeedRepository()}`;
    keyboardHelp?.addEventListener('click', e => { if (e.target === keyboardHelp) closeModal(keyboardHelp); });

    function getMeta(id) {
        const item = feedById.get(id);
        if (item) {
            return {
                title: item.title,
                url: item.link,
                published: item.published,
                thumbnail: item.thumbnail || '',
                video_id: item.video_id || '',
                feed_title: item.feed_title || '',
                description: item.description || ''
            };
        }
        const el = feedEl?.querySelector(`.item[data-id="${CSS.escape(id)}"] a`);
        return el ? { title: el.textContent.trim(), url: el.href } : null;
    }

    function itemHtml(item) {
        let media = '';
        if (item.video_id) {
            const thumb = `https://img.youtube.com/vi/${item.video_id}/sddefault.jpg`;
            media = `<div class="video" data-video="${item.video_id}"><img src="${thumb}" alt="" loading="lazy" decoding="async"><div class="play"></div></div>`;
        } else if (item.thumbnail) {
            media = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="" class="thumb" loading="lazy" decoding="async"></a>`;
        }
        const desc = item.description ? `<div class="desc">${makeLinksClickable(item.description)}</div>` : '';
        const expandBtn = item.description ? `<button class="expand-btn" title="Toggle description" aria-label="Toggle description"><svg viewBox="0 0 24 24" width="16" height="16"><polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
        const starred = getStarredItems(meta).includes(item.id);
        const star = `<button class="star${starred ? ' starred' : ''}" data-id="${item.id}" aria-pressed="${starred}">&#9829;</button>`;
        const actions = `<div class="item-actions">${star}</div>`;
        const source = item.feed_title || '';
        const time = relTime(item.published);
        const itemMeta = (source || time || expandBtn) ? `<div class="meta">${expandBtn}${source ? `<span class="source-dot" style="color:${feedColor(source)}">&#9679;</span><span class="source">${source}</span>` : ''}${source && time ? '<span class="meta-sep">&middot;</span>' : ''}${time ? `<span class="time">${time}</span>` : ''}</div>` : '';
        return `<div class="item${showingDesc ? ' show-desc' : ''}" data-id="${item.id}" tabindex="0">${media}<h2><a href="${item.link}" target="_blank">${item.title}</a></h2>${itemMeta}${desc}${actions}</div>`;
    }

    function syncThumbAspect(root = feedEl) {
        root?.querySelectorAll('img.thumb').forEach(img => {
            const apply = () => img.classList.toggle('portrait', img.naturalHeight > img.naturalWidth);
            if (img.complete && img.naturalWidth) {
                apply();
            } else {
                img.addEventListener('load', apply, { once: true });
            }
        });
    }

    function renderArchived(metaItems = []) {
        if (!feedEl) return;
        feedEl.querySelectorAll('.item[data-archived]').forEach(el => el.remove());
        const activeIds = new Set(feedData.map(i => i.id));
        const archived = (metaItems || []).filter(i => (i?.starred || displayedStarGroup.get(i?.id)) && !activeIds.has(i.id) && (i.url || i.link));
        archived.forEach(item => {
            if (!displayedStarGroup.has(item.id)) displayedStarGroup.set(item.id, true);
        });
        if (!archived.length) return;
        const frag = document.createDocumentFragment();
        archived.forEach(m => {
            const html = itemHtml({
                id: m.id,
                title: m.title || 'Untitled',
                link: m.url || m.link,
                published: m.published,
                feed_title: m.feed_title || '',
                thumbnail: m.thumbnail || '',
                video_id: m.video_id || ''
            });
            const wrap = document.createElement('div');
            wrap.innerHTML = html;
            const el = wrap.firstElementChild;
            if (el) { el.dataset.archived = 'true'; frag.appendChild(el); }
        });
        feedEl.appendChild(frag);
    }

    function displayedStarred(id, itemMeta) {
        return displayedStarGroup.has(id) ? displayedStarGroup.get(id) : !!itemMeta?.starred;
    }

    function isShort(item) { return item?.link && /youtube\.com\/shorts\//i.test(item.link); }

    function updateShortsButton() {
        if (!shortsBtn) return;
        const count = feedData.filter(item => isShort(item) && isUnreadVersion(item, (meta.items || []).find(m => m.id === item.id))).length;
        const available = !rssSettings.disableShorts;
        shortsBtn.hidden = !available;
        shortsBtn.classList.toggle('has-shorts', count > 0);
        shortsBtn.title = 'Open Shorts';
        shortsBtn.setAttribute('aria-label', 'Open Shorts');
    }

    function renderShort() {
        if (!shortsStage || !shortsItems[shortsIndex]) return;
        const item = shortsItems[shortsIndex];
        const id = item.video_id || item.link.match(/[?&]v=([^&]+)/)?.[1] || item.link.split('/').pop();
        shortsStage.innerHTML = `<iframe id="shorts-frame" src="https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&enablejsapi=1" title="${item.title.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe><div class="shorts-caption"><strong>${item.title}</strong><span>${item.feed_title || ''}</span></div><div class="shorts-controls"><button class="shorts-control" data-short-command="unMute" type="button">🔊 Unmute</button><button class="shorts-control" data-short-command="pauseVideo" type="button">⏸ Pause</button></div><div class="shorts-gesture-layer" aria-hidden="true"></div>`;
        shortsViewer.querySelector('.shorts-end').hidden = true;
    }

    function showNoShorts() {
        if (!shortsEmptyStatus) return;
        clearTimeout(shortsEmptyStatusTimer);
        shortsEmptyStatus.hidden = false;
        shortsEmptyStatusTimer = setTimeout(() => { shortsEmptyStatus.hidden = true; }, 5000);
    }

    function openShorts() {
        if (rssSettings.disableShorts) return;
        const unread = feedData.filter(item => isShort(item) && isUnreadVersion(item, (meta.items || []).find(m => m.id === item.id)));
        shortsItems = unread;
        if (!shortsItems.length) { showNoShorts(); return; }
        if (shortsViewerTitle) shortsViewerTitle.textContent = 'New Shorts';
        shortsIndex = 0;
        shortsViewer.hidden = false;
        document.body.classList.add('shorts-open');
        renderShort();
    }
    function nextShort() {
        if (shortsIndex < shortsItems.length - 1) { shortsIndex += 1; renderShort(); }
        else shortsViewer.querySelector('.shorts-end').hidden = false;
    }
    function closeShorts() { shortsViewer.hidden = true; document.body.classList.remove('shorts-open'); shortsStage.innerHTML = ''; }
    async function markShortsDone() {
        const now = new Date().toISOString();
        meta = gistSync.getLocal(); meta.items = meta.items || [];
        const byId = new Map(meta.items.map(item => [item.id, item]));
        shortsItems.forEach(item => {
            let record = byId.get(item.id);
            if (!record) { record = { id: item.id, date: now, starred: false }; meta.items.push(record); }
            record.seen = true; record.published = item.published; record.read_changed_at = now;
        });
        meta.updated_at = now; gistSync.setLocal(meta);
        markShortsDone.disabled = true;
        try { await upload(); closeShorts(); renderAll(); showFeedSyncMessage('Shorts marked done', 'success', 2000); }
        catch (error) { showFeedSyncMessage(error.message || 'Could not save Shorts', 'error', 4000); markShortsDone.disabled = false; }
    }
    shortsStage?.addEventListener('click', event => {
        const button = event.target.closest('[data-short-command]');
        if (!button) return;
        const frame = $('shorts-frame');
        if (!frame) return;
        const command = button.dataset.shortCommand;
        frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), 'https://www.youtube.com');
        if (command === 'unMute') button.hidden = true;
        if (command === 'pauseVideo') {
            button.dataset.shortCommand = 'playVideo';
            button.textContent = '▶ Play';
        } else if (command === 'playVideo') {
            button.dataset.shortCommand = 'pauseVideo';
            button.textContent = '⏸ Pause';
        }
    });
    shortsBtn?.addEventListener('click', openShorts);
    closeShortsBtn?.addEventListener('click', closeShorts);
    markShortsDoneBtn?.addEventListener('click', markShortsDone);
    let shortsTouchY = 0;
    function shortsTouchStart(e) { shortsTouchY = e.touches[0].clientY; }
    function shortsTouchEnd(e) {
        const delta = shortsTouchY - e.changedTouches[0].clientY;
        if (Math.abs(delta) < 45) return;
        if (delta > 0) nextShort();
        else if (shortsIndex > 0) { shortsIndex -= 1; renderShort(); }
    }
    shortsViewer?.addEventListener('touchstart', shortsTouchStart, { passive: true, capture: true });
    shortsViewer?.addEventListener('touchend', shortsTouchEnd, { passive: true, capture: true });
    shortsViewer?.addEventListener('wheel', e => { if (e.deltaY > 30) { e.preventDefault(); nextShort(); } }, { passive: false });

    function renderFeed() {
        if (!feedEl) return;
        const displayData = feedData.filter(item => !isShort(item));
        const starredIds = new Set(getStarredItems(meta));
        displayData.forEach(item => {
            if (!displayedStarGroup.has(item.id)) displayedStarGroup.set(item.id, starredIds.has(item.id));
        });
        const unstarred = displayData.filter(i => !displayedStarGroup.get(i.id));
        const starred = displayData.filter(i => displayedStarGroup.get(i.id));
        const unreadCount = displayData.filter(item => {
            const itemMeta = (meta.items || []).find(m => m.id === item.id);
            const displayedMeta = itemMeta
                ? { ...itemMeta, starred: displayedStarred(item.id, itemMeta) }
                : { starred: displayedStarred(item.id, itemMeta) };
            return isUnreadVersion(item, displayedMeta);
        }).length;
        const markReadAction = unreadCount ? `
            <div class="mark-read-action">
                <button id="mark-read-btn" class="btn mark-read-btn" type="button"${syncReady ? '' : ' disabled'}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Mark all ${unreadCount} unread items as read</span>
                </button>
            </div>` : '';
        const sep = starred.length && unstarred.length ? '<div class="sep"><span class="sep-heart">&#9829;</span></div>' : '';
        feedEl.innerHTML = unstarred.map(itemHtml).join('') + markReadAction + sep + starred.map(itemHtml).join('');
    }

    function visibleItems() {
        if (!feedEl) return [];
        return Array.from(feedEl.querySelectorAll('.item')).filter(i => i.style.display !== 'none');
    }

    function highlight(idx) {
        visibleItems().forEach((i, n) => i.classList.toggle('focused', n === idx));
    }
    function scrollToItem(idx) {
        const items = visibleItems();
        if (idx >= 0 && idx < items.length) items[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function applyView(metaItems) {
        if (!feedEl) return;
        if (viewBtn) {
            viewBtn.title = showingNew ? 'Show all items' : 'Show unread items';
            viewBtn.setAttribute('aria-label', viewBtn.title);
        }
        const all = Array.from(feedEl.querySelectorAll('.item'));
        if (!all.length) { if (emptyEl && showingNew) emptyEl.style.display = ''; return; }

        const focused = currentIdx >= 0 ? visibleItems()[currentIdx]?.dataset.id : null;
        const byId = new Map((metaItems || []).map(i => [i.id, i]));

        if (showingNew) {
            let count = 0;
            all.forEach(item => {
                const m = byId.get(item.dataset.id);
                const displayedMeta = m
                    ? { ...m, starred: displayedStarred(item.dataset.id, m) }
                    : { starred: displayedStarred(item.dataset.id, m) };
                const hide = !shouldShowInUnreadView(feedById.get(item.dataset.id), displayedMeta);
                if (hide && videoPlayers.has(item.dataset.id)) stopVideoByItemId(item.dataset.id);
                item.style.display = hide ? 'none' : '';
                if (!hide) count++;
            });
            const sep = feedEl.querySelector('.sep');
            if (sep) {
                const visibleStarred = all.filter(i => displayedStarred(i.dataset.id, byId.get(i.dataset.id)) && i.style.display !== 'none');
                sep.style.display = visibleStarred.length ? '' : 'none';
            }
            const unreadCount = feedData.filter(item => {
                const m = byId.get(item.id);
                const displayedMeta = m
                    ? { ...m, starred: displayedStarred(item.id, m) }
                    : { starred: displayedStarred(item.id, m) };
                return isUnreadVersion(item, displayedMeta);
            }).length;
            const markReadAction = feedEl.querySelector('.mark-read-action');
            if (markReadAction) markReadAction.style.display = unreadCount ? '' : 'none';
            if (emptyEl) emptyEl.style.display = count ? 'none' : '';
        } else {
            all.forEach(i => i.style.display = '');
            const markReadAction = feedEl.querySelector('.mark-read-action');
            if (markReadAction) markReadAction.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'none';
        }

        const svg = viewBtn?.querySelector('svg');
        if (svg) {
            svg.innerHTML = showingNew
                ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
                : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
        }

        if (focused) {
            const items = visibleItems();
            currentIdx = items.findIndex(i => i.dataset.id === focused);
            highlight(currentIdx >= 0 ? currentIdx : -1);
        } else {
            currentIdx = -1;
            highlight(-1);
        }
    }

    function renderAll() {
        meta = gistSync.getLocal();
        meta.items = meta.items || [];
        const captured = firstFeedRender && rememberFeedItems(meta, feedData);
        firstFeedRender = false;
        feedData = mergeFeedItems(feedData, meta.items.map(item => item.feed_item));
        feedById = new Map(feedData.map(item => [item.id, item]));
        if (rememberFeedItems(meta, feedData) || captured) {
            gistSync.setLocal(meta);
            gistSync.pushSoon();
        }
        setUpdatedAtText();
        renderFeed();
        renderArchived(meta.items);
        applyView(meta.items);
        syncThumbAspect();
        updateShortsButton();
    }

    window.addEventListener('blink-sync', event => {
        if (!syncReady || event.detail.type !== 'success') return;
        if (starSyncPending) {
            starSyncPending = false;
            meta = gistSync.getLocal();
            setUpdatedAtText();
            return;
        }
        renderAll();
    });

    viewBtn?.addEventListener('click', () => {
        showingNew = !showingNew;
        if (feedEl && feedEl.querySelector('.item')) {
            meta = gistSync.getLocal();
            meta.items = meta.items || [];
            setUpdatedAtText();
            applyView(meta.items);
            syncThumbAspect();
        } else {
            renderAll();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        if (!shortsViewer.hidden) {
            if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); nextShort(); }
            else if (e.key === 'Escape' || e.key === 'ArrowUp') { e.preventDefault(); if (e.key === 'Escape') closeShorts(); }
            return;
        }
        const items = visibleItems();
        if (!items.length) return;
        switch (e.key) {
            case 'j':
                e.preventDefault();
                currentIdx = Math.min(currentIdx + 1, items.length - 1);
                highlight(currentIdx);
                scrollToItem(currentIdx);
                break;
            case 'k':
                e.preventDefault();
                currentIdx = Math.max(currentIdx - 1, 0);
                highlight(currentIdx);
                scrollToItem(currentIdx);
                break;
            case 's':
                e.preventDefault();
                if (currentIdx >= 0) {
                    const star = items[currentIdx].querySelector('.star');
                    if (star) star.click();
                }
                break;
            case 'e':
                e.preventDefault();
                if (currentIdx >= 0) {
                    const expandBtn = items[currentIdx].querySelector('.expand-btn');
                    if (expandBtn) expandBtn.click();
                }
                break;
            case 'o':
            case 'Enter':
                e.preventDefault();
                if (currentIdx >= 0) {
                    const link = items[currentIdx].querySelector('a');
                    if (link) window.open(link.href, '_blank');
                }
                break;
            case '?':
                e.preventDefault();
                if (keyboardHelp) {
                    if (!keyboardHelp.classList.contains('open')) {
                        openModal(keyboardHelp);
                    } else {
                        closeModal(keyboardHelp);
                    }
                }
                break;
            case 'Escape':
                if (feedsModal && feedsModal.classList.contains('open')) {
                    closeFeeds();
                } else if (settingsModal && settingsModal.classList.contains('open')) {
                    closeSettings();
                } else if (keyboardHelp && keyboardHelp.classList.contains('open')) {
                    closeModal(keyboardHelp);
                }
                break;
        }
    });

    feedEl?.addEventListener('focusin', e => {
        const item = e.target.closest('.item');
        if (item) {
            const items = visibleItems();
            const idx = items.indexOf(item);
            if (idx >= 0) {
                currentIdx = idx;
                highlight(idx);
            }
        }
    });

    feedEl?.addEventListener('click', e => {
        const star = e.target.closest('.star');
        if (star) {
            const id = star.dataset.id;
            let items = meta.items || [];
            const now = new Date().toISOString();
            let item = items.find(i => i.id === id);
            const m = getMeta(id) || {};

            if (item) {
                item.starred = !item.starred;
                item.starred_changed_at = now;

                if (item.starred) {
                    if (!item.title && m.title) item.title = m.title;
                    if ((!item.url && m.url) || (!item.link && m.url)) { item.url = m.url; item.link = m.url; }
                    if (!item.published && m.published) item.published = m.published;
                    if (!item.thumbnail && m.thumbnail) item.thumbnail = m.thumbnail;
                    if (!item.video_id && m.video_id) item.video_id = m.video_id;
                    if (!item.feed_title && m.feed_title) item.feed_title = m.feed_title;
                    if (!item.description && m.description) item.description = m.description;
                }
                if (item.starred) {
                    star.classList.add('starred');
                    star.classList.remove('unstarred');
                } else {
                    star.classList.remove('starred');
                    star.classList.add('unstarred');
                    star.addEventListener('animationend', () => star.classList.remove('unstarred'), { once: true });
                }
                star.setAttribute('aria-pressed', item.starred);
            } else {
                items.push({
                    id, date: now, starred: true, starred_changed_at: now, seen: false,
                    title: m.title || '', url: m.url || '', link: m.url || '',
                    published: m.published || now, thumbnail: m.thumbnail || '',
                    video_id: m.video_id || '', feed_title: m.feed_title || '',
                    description: m.description || ''
                });
                star.classList.add('starred');
                star.setAttribute('aria-pressed', 'true');
            }
            meta.items = items;
            meta.updated_at = now;
            gistSync.setLocal(meta);
            starSyncPending = true;
            gistSync.pushSoon();
            return;
        }

        const expandBtn = e.target.closest('.expand-btn');
        if (expandBtn) {
            const itemEl = expandBtn.closest('.item');
            if (itemEl) {
                itemEl.classList.toggle('show-desc');
                showingDesc = itemEl.classList.contains('show-desc');
                localStorage.setItem('SHOW_DESC', showingDesc ? 'true' : 'false');
            }
            return;
        }

        const video = e.target.closest('.video');
        if (video && !video.classList.contains('loaded')) {
            const vid = video.dataset.video;
            const itemId = video.closest('.item')?.dataset.id;
            if (vid) {
                video.classList.add('loaded');
                const container = document.createElement('div');
                video.innerHTML = '';
                video.appendChild(container);
                createYouTubePlayer(container, vid, itemId);
            }
        }
    });

    async function markAllRead(button) {
        if (button.disabled || !syncReady) return;
        const currentMetaById = new Map((gistSync.getLocal().items || []).map(item => [item.id, item]));
        const mainItems = feedData.filter(item => !isShort(item));
        const unreadCount = mainItems.filter(item => isUnreadVersion(item, currentMetaById.get(item.id))).length;
        if (!unreadCount || !confirm(`Mark all ${unreadCount} unread items as read?`)) return;

        button.disabled = true;
        if (refreshFeedsBtn) refreshFeedsBtn.disabled = true;
        document.body.setAttribute('aria-busy', 'true');
        try {
            setFeedSyncStatus('Saving read state...');
            meta = gistSync.getLocal();
            meta.items = meta.items || [];
            const now = new Date().toISOString();
            const metaById = new Map(meta.items.map(item => [item.id, item]));
            mainItems.forEach(item => {
                const m = metaById.get(item.id);
                if (!isUnreadVersion(item, m)) return;
                if (!m) {
                    const newMeta = { id: item.id, date: now, starred: false, seen: true, read_changed_at: now, published: item.published };
                    meta.items.push(newMeta);
                    metaById.set(item.id, newMeta);
                } else {
                    m.seen = true;
                    m.published = item.published;
                    m.read_changed_at = now;
                }
            });
            meta.updated_at = now;
            gistSync.setLocal(meta);
            await upload();
            showFeedSyncMessage('Marked all read', 'success', 2000);
            displayedStarGroup.clear();
            renderAll();
        } catch (error) {
            const message = error.message || 'Could not mark items read. Try again.';
            showFeedSyncMessage(message, 'error', 5000);
            button.disabled = false;
        } finally {
            if (refreshFeedsBtn) refreshFeedsBtn.disabled = !syncReady;
            document.body.removeAttribute('aria-busy');
        }
    }

    feedEl?.addEventListener('click', event => {
        const button = event.target.closest('#mark-read-btn');
        if (button) markAllRead(button);
    });

    async function performFeedRefresh() {
        if (!syncReady) return false;
        refreshFeedsBtn.disabled = true;
        refreshFeedsBtn.classList.add('refreshing');
        const markReadButton = $('mark-read-btn');
        if (markReadButton) markReadButton.disabled = true;
        document.body.setAttribute('aria-busy', 'true');
        try {
            setFeedSyncStatus('Saving unread items...');
            rememberFeedItems(gistSync.getLocal(), feedData);
            await upload();
            await refreshFeeds(message => setFeedSyncStatus(message));
            // Save any read/star changes made while the feed fetch was running.
            setFeedSyncStatus('Saving state before reload...');
            await upload();
            window.location.reload();
            return true;
        } catch (error) {
            const message = error.message || 'Feed refresh failed. Try again.';
            showFeedSyncMessage(message, 'error', 5000);
            refreshFeedsBtn.disabled = false;
            refreshFeedsBtn.classList.remove('refreshing');
            if (markReadButton) markReadButton.disabled = false;
            document.body.removeAttribute('aria-busy');
            return false;
        }
    }

    refreshFeedsBtn?.addEventListener('click', () => {
        if (refreshFeedsBtn.disabled || !syncReady) return;
        performFeedRefresh();
    });

    async function initSync() {
        if (loadingEl) loadingEl.style.display = '';
        const success = await gistSync.syncOnStartup();
        if (!success) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (feedEl) feedEl.innerHTML = '<div style="text-align:center;padding:60px 24px;color:var(--muted)"><p style="font-size:1.1rem;margin-block-end:8px">Could not sync</p><p style="font-size:.9rem;margin-block-end:16px;opacity:.65">GitHub Gist is unreachable. Check your connection and credentials.</p><button class="btn" style="margin:0 auto;padding:10px 24px;font-size:.9rem;color:var(--accent)" id="retry-sync-btn">Retry</button></div>';
            const retryBtn = $('retry-sync-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => { if (feedEl) feedEl.innerHTML = ''; initSync(); });
            return;
        }
        syncReady = true;
        if (refreshFeedsBtn) refreshFeedsBtn.disabled = false;
        if (manageFeedsBtn) manageFeedsBtn.disabled = false;
        renderAll();
        if (loadingEl) loadingEl.style.display = 'none';
        if (feedEl) feedEl.style.display = '';
    }
    if (localDev || (hasGist && hasToken)) initSync();
});
