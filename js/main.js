import { createYouTubePlayer, stopVideoByItemId, videoPlayers } from './youtube.js';
import { getStarredItems, getItemMeta } from './storage.js';
import { gistSync, upload } from './sync.js';

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

document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = $('settings-modal');
    const gistInput = $('gist-id');
    const tokenInput = $('github-token');
    const statusEl = $('status');
    const saveBtn = $('save-btn');
    const closeBtn = $('close-btn');
    const feedEl = $('feed');
    const viewBtn = $('view-btn');
    const markReadBtn = $('mark-read-btn');
    const emptyEl = $('empty');
    const scrollTopBtn = $('scroll-top');
    const scrollTopRightBtn = $('scroll-top-right');
    const loadingEl = $('loading');
    const keyboardHelp = $('keyboard-help');
    const setupForm = $('setup-form');

    let feedData = [];
    let feedById = new Map();
    let showingNew = true;
    let showingDesc = false;
    let currentIdx = -1;
    let pendingChanges = false;

    const dataEl = $('feed-data');
    if (dataEl) {
        try {
            feedData = JSON.parse(dataEl.textContent);
            feedById = new Map(feedData.map(i => [i.id, i]));
        } catch (e) {
            console.error('Feed parse error:', e);
        }
    }

    const hasGist = localStorage.getItem('GIST_ID');
    const hasToken = localStorage.getItem('GITHUB_TOKEN');
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

    function setStatus(msg, type = 'info') {
        statusEl.textContent = msg;
        statusEl.className = `status${type !== 'info' ? ` ${type}` : ''}`;
    }
    function clearStatus() { statusEl.textContent = ''; statusEl.className = 'status'; }

    function saveButton() { saveBtn.disabled = !pendingChanges; }

    function openSettings() {
        settingsModal.style.display = 'flex';
        if (gistInput) gistInput.value = localStorage.getItem('GIST_ID') || '';
        if (tokenInput) tokenInput.value = localStorage.getItem('GITHUB_TOKEN') || '';
        clearStatus();
        pendingChanges = false;
        saveButton();
    }

    function closeSettings() { settingsModal.style.display = 'none'; }

    async function doSave() {
        const gistId = gistInput?.value.trim() || '';
        const token = tokenInput?.value.trim() || '';
        localStorage.setItem('GIST_ID', gistId);
        localStorage.setItem('GITHUB_TOKEN', token);
        if (gistId && token) {
            if (setupForm) setupForm.style.display = 'none';
            if (loadingEl) loadingEl.style.display = 'block';
            setStatus('Syncing from Gist...', 'info');
            if (await gistSync.pull()) {
                renderAll();
            }
            if (loadingEl) loadingEl.style.display = 'none';
        }
        pendingChanges = false;
        saveButton();
    }

    closeBtn?.addEventListener('click', closeSettings);
    saveBtn?.addEventListener('click', doSave);
    settingsModal?.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
    [gistInput, tokenInput].forEach(inp => {
        inp?.addEventListener('input', () => {
            pendingChanges = true;
            saveButton();
        });
    });

    keyboardHelp?.addEventListener('click', e => { if (e.target === keyboardHelp) keyboardHelp.style.display = 'none'; });

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
            media = `<div class="video" data-video="${item.video_id}"><img src="${thumb}" alt=""><div class="play"></div></div>`;
        } else if (item.thumbnail) {
            media = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="" class="thumb"></a>`;
        }
        const desc = item.description ? `<div class="desc">${makeLinksClickable(item.description)}</div>` : '';
        const expandBtn = item.description ? `<button class="expand-btn" title="Toggle description" aria-label="Toggle description">_</button>` : '';
        const starred = getStarredItems(meta).includes(item.id);
        const star = `<span class="star${starred ? ' starred' : ''}" data-id="${item.id}">&#9829;</span>`;
        const actions = star ? `<div class="item-actions">${star}</div>` : '';
        const source = item.feed_title || '';
        const time = relTime(item.published);
        const itemMeta = (source || time || expandBtn) ? `<div class="meta">${expandBtn}${source ? `<span class="source">${source}</span>` : ''}${source && time ? '<span class="meta-sep">&middot;</span>' : ''}${time ? `<span class="time">${time}</span>` : ''}</div>` : '';
        return `<div class="item${showingDesc ? ' show-desc' : ''}" data-id="${item.id}">${media}<h2><a href="${item.link}" target="_blank">${item.title}</a></h2>${itemMeta}${desc}${actions}</div>`;
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
        const sep = starred.length && unstarred.length ? '<div class="sep"><span class="sep-heart">&#9829;</span></div>' : '';
        feedEl.innerHTML = unstarred.map(itemHtml).join('') + sep + starred.map(itemHtml).join('');
    }

    function visibleItems() {
        if (!feedEl) return [];
        return Array.from(feedEl.querySelectorAll('.item')).filter(i => i.style.display !== 'none');
    }

    function highlight(idx) {
        visibleItems().forEach((i, n) => i.classList.toggle('focused', n === idx));
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
                const hide = m?.seen && !m?.starred;
                if (hide && videoPlayers.has(item.dataset.id)) stopVideoByItemId(item.dataset.id);
                item.style.display = hide ? 'none' : '';
                if (!hide) count++;
            });
            const sep = feedEl.querySelector('.sep');
            if (sep) {
                const visibleStarred = all.filter(i => byId.get(i.dataset.id)?.starred && i.style.display !== 'none');
                sep.style.display = visibleStarred.length ? '' : 'none';
            }
            if (emptyEl) emptyEl.style.display = count ? 'none' : '';
        } else {
            all.forEach(i => i.style.display = '');
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
        renderFeed();
        renderArchived(meta.items);
        applyView(meta.items);
        syncThumbAspect();
    }

    viewBtn?.addEventListener('click', () => {
        showingNew = !showingNew;
        renderAll();
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
                break;
            case 'k':
                e.preventDefault();
                currentIdx = Math.max(currentIdx - 1, 0);
                highlight(currentIdx);
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
                if (keyboardHelp) keyboardHelp.style.display = keyboardHelp.style.display === 'none' ? 'flex' : 'none';
                break;
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
                if (item.starred) {
                    if (!item.title && m.title) item.title = m.title;
                    if ((!item.url && m.url) || (!item.link && m.url)) { item.url = m.url; item.link = m.url; }
                    if (!item.published && m.published) item.published = m.published;
                    if (!item.thumbnail && m.thumbnail) item.thumbnail = m.thumbnail;
                    if (!item.video_id && m.video_id) item.video_id = m.video_id;
                    if (!item.feed_title && m.feed_title) item.feed_title = m.feed_title;
                    if (!item.description && m.description) item.description = m.description;
                }
                star.classList.toggle('starred', item.starred);
            } else {
                items.push({
                    id, date: now, starred: true, starred_changed_at: now, seen: true,
                    title: m.title || '', url: m.url || '', link: m.url || '',
                    published: m.published || now, thumbnail: m.thumbnail || '',
                    video_id: m.video_id || '', feed_title: m.feed_title || '',
                    description: m.description || ''
                });
                star.classList.add('starred');
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

    markReadBtn?.addEventListener('click', async () => {
        if (markReadBtn.disabled) return;
        meta = gistSync.getLocal();
        meta.items = meta.items || [];
        const now = new Date().toISOString();
        let changed = false;
        feedData.forEach(item => {
            let m = meta.items.find(i => i.id === item.id);
            if (!m) { meta.items.push({ id: item.id, date: now, starred: false, seen: true, starred_changed_at: now }); changed = true; }
            else if (!m.seen) { m.seen = true; m.starred_changed_at = now; changed = true; }
        });
        if (changed) {
            markReadBtn.disabled = true;
            toast('Syncing...', 'info', 1000);
            meta.updated_at = now;
            gistSync.setLocal(meta);
            try { await upload(); } catch { toast('Sync failed', 'error', 2000); }
            setTimeout(() => window.location.reload(), 500);
        } else {
            window.location.reload();
        }
    });

    let scrollTick = false;
    let lastScrollY = 0;
    let revealedAt = 0;
    window.addEventListener('scroll', () => {
        if (!scrollTick) {
            requestAnimationFrame(() => {
                const showBtn = window.scrollY > 600;
                scrollTopBtn?.classList.toggle('show', showBtn);
                scrollTopRightBtn?.classList.toggle('show', showBtn);
                if (window.scrollY < lastScrollY) {
                    floatingBtns?.classList.remove('hidden');
                    revealedAt = Date.now();
                } else if (window.scrollY > lastScrollY && window.scrollY > 100) {
                    if (Date.now() - revealedAt > 3000) {
                        floatingBtns?.classList.add('hidden');
                    }
                }
                lastScrollY = window.scrollY;
                scrollTick = false;
            });
            scrollTick = true;
        }
    }, { passive: true });

    scrollTopBtn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    scrollTopRightBtn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    (async () => {
        if (loadingEl) loadingEl.style.display = '';
        const success = await gistSync.syncOnStartup();
        if (!success) {
            if (statusEl) {
                statusEl.textContent = 'Gist unreachable - check connection';
                statusEl.className = 'status error';
            }
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }
        renderAll();
        if (loadingEl) loadingEl.style.display = 'none';
        if (feedEl) feedEl.style.display = '';
    })();
});
