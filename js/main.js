// Main application entry point

import { createYouTubePlayer } from './youtube.js';
import { getRetentionDays, getStarredItems, escapeItemId } from './storage.js';
import { gistSync, upload } from './sync.js';

function relativeTime(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (!Number.isFinite(then)) return '';
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

document.addEventListener('DOMContentLoaded', () => {
    // Settings Modal
    const settingsIcon = document.getElementById('settings-icon');
    const settingsModal = document.getElementById('settings-modal');
    const gistIdInput = document.getElementById('gist-id');
    const githubTokenInput = document.getElementById('github-token');
    const feedsStatus = document.getElementById('feeds-status');
    const feedsSaveBtn = document.getElementById('feeds-save');
    const feedsCancelBtn = document.getElementById('feeds-cancel');
    const syncPanel = document.getElementById('sync-panel');

    let pendingSyncChanges = false;

    function showFeedsStatus(message, type = 'info') {
        feedsStatus.textContent = message;
        feedsStatus.className = 'feeds-status ' + type;
    }

    function clearFeedsStatus() {
        feedsStatus.textContent = '';
        feedsStatus.className = 'feeds-status';
    }

    function updateSaveButton() {
        feedsSaveBtn.disabled = !pendingSyncChanges;
    }

    async function openSettingsModal() {
        settingsModal.style.display = 'flex';
        if (gistIdInput) gistIdInput.value = localStorage.getItem('GIST_ID') || '';
        if (githubTokenInput) githubTokenInput.value = localStorage.getItem('GITHUB_TOKEN') || '';
        clearFeedsStatus();
        pendingSyncChanges = false;
        updateSaveButton();
        if (syncPanel) syncPanel.style.display = '';
    }

    function closeSettingsModal() {
        settingsModal.style.display = 'none';
    }

    async function saveChanges() {
        if (!pendingSyncChanges) return;

        feedsSaveBtn.disabled = true;

        const gistId = gistIdInput ? gistIdInput.value.trim() : '';
        const githubToken = githubTokenInput ? githubTokenInput.value.trim() : '';
        localStorage.setItem('GIST_ID', gistId);
        localStorage.setItem('GITHUB_TOKEN', githubToken);

        if (gistId && githubToken) {
            showFeedsStatus('Syncing from Gist...', 'info');
            localStorage.removeItem('blinkMeta');
            const success = await gistSync.pull();
            if (success) {
                const meta = gistSync.getLocal();
                renderFeed();
                renderArchivedItems(meta.items || []);
                applyView(meta.items || []);
            }
        }

        pendingSyncChanges = false;
        showFeedsStatus('Settings saved!', 'success');
        updateSaveButton();
    }

    // Settings event listeners
    if (settingsIcon) {
        settingsIcon.addEventListener('click', openSettingsModal);
    }
    if (feedsCancelBtn) {
        feedsCancelBtn.addEventListener('click', closeSettingsModal);
    }
    if (settingsModal) {
        settingsModal.addEventListener('click', e => {
            if (e.target === settingsModal) closeSettingsModal();
        });
    }
    if (feedsSaveBtn) {
        feedsSaveBtn.addEventListener('click', saveChanges);
    }

    const keyboardHelp = document.getElementById('keyboard-help');
    if (keyboardHelp) {
        keyboardHelp.addEventListener('click', e => {
            if (e.target === keyboardHelp) keyboardHelp.style.display = 'none';
        });
    }

    [gistIdInput, githubTokenInput].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                pendingSyncChanges = true;
                updateSaveButton();
            });
        }
    });

    // Main feed elements
    const feedContainer = document.getElementById('feed-container');
    const refreshIcon = document.getElementById('refresh-icon');
    const viewToggleButton = document.getElementById('view-toggle-button');
    const emptyState = document.getElementById('empty-state');
    let feedData = [];
    let feedDataById = new Map();
    let showingNew = true;

    // Keyboard navigation state
    let currentItemIndex = -1;

    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
            feedDataById = new Map(feedData.map(item => [item.id, item]));
        } catch (e) {
            console.error("Error parsing feed data:", e);
        }
    }

    function generateItemHtml(item) {
        let mediaHtml = '';
        if (item.video_id) {
            const thumbnailUrl = `https://img.youtube.com/vi/${item.video_id}/sddefault.jpg`;
            mediaHtml = `<div class="video-placeholder" data-video-id="${item.video_id}"><img src="${thumbnailUrl}" alt="Video Thumbnail" class="video-thumbnail" loading="lazy"><div class="play-button"></div></div>`;
        } else if (item.thumbnail) {
            mediaHtml = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="${item.title}" class="feed-thumbnail" loading="lazy"></a>`;
        }

        const starredItems = getStarredItems();
        const isStarred = starredItems.includes(item.id);
        const starHtml = `<span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>`;

        let metaHtml = '';
        const source = item.feed_title || '';
        const time = relativeTime(item.published);
        if (source || time) {
            const parts = [];
            if (source) parts.push(`<span class="feed-source">${source}</span>`);
            if (source && time) parts.push('<span class="meta-sep">&middot;</span>');
            if (time) parts.push(`<span class="feed-time">${time}</span>`);
            metaHtml = `<div class="feed-item-meta">${parts.join('')}</div>`;
        }

        return `<div class="feed-item" data-item-id="${item.id}">${starHtml}${mediaHtml}<div class="feed-item-info"><h2><a href="${item.link}" target="_blank">${item.title}</a></h2>${metaHtml}</div></div>`;
    }

    function getDomMetadataForItem(itemId) {
        if (!feedContainer) return null;
        const selectorId = escapeItemId(itemId);
        const element = feedContainer.querySelector(`.feed-item[data-item-id="${selectorId}"]`);
        if (!element) return null;
        const linkEl = element.querySelector('.feed-item-info a');
        if (!linkEl) return null;
        return {
            title: linkEl.textContent.trim(),
            url: linkEl.href
        };
    }

    function resolveItemMetadata(itemId) {
        const feedItem = feedDataById.get(itemId);
        if (feedItem) {
            return {
                title: feedItem.title,
                url: feedItem.link,
                published: feedItem.published,
                thumbnail: feedItem.thumbnail || '',
                video_id: feedItem.video_id || '',
                feed_title: feedItem.feed_title || ''
            };
        }
        return getDomMetadataForItem(itemId);
    }

    function ensureMetadataForItems(meta) {
        if (!meta || !Array.isArray(meta.items)) return false;
        let changed = false;
        meta.items.forEach(item => {
            if (!item || !item.starred) return;
            const metadata = resolveItemMetadata(item.id);
            if (metadata) {
                let itemChanged = false;
                if (!item.title && metadata.title) { item.title = metadata.title; itemChanged = true; }
                if (!item.url && metadata.url) { item.url = metadata.url; itemChanged = true; }
                if (!item.link && metadata.url) { item.link = metadata.url; itemChanged = true; }
                if (!item.published && metadata.published) { item.published = metadata.published; itemChanged = true; }
                if (!item.thumbnail && metadata.thumbnail) { item.thumbnail = metadata.thumbnail; itemChanged = true; }
                if (!item.video_id && metadata.video_id) { item.video_id = metadata.video_id; itemChanged = true; }
                if (!item.feed_title && metadata.feed_title) { item.feed_title = metadata.feed_title; itemChanged = true; }
                if (itemChanged) changed = true;
            }
        });
        return changed;
    }

    function renderArchivedItems(metaItems = []) {
        if (!feedContainer) return;
        // Remove any previously rendered archived items
        feedContainer.querySelectorAll('.feed-item[data-archived]').forEach(el => el.remove());

        const activeFeedIds = new Set(feedData.map(item => item.id));
        const archivedStarred = (metaItems || [])
            .filter(item => item && item.starred && !activeFeedIds.has(item.id))
            .filter(item => item.url || item.link);

        if (archivedStarred.length === 0) return;

        const fragment = document.createDocumentFragment();
        archivedStarred.forEach(metaItem => {
            // Normalize to feed item shape for generateItemHtml
            const feedLike = {
                id: metaItem.id,
                title: metaItem.title || 'Untitled',
                link: metaItem.url || metaItem.link,
                published: metaItem.published,
                feed_title: metaItem.feed_title || '',
                thumbnail: metaItem.thumbnail || '',
                video_id: metaItem.video_id || ''
            };
            const temp = document.createElement('div');
            temp.innerHTML = generateItemHtml(feedLike);
            const el = temp.firstElementChild;
            if (el) {
                el.dataset.archived = 'true';
                fragment.appendChild(el);
            }
        });
        feedContainer.appendChild(fragment);
    }

    function renderFeed() {
        if (!feedContainer) return;
        if (feedData.length) {
            feedContainer.innerHTML = feedData.map(generateItemHtml).join('');
        }
    }

    function getVisibleItems() {
        if (!feedContainer) return [];
        return Array.from(feedContainer.querySelectorAll('.feed-item')).filter(
            item => item.style.display !== 'none'
        );
    }

    function highlightItem(index) {
        const visibleItems = getVisibleItems();
        visibleItems.forEach((item, i) => {
            item.classList.toggle('keyboard-focused', i === index);
        });
        if (index >= 0 && index < visibleItems.length) {
            visibleItems[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function applyView(metaItems) {
        if (!feedContainer) return;
        const allItems = Array.from(feedContainer.querySelectorAll('.feed-item'));
        if (allItems.length === 0) {
            if (emptyState && showingNew) emptyState.style.display = '';
            return;
        }

        const metaItemsById = new Map((metaItems || []).map(i => [i.id, i]));

        if (showingNew) {
            allItems.sort((a, b) => {
                const aItem = metaItemsById.get(a.dataset.itemId);
                const bItem = metaItemsById.get(b.dataset.itemId);
                const aIsStarred = aItem?.starred;
                const bIsStarred = bItem?.starred;
                if (aIsStarred === bIsStarred) return 0;
                return aIsStarred ? 1 : -1;
            });

            let visibleCount = 0;
            const fragment = document.createDocumentFragment();
            allItems.forEach(item => {
                const metaItem = metaItemsById.get(item.dataset.itemId);
                const shouldHide = metaItem && metaItem.seen && !metaItem.starred;
                item.style.display = shouldHide ? 'none' : '';
                if (!shouldHide) visibleCount++;
                fragment.appendChild(item);
            });
            feedContainer.appendChild(fragment);

            if (emptyState) emptyState.style.display = visibleCount === 0 ? '' : 'none';
        } else {
            const fragment = document.createDocumentFragment();
            allItems.forEach(item => {
                item.style.display = '';
                fragment.appendChild(item);
            });
            feedContainer.appendChild(fragment);
            if (emptyState) emptyState.style.display = 'none';
        }

        // Update view toggle icon
        const toggleSvg = viewToggleButton.querySelector('svg');
        if (toggleSvg) {
            if (showingNew) {
                toggleSvg.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
            } else {
                toggleSvg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
            }
        }

        // Reset keyboard navigation when view changes
        currentItemIndex = -1;
        highlightItem(-1);
    }

    if (viewToggleButton) {
        viewToggleButton.addEventListener('click', () => {
            showingNew = !showingNew;
            const meta = gistSync.getLocal();
            applyView(meta.items || []);
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Ignore if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const visibleItems = getVisibleItems();
        if (visibleItems.length === 0) return;

        switch (e.key.toLowerCase()) {
            case 'j': // Next item
                e.preventDefault();
                currentItemIndex = Math.min(currentItemIndex + 1, visibleItems.length - 1);
                highlightItem(currentItemIndex);
                break;

            case 'k': // Previous item
                e.preventDefault();
                currentItemIndex = Math.max(currentItemIndex - 1, 0);
                highlightItem(currentItemIndex);
                break;

            case 's': // Star current item
                e.preventDefault();
                if (currentItemIndex >= 0 && currentItemIndex < visibleItems.length) {
                    const starIcon = visibleItems[currentItemIndex].querySelector('.star-icon');
                    if (starIcon) starIcon.click();
                }
                break;

            case 'o': // Open current item
            case 'enter':
                e.preventDefault();
                if (currentItemIndex >= 0 && currentItemIndex < visibleItems.length) {
                    const link = visibleItems[currentItemIndex].querySelector('.feed-item-info a');
                    if (link) window.open(link.href, '_blank');
                }
                break;

            case '?': // Show keyboard help
                e.preventDefault();
                const helpOverlay = document.getElementById('keyboard-help');
                if (helpOverlay) {
                    const isVisible = helpOverlay.style.display !== 'none';
                    helpOverlay.style.display = isVisible ? 'none' : 'flex';
                }
                break;
        }
    });

    if (feedContainer) {
        feedContainer.addEventListener('click', (e) => {
            const starIcon = e.target.closest('.star-icon');
            if (starIcon) {
                const itemId = starIcon.getAttribute('data-item-id');
                let meta = gistSync.getLocal();
                let items = meta.items || [];
                const now = new Date().toISOString();
                let item = items.find(i => i.id === itemId);
                const metadata = resolveItemMetadata(itemId) || {};

                if (item) {
                    item.starred = !item.starred;
                    item.starred_changed_at = now;
                    item.seen = true;
                    if (item.starred) {
                        if (!item.title && metadata.title) item.title = metadata.title;
                        if ((!item.url && metadata.url) || (!item.link && metadata.url)) {
                            item.url = metadata.url;
                            item.link = metadata.url;
                        }
                        if (!item.published && metadata.published) item.published = metadata.published;
                        if (!item.thumbnail && metadata.thumbnail) item.thumbnail = metadata.thumbnail;
                        if (!item.video_id && metadata.video_id) item.video_id = metadata.video_id;
                        if (!item.feed_title && metadata.feed_title) item.feed_title = metadata.feed_title;
                    }
                    starIcon.classList.toggle('starred', item.starred);
                } else {
                    const published = metadata.published || now;
                    item = {
                        id: itemId,
                        date: now,
                        starred: true,
                        starred_changed_at: now,
                        seen: true,
                        title: metadata.title || '',
                        url: metadata.url || '',
                        link: metadata.url || '',
                        published,
                        thumbnail: metadata.thumbnail || '',
                        video_id: metadata.video_id || '',
                        feed_title: metadata.feed_title || ''
                    };
                    items.push(item);
                    starIcon.classList.add('starred');
                }
                meta.items = items;
                meta.updated_at = now;
                gistSync.setLocal(meta);
                renderArchivedItems(meta.items || []);
                applyView(meta.items || []);
                gistSync.pushSoon();
                return;
            }

            const videoPlaceholder = e.target.closest('.video-placeholder');
            if (videoPlaceholder && !videoPlaceholder.classList.contains('video-loaded')) {
                const videoId = videoPlaceholder.getAttribute('data-video-id');
                if (videoId) {
                    videoPlaceholder.classList.add('video-loaded');
                    const playerContainer = document.createElement('div');
                    videoPlaceholder.innerHTML = '';
                    videoPlaceholder.appendChild(playerContainer);
                    createYouTubePlayer(playerContainer, videoId);
                }
            }
        });
    }

    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async () => {
            if (markAllReadBtn.disabled) return;
            
            const meta = gistSync.getLocal();
            meta.items = meta.items || [];
            const now = new Date().toISOString();
            
            let changed = false;
            feedData.forEach(item => {
                let metaItem = meta.items.find(i => i.id === item.id);
                if (!metaItem) {
                    meta.items.push({ id: item.id, date: now, starred: false, seen: true, starred_changed_at: now });
                    changed = true;
                } else if (!metaItem.seen) {
                    metaItem.seen = true;
                    metaItem.starred_changed_at = now;
                    changed = true;
                }
            });

            if (changed) {
                markAllReadBtn.disabled = true;
                markAllReadBtn.classList.add('syncing');
                showToast('Syncing...', 'info', 1000);
                
                meta.updated_at = now;
                gistSync.setLocal(meta);
                try {
                    await upload();
                    showToast('Synced', 'success', 1000);
                } catch (e) {
                    console.warn('Final push before refresh failed:', e);
                    showToast('Sync failed, reloading anyway', 'error', 2000);
                }
                
                // Extra beat to let the user see the success/error
                setTimeout(() => {
                    window.scrollTo(0, 0);
                    window.location.reload();
                }, 500);
            } else {
                window.scrollTo(0, 0);
                window.location.reload();
            }
        });
    }

    // Sync toast notifications
    window.addEventListener('blink-sync', (e) => {
        const { type, message } = e.detail || {};
        if (message) showToast(message, type === 'error' ? 'error' : 'success', 2500);
    });

    // Scroll-to-top button
    const scrollTopBtn = document.getElementById('scroll-top-btn');
    if (scrollTopBtn) {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                requestAnimationFrame(() => {
                    scrollTopBtn.classList.toggle('visible', window.scrollY > 600);
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        }, { passive: true });
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const startupLogic = async () => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.style.display = '';

        await gistSync.syncOnStartup();
        const meta = gistSync.getLocal();
        meta.items = meta.items || [];
        const starredSet = new Set(meta.items.filter(i => i.starred).map(i => i.id));

        const existingItems = feedContainer ? feedContainer.querySelectorAll('.feed-item') : [];

        if (existingItems.length === 0 && feedData.length) {
            renderFeed();
        }

        document.querySelectorAll('#feed-container .star-icon').forEach(star => {
            const id = star.getAttribute('data-item-id');
            if (starredSet.has(id)) {
                star.classList.add('starred');
            }
        });

        ensureMetadataForItems(meta);
        renderArchivedItems(meta.items || []);
        applyView(meta.items || []);

        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (feedContainer) feedContainer.style.display = '';
    };

    startupLogic();
});
