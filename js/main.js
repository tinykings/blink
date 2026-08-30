import { createYouTubePlayer, stopVideoByItemId, videoPlayers } from './youtube.js';
import { getStarredItems } from './storage.js';
import { gistSync, upload } from './sync.js';
import { connectGitHub, disconnectGitHub, getGitHubConfig, getGitHubLogin, refreshFeeds } from './github-auth.js';

let meta = { items: [] };

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
    const refreshFeedsBtn = $('refresh-feeds-btn');
    const feedSyncStatus = $('feed-sync-status');
    const feedSyncText = $('feed-sync-text');
    const emptyEl = $('empty');
    const repoLink = $('repo-link');
    const loadingEl = $('loading');
    const keyboardHelp = $('keyboard-help');
    const setupForm = $('setup-form');

    let feedData = [];
    let feedById = new Map();
    let showingNew = true;
    let showingDesc = false;
    let currentIdx = -1;
    let syncReady = false;

    function isSeenVersion(item, itemMeta) {
        if (!itemMeta?.seen) return false;
        if (!item?.published) return true;
        const seenVersion = itemMeta.published || itemMeta.starred_changed_at || itemMeta.starredChangedAt || itemMeta.date;
        if (!seenVersion) return true;
        const currentPublished = new Date(item.published).getTime();
        const seenPublished = new Date(seenVersion).getTime();
        if (!Number.isFinite(currentPublished) || !Number.isFinite(seenPublished)) return true;
        return currentPublished <= seenPublished;
    }

    if (refreshFeedsBtn) refreshFeedsBtn.disabled = true;

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
    const floatingBtns = $('floating-buttons');
    const updateHeader = document.querySelector('.update-header');
    if (!hasGist || !hasToken) {
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
        target.className = `status${type !== 'info' ? ` ${type}` : ''}`;
    }
    function clearStatus(target = statusEl) {
        if (!target) return;
        target.textContent = '';
        target.className = 'status';
    }

    function setFeedSyncStatus(message, type = 'progress') {
        if (!feedSyncStatus || !feedSyncText) return;
        feedSyncText.textContent = message;
        feedSyncStatus.className = `feed-sync-status ${type}`;
        feedSyncStatus.hidden = false;
    }

    function setUpdatedAtText() {
        const text = formatUpdatedAt(meta?.updated_at) || updateHeader?.textContent.trim() || '';
        if (text) {
            const starredCount = (meta.items || []).filter(i => i.starred).length;
            const display = starredCount > 0 ? `${text} · ★ ${starredCount}` : text;
            if (updateHeader) updateHeader.textContent = display;
            if (repoLink) repoLink.textContent = display;
            const label = `Blink on GitHub, last updated ${text}${starredCount > 0 ? `, ${starredCount} starred` : ''}`;
            if (repoLink) repoLink.setAttribute('aria-label', label);
            if (repoLink) repoLink.title = label;
        }
    }

    function openSettings() {
        openModal(settingsModal);
        clearStatus();
        const login = getGitHubLogin();
        const { token, gistId } = getGitHubConfig();
        const connected = token && gistId;
        const connectionEl = $('github-connection');
        if (connectionEl) connectionEl.textContent = connected
            ? `Connected${login ? ` as @${login}` : ' to GitHub'}`
            : 'Not connected';
        if (connectBtn) connectBtn.textContent = connected ? 'Reconnect GitHub' : 'Connect GitHub';
        if (disconnectBtn) disconnectBtn.hidden = !connected;
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
    closeBtn?.addEventListener('click', closeSettings);
    connectBtn?.addEventListener('click', () => doConnect(false));
    setupConnectBtn?.addEventListener('click', () => doConnect(true));
    disconnectBtn?.addEventListener('click', () => {
        disconnectGitHub();
        window.location.reload();
    });
    settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

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
        const actions = star ? `<div class="item-actions">${star}</div>` : '';
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
        const archived = (metaItems || []).filter(i => i?.starred && !activeIds.has(i.id) && (i.url || i.link));
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

    function renderFeed() {
        if (!feedEl) return;
        const starredIds = new Set(getStarredItems(meta));
        const unstarred = feedData.filter(i => !starredIds.has(i.id));
        const starred = feedData.filter(i => starredIds.has(i.id));
        const markReadAction = unstarred.length ? `
            <div class="mark-read-action">
                <button id="mark-read-btn" class="btn mark-read-btn" type="button"${syncReady ? '' : ' disabled'}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Mark all as read</span>
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
        const all = Array.from(feedEl.querySelectorAll('.item'));
        if (!all.length) { if (emptyEl && showingNew) emptyEl.style.display = ''; return; }

        const focused = currentIdx >= 0 ? visibleItems()[currentIdx]?.dataset.id : null;
        const byId = new Map((metaItems || []).map(i => [i.id, i]));

        if (showingNew) {
            let count = 0;
            all.forEach(item => {
                const m = byId.get(item.dataset.id);
                const hide = isSeenVersion(feedById.get(item.dataset.id), m) && !m?.starred;
                if (hide && videoPlayers.has(item.dataset.id)) stopVideoByItemId(item.dataset.id);
                item.style.display = hide ? 'none' : '';
                if (!hide) count++;
            });
            const sep = feedEl.querySelector('.sep');
            if (sep) {
                const visibleStarred = all.filter(i => byId.get(i.dataset.id)?.starred && i.style.display !== 'none');
                sep.style.display = visibleStarred.length ? '' : 'none';
            }
            const unreadCount = feedData.filter(item => !isSeenVersion(item, byId.get(item.id))).length;
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
        setUpdatedAtText();
        renderFeed();
        renderArchived(meta.items);
        applyView(meta.items);
        syncThumbAspect();
    }

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
                if (settingsModal && settingsModal.classList.contains('open')) {
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
                item.seen = true;
                if (m.published) item.published = m.published;
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
                    id, date: now, starred: true, starred_changed_at: now, seen: true,
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
            renderArchived(meta.items);
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
        const unreadCount = feedData.filter(item => !isSeenVersion(item, currentMetaById.get(item.id))).length;
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
            feedData.forEach(item => {
                const m = metaById.get(item.id);
                if (!m) {
                    const newMeta = { id: item.id, date: now, starred: false, seen: true, starred_changed_at: now, published: item.published };
                    meta.items.push(newMeta);
                    metaById.set(item.id, newMeta);
                } else if (!isSeenVersion(item, m)) {
                    m.seen = true;
                    m.published = item.published;
                    m.starred_changed_at = now;
                }
            });
            meta.updated_at = now;
            gistSync.setLocal(meta);
            await upload();
            toast('Marked all read', 'success', 2000);
            if (feedSyncStatus) feedSyncStatus.hidden = true;
            renderAll();
        } catch (error) {
            const message = error.message || 'Could not mark items read. Try again.';
            setFeedSyncStatus(message, 'error');
            toast(message, 'error', 5000);
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

    refreshFeedsBtn?.addEventListener('click', async () => {
        if (refreshFeedsBtn.disabled || !syncReady) return;
        refreshFeedsBtn.disabled = true;
        refreshFeedsBtn.classList.add('refreshing');
        const markReadButton = $('mark-read-btn');
        if (markReadButton) markReadButton.disabled = true;
        document.body.setAttribute('aria-busy', 'true');
        try {
            await refreshFeeds(message => setFeedSyncStatus(message));
            window.location.reload();
        } catch (error) {
            const message = error.message || 'Feed refresh failed. Try again.';
            setFeedSyncStatus(message, 'error');
            toast(message, 'error', 5000);
            refreshFeedsBtn.disabled = false;
            refreshFeedsBtn.classList.remove('refreshing');
            if (markReadButton) markReadButton.disabled = false;
            document.body.removeAttribute('aria-busy');
        }
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
        renderAll();
        if (loadingEl) loadingEl.style.display = 'none';
        if (feedEl) feedEl.style.display = '';
    }
    if (hasGist && hasToken) initSync();
});
