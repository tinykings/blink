import { createYouTubePlayer, stopVideoByItemId, videoPlayers } from './youtube.js';
import { getStarredItems } from './storage.js';
import { markFeedItemsRead, mergeFeedItems, rememberFeedItems, shouldShowInFeed } from './feed-state.js';
import { gistSync, upload } from './sync.js';
import {
    connectGitHub,
    getFeedRepository,
    getGitHubConfig,
    isLocalDevelopment,
    refreshFeeds
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
    const setupStatusEl = $('setup-status');
    const setupConnectBtn = $('setup-connect-github-btn');
    const feedEl = $('feed');
    const markReadBtn = $('mark-read-btn');
    const feedSyncStatus = $('feed-sync-status');
    const feedSyncText = $('feed-sync-text');
    const emptyEl = $('empty');
    const repoLink = $('repo-link');
    const loadingEl = $('loading');
    const keyboardHelp = $('keyboard-help');
    const setupForm = $('setup-form');

    let feedData = [];
    let feedById = new Map();
    let metaById = new Map();
    let starredIds = new Set();
    let showingDesc = false;
    let currentIdx = -1;
    let focusedItem = null;
    let renderedItems = [];
    let renderedDataById = new Map();
    let feedRenderQueue = [];
    let feedRenderCursor = 0;
    let feedRenderObserver = null;
    let syncReady = false;
    let starSyncPending = false;
    const displayedStarGroup = new Map();
    const pageSettings = document.body?.dataset || {};
    rssSettings = {
        disableShorts: pageSettings.disableShorts !== 'false'
    };
    let feedSyncStatusTimer;
    const FEED_BATCH_SIZE = 40;

    if (markReadBtn) markReadBtn.disabled = true;

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

    function setStatus(msg, type = 'info', target = setupStatusEl) {
        if (!target) return;
        target.textContent = msg;
        target.className = `status ${type}`;
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

    async function doConnect() {
        const targetStatus = setupStatusEl;
        const buttons = [setupConnectBtn].filter(Boolean);
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
            if (markReadBtn) markReadBtn.disabled = false;
            renderAll();
        } catch (error) {
            setStatus(error.message || 'GitHub connection failed', 'error', targetStatus);
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    setupConnectBtn?.addEventListener('click', doConnect);

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

    function itemHtml(item, archived = false) {
        let media = '';
        if (item.video_id) {
            const thumb = `https://img.youtube.com/vi/${item.video_id}/sddefault.jpg`;
            media = `<div class="video" data-video="${item.video_id}"><img src="${thumb}" alt="" loading="lazy" decoding="async"><div class="play"></div></div>`;
        } else if (item.thumbnail) {
            media = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="" class="thumb" loading="lazy" decoding="async"></a>`;
        }
        const desc = item.description ? '<div class="desc" data-description-pending></div>' : '';
        const expandBtn = item.description ? `<button class="expand-btn" title="Toggle description" aria-label="Toggle description"><svg viewBox="0 0 24 24" width="16" height="16"><polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
        const starred = starredIds.has(item.id);
        const star = `<button class="star${starred ? ' starred' : ''}" data-id="${item.id}" aria-pressed="${starred}">&#9829;</button>`;
        const actions = `<div class="item-actions">${star}</div>`;
        const source = item.feed_title || '';
        const time = relTime(item.published);
        const itemMeta = (source || time || expandBtn) ? `<div class="meta">${expandBtn}${source ? `<span class="source-dot" style="color:${feedColor(source)}">&#9679;</span><span class="source">${source}</span>` : ''}${source && time ? '<span class="meta-sep">&middot;</span>' : ''}${time ? `<span class="time">${time}</span>` : ''}</div>` : '';
        return `<div class="item${showingDesc ? ' show-desc' : ''}" data-id="${item.id}"${archived ? ' data-archived="true"' : ''} tabindex="0">${media}<h2><a href="${item.link}" target="_blank">${item.title}</a></h2>${itemMeta}${desc}${actions}</div>`;
    }

    function materializeDescription(itemEl) {
        const desc = itemEl?.querySelector('.desc[data-description-pending]');
        if (!desc) return;
        const item = renderedDataById.get(itemEl.dataset.id);
        desc.innerHTML = makeLinksClickable(item?.description || '');
        delete desc.dataset.descriptionPending;
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

    function archivedItems(metaItems = []) {
        const activeIds = new Set(feedData.map(i => i.id));
        const archived = (metaItems || []).filter(i => (i?.starred || displayedStarGroup.get(i?.id)) && !activeIds.has(i.id) && (i.url || i.link));
        archived.forEach(item => {
            if (!displayedStarGroup.has(item.id)) displayedStarGroup.set(item.id, true);
        });
        return archived.map(m => ({
            archived: true,
            item: {
                id: m.id,
                title: m.title || 'Untitled',
                link: m.url || m.link,
                published: m.published,
                feed_title: m.feed_title || '',
                thumbnail: m.thumbnail || '',
                video_id: m.video_id || '',
                description: m.feed_item?.description || m.description || ''
            }
        }));
    }

    function isShort(item) { return item?.link && /youtube\.com\/shorts\//i.test(item.link); }

    function appendFeedBatch(batchSize = FEED_BATCH_SIZE) {
        const sentinel = $('feed-render-sentinel');
        if (!sentinel || feedRenderCursor >= feedRenderQueue.length) return;
        const template = document.createElement('template');
        const batchData = [];
        const html = [];
        let itemCount = 0;

        while (feedRenderCursor < feedRenderQueue.length) {
            const entry = feedRenderQueue[feedRenderCursor];
            if (entry.item && itemCount >= batchSize) break;
            feedRenderCursor += 1;
            if (entry.item) {
                html.push(itemHtml(entry.item, entry.archived));
                batchData.push(entry.item);
                itemCount += 1;
            } else {
                html.push(entry.html);
            }
        }

        template.innerHTML = html.join('');
        const newItems = Array.from(template.content.querySelectorAll('.item'));
        batchData.forEach(item => renderedDataById.set(item.id, item));
        sentinel.before(template.content);
        renderedItems.push(...newItems);
        newItems.forEach(itemEl => {
            if (showingDesc) materializeDescription(itemEl);
            syncThumbAspect(itemEl);
        });

        if (feedRenderCursor >= feedRenderQueue.length) {
            feedRenderObserver?.disconnect();
            feedRenderObserver = null;
            sentinel.remove();
        }
    }

    function hasPendingFeedItems() {
        return feedRenderCursor < feedRenderQueue.length;
    }

    function renderFeed() {
        if (!feedEl) return;
        feedRenderObserver?.disconnect();
        feedRenderObserver = null;
        renderedItems = [];
        renderedDataById = new Map();
        focusedItem = null;
        const mainItems = feedData.filter(item => !rssSettings.disableShorts || !isShort(item));
        mainItems.forEach(item => {
            if (!displayedStarGroup.has(item.id)) displayedStarGroup.set(item.id, starredIds.has(item.id));
        });
        const displayData = mainItems.filter(item => shouldShowInFeed(item, metaById.get(item.id)));
        const unstarred = displayData.filter(i => !displayedStarGroup.get(i.id));
        const starred = displayData.filter(i => displayedStarGroup.get(i.id));
        const archived = archivedItems(meta.items || []);
        const sep = (starred.length || archived.length) && unstarred.length ? '<div class="sep"><span class="sep-heart">&#9829;</span></div>' : '';
        feedRenderQueue = [
            ...unstarred.map(item => ({ item, archived: false })),
            ...(sep ? [{ html: sep }] : []),
            ...starred.map(item => ({ item, archived: false })),
            ...archived
        ];
        feedRenderCursor = 0;
        feedEl.innerHTML = '<div id="feed-render-sentinel" aria-hidden="true"></div>';
        appendFeedBatch();
        const sentinel = $('feed-render-sentinel');
        if (sentinel && 'IntersectionObserver' in window) {
            feedRenderObserver = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) appendFeedBatch();
            }, { rootMargin: '800px 0px' });
            feedRenderObserver.observe(sentinel);
        } else if (sentinel) {
            appendFeedBatch(Number.POSITIVE_INFINITY);
        }
    }

    function visibleItems() {
        return renderedItems;
    }

    function highlight(idx) {
        focusedItem?.classList.remove('focused');
        focusedItem = renderedItems[idx] || null;
        focusedItem?.classList.add('focused');
    }
    function scrollToItem(idx) {
        if (idx >= 0 && idx < renderedItems.length) renderedItems[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function renderAll() {
        meta = gistSync.getLocal();
        meta.items = meta.items || [];
        // Put the freshly fetched page last so updated content wins ties without
        // needing a separate pre-merge capture pass.
        feedData = mergeFeedItems(meta.items.map(item => item.feed_item), feedData);
        feedById = new Map(feedData.map(item => [item.id, item]));
        if (rememberFeedItems(meta, feedData)) {
            gistSync.setLocal(meta);
            gistSync.pushSoon();
        }
        metaById = new Map(meta.items.map(item => [item.id, item]));
        starredIds = new Set(getStarredItems(meta));
        setUpdatedAtText();
        renderFeed();
        if (emptyEl) emptyEl.style.display = visibleItems().length ? 'none' : '';
        currentIdx = -1;
    }

    window.addEventListener('blink-sync', event => {
        if (!syncReady || event.detail.type !== 'success') return;
        if (starSyncPending) {
            starSyncPending = false;
            meta = gistSync.getLocal();
            metaById = new Map((meta.items || []).map(item => [item.id, item]));
            starredIds = new Set(getStarredItems(meta));
            setUpdatedAtText();
            return;
        }
        renderAll();
    });

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        let items = visibleItems();
        if (!items.length) return;
        switch (e.key) {
            case 'j':
                e.preventDefault();
                if (currentIdx + 1 >= items.length && hasPendingFeedItems()) {
                    appendFeedBatch();
                    items = visibleItems();
                }
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
                if (keyboardHelp && keyboardHelp.classList.contains('open')) {
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
                item = {
                    id, date: now, starred: true, starred_changed_at: now, seen: false,
                    title: m.title || '', url: m.url || '', link: m.url || '',
                    published: m.published || now, thumbnail: m.thumbnail || '',
                    video_id: m.video_id || '', feed_title: m.feed_title || '',
                    description: m.description || ''
                };
                items.push(item);
                star.classList.add('starred');
                star.setAttribute('aria-pressed', 'true');
            }
            meta.items = items;
            meta.updated_at = now;
            gistSync.setLocal(meta);
            if (item) metaById.set(id, item);
            if (item?.starred) starredIds.add(id);
            else starredIds.delete(id);
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
                if (showingDesc) materializeDescription(itemEl);
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

    async function performMarkAsRead() {
        if (!syncReady) return false;
        markReadBtn.disabled = true;
        document.body.setAttribute('aria-busy', 'true');
        try {
            setFeedSyncStatus('Marking current items read...');
            const currentMeta = gistSync.getLocal();
            const changed = markFeedItemsRead(currentMeta, feedData);
            gistSync.setLocal(currentMeta);
            if (changed) {
                await upload();
            } else {
                await refreshFeeds(message => setFeedSyncStatus(message));
            }
            window.location.reload();
            return true;
        } catch (error) {
            const message = error.message || 'Could not mark items read. Try again.';
            showFeedSyncMessage(message, 'error', 5000);
            return false;
        } finally {
            markReadBtn.disabled = false;
            document.body.removeAttribute('aria-busy');
        }
    }

    markReadBtn?.addEventListener('click', () => {
        if (markReadBtn.disabled || !syncReady) return;
        performMarkAsRead();
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
        if (markReadBtn) markReadBtn.disabled = false;
        renderAll();
        if (loadingEl) loadingEl.style.display = 'none';
        if (feedEl) feedEl.style.display = '';
    }
    if (localDev || (hasGist && hasToken)) initSync();
});
