let onYouTubeIframeAPIReadyCallbacks = [];
let ytApiLoaded = false;
window.onYouTubeIframeAPIReady = function () {
    ytApiLoaded = true;
    onYouTubeIframeAPIReadyCallbacks.forEach(callback => callback());
    onYouTubeIframeAPIReadyCallbacks = [];
};

function loadYouTubeAPI(callback) {
    if (ytApiLoaded && typeof YT !== 'undefined' && YT.Player) {
        callback();
        return;
    }

    onYouTubeIframeAPIReadyCallbacks.push(callback);

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]') === null) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.head.appendChild(tag);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Settings Modal (star sync only)
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
        
        // Load settings
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
                applyView(meta.items || []);
                renderArchive(meta.items || []);
            }
        }

        pendingSyncChanges = false;
        showFeedsStatus('Settings saved!', 'success');
        updateSaveButton();
    }

    // Event listeners
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

    // Track settings form changes
    [gistIdInput, githubTokenInput].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                pendingSyncChanges = true;
                updateSaveButton();
            });
        }
    });

    const feedContainer = document.getElementById('feed-container');
    const refreshIcon = document.getElementById('refresh-icon');
    const viewToggleButton = document.getElementById('view-toggle-button');
    const archiveSection = document.getElementById('archive-section');
    const archiveList = document.getElementById('archive-list');
    const archiveEmpty = document.getElementById('archive-empty');
    let feedData = [];
    let feedDataById = new Map();
    let showingNew = true;

    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
            feedDataById = new Map(feedData.map(item => [item.id, item]));
        } catch (e) {
            console.error("Error parsing feed data:", e);
        }
    }

    function getStarredItems() {
        return JSON.parse(localStorage.getItem('starredItems') || '[]');
    }

    const gistSync = (function () {
        const API_BASE = 'https://api.github.com/gists';
        let pushTimeout = null;
        const DEBOUNCE_MS = 1000;

        function getTimeOrZero(v) {
            if (!v) return 0;
            const t = new Date(v).getTime();
            return Number.isFinite(t) ? t : 0;
        }

        function sanitizeItemForStorage(item) {
            if (!item || !item.id) return null;
            const minimal = {
                id: item.id,
                date: item.date || new Date().toISOString(),
                starred: !!item.starred,
                seen: !!item.seen
            };
            // Track reversible starred state with an explicit "last changed" timestamp.
            // This allows unstars to win over older stars during merges.
            if (item.starred_changed_at) minimal.starred_changed_at = item.starred_changed_at;
            if (!minimal.starred_changed_at && item.starredChangedAt) minimal.starred_changed_at = item.starredChangedAt;
            if (item.title) minimal.title = item.title;
            if (item.url || item.link) minimal.url = item.url || item.link;
            if (item.published) minimal.published = item.published;
            return minimal;
        }

        function getConfig() {
            return {
                gistId: localStorage.getItem('GIST_ID'),
                token: localStorage.getItem('GITHUB_TOKEN')
            };
        }

        function getLocal() {
            let raw = localStorage.getItem('blinkMeta');
            if (!raw) {
                const starred = JSON.parse(localStorage.getItem('starredItems') || '[]');
                const now = new Date().toISOString();
                return {
                    items: starred.map(id => ({ id, date: now, starred: true, seen: true, starred_changed_at: now })),
                    updated_at: null
                };
            }
            try {
                const data = JSON.parse(raw);
                if (!data.items) data.items = [];
                // Migration: ensure all items have the 'seen' field
                // Old items without 'seen' are treated as seen (to avoid showing everything as new after upgrade)
                data.items.forEach(item => {
                    if (item && item.seen === undefined) {
                        item.seen = true; // Existing tracked items default to seen
                    }
                    // Migration: ensure all items have the 'starred_changed_at' field.
                    // For existing data we use `updated_at` if present, otherwise fall back to `date`.
                    if (item && !item.starred_changed_at && item.starredChangedAt) {
                        item.starred_changed_at = item.starredChangedAt;
                    }
                    if (item && !item.starred_changed_at) {
                        item.starred_changed_at = data.updated_at || item.date || new Date().toISOString();
                    }
                });
                localStorage.setItem('starredItems', JSON.stringify((data.items || []).filter(item => item.starred).map(item => item.id)));
                return data;
            } catch {
                const starred = JSON.parse(localStorage.getItem('starredItems') || '[]');
                const now = new Date().toISOString();
                return {
                    items: starred.map(id => ({ id, date: now, starred: true, seen: true, starred_changed_at: now })),
                    updated_at: null
                };
            }
        }

        function setLocal(obj) {
            localStorage.setItem('blinkMeta', JSON.stringify(obj));
            localStorage.setItem('starredItems', JSON.stringify((obj.items || []).filter(item => item.starred).map(item => item.id)));
        }

        async function fetchRemote() {
            const { gistId, token } = getConfig();
            if (!gistId || !token) return null;
            const res = await fetch(`${API_BASE}/${gistId}`, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } });
            if (!res.ok) return null;
            const data = await res.json();
            const file = data.files && data.files['starred.json'];
            if (!file || !file.content) return null;
            try {
                const remoteData = JSON.parse(file.content);
                remoteData.updated_at = data.updated_at;
                return remoteData;
            } catch { return null; }
        }

        async function pushRemote(obj) {
            const { gistId, token } = getConfig();
            if (!gistId || !token) return;

            const now = Date.now();
            const retentionDays = getRetentionDays() + 1;
            const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

            const filteredItems = (obj.items || []).filter(item => {
                // Always keep starred items
                if (item.starred) return true;
                // Keep recent unstar actions long enough to propagate across devices,
                // even if the original item is older than the retention window.
                const starChangeTime = getTimeOrZero(item.starred_changed_at || item.starredChangedAt);
                if (starChangeTime && (now - starChangeTime) <= retentionMs) return true;

                // Keep non-starred items within retention window (for cross-device "seen" sync).
                const itemDate = getTimeOrZero(item.date);
                return itemDate && (now - itemDate) <= retentionMs;
            }).map(sanitizeItemForStorage).filter(Boolean);

            const payloadData = {
                ...obj,
                items: filteredItems
            };
            delete payloadData.updated_at;
            delete payloadData.seenItems;

            const payload = { files: { 'starred.json': { content: JSON.stringify(payloadData, null, 2) } } };
            await fetch(`${API_BASE}/${gistId}`, {
                method: 'PATCH',
                headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        function merge(localObj, remoteObj) {
            if (!remoteObj || !remoteObj.items) return localObj || { items: [], updated_at: null };
            if (!localObj || !localObj.items) return remoteObj;

            // Build a map of all items from both sources, keyed by ID
            const mergedById = new Map();

            // Process remote items first
            for (const item of (remoteObj.items || [])) {
                if (item && item.id) {
                    mergedById.set(item.id, { ...item });
                }
            }

            // Merge local items - union of seen/starred states
            for (const item of (localObj.items || [])) {
                if (!item || !item.id) continue;
                const existing = mergedById.get(item.id);
                if (existing) {
                    // Merge: if EITHER source has seen=true, keep it seen
                    existing.seen = existing.seen || item.seen;

                    // Merge starred as a reversible state by taking the most-recent toggle.
                    const existingStarChangedAt = existing.starred_changed_at || existing.starredChangedAt;
                    const itemStarChangedAt = item.starred_changed_at || item.starredChangedAt;
                    const existingStarTime = getTimeOrZero(existingStarChangedAt);
                    const itemStarTime = getTimeOrZero(itemStarChangedAt);

                    if (existingStarTime === 0 && itemStarTime === 0) {
                        // Back-compat: if neither has per-item change timestamps, use meta-level updated_at.
                        // If still tied/unknown, prefer local to support "unstarring" stale remote data.
                        const localTime = getTimeOrZero(localObj.updated_at);
                        const remoteTime = getTimeOrZero(remoteObj.updated_at);
                        const localWins = localTime >= remoteTime;
                        if (localWins) {
                            existing.starred = !!item.starred;
                        } else {
                            existing.starred = !!existing.starred;
                        }
                        existing.starred_changed_at = localWins
                            ? (localObj.updated_at || item.date || new Date().toISOString())
                            : (remoteObj.updated_at || existing.date || new Date().toISOString());
                    } else if (itemStarTime >= existingStarTime) {
                        existing.starred = !!item.starred;
                        existing.starred_changed_at = itemStarChangedAt || item.date || new Date().toISOString();
                    } else {
                        existing.starred = !!existing.starred;
                        existing.starred_changed_at = existingStarChangedAt || existing.date || new Date().toISOString();
                    }
                    // Keep metadata from whichever has it
                    if (!existing.title && item.title) existing.title = item.title;
                    if (!existing.url && item.url) existing.url = item.url;
                    if (!existing.link && item.link) existing.link = item.link;
                    if (!existing.published && item.published) existing.published = item.published;
                    // Use earlier date (first seen)
                    if (item.date && existing.date) {
                        const itemTime = new Date(item.date).getTime();
                        const existingTime = new Date(existing.date).getTime();
                        if (itemTime < existingTime) existing.date = item.date;
                    } else if (item.date && !existing.date) {
                        existing.date = item.date;
                    }
                } else {
                    // Item only exists locally
                    const remoteUpdateTime = getTimeOrZero(remoteObj.updated_at);
                    const localChangeTime = getTimeOrZero(item.starred_changed_at || item.starredChangedAt || item.date);

                    // If item is starred locally but missing from remote, check if it was deleted remotely.
                    // If the remote update is newer than our local change, assume deletion.
                    if (item.starred && remoteUpdateTime > localChangeTime) {
                        continue;
                    }
                    mergedById.set(item.id, { ...item });
                }
            }

            // Use the most recent updated_at
            const localTime = localObj.updated_at ? new Date(localObj.updated_at).getTime() : 0;
            const remoteTime = remoteObj.updated_at ? new Date(remoteObj.updated_at).getTime() : 0;
            const updated_at = remoteTime > localTime ? remoteObj.updated_at : localObj.updated_at;

            return { items: Array.from(mergedById.values()), updated_at };
        }

        function schedulePush() {
            if (pushTimeout) clearTimeout(pushTimeout);
            pushTimeout = setTimeout(async () => {
                const local = getLocal();
                try {
                    await pushRemote(local);
                } catch (e) { console.warn('Failed pushing to gist:', e); }
            }, DEBOUNCE_MS);
        }

        return {
            getLocal,
            setLocal,
            syncOnStartup: async () => {
                const cfg = getConfig();
                if (!cfg.gistId || !cfg.token) return;
                const remote = await fetchRemote();
                if (remote) {
                    const local = getLocal();
                    const resolved = merge(local, remote);
                    setLocal(resolved);
                }
            },
            pushSoon: schedulePush,
            pull: async () => {
                const cfg = getConfig();
                if (!cfg.gistId || !cfg.token) return false;
                const remote = await fetchRemote();
                if (remote) {
                    const local = getLocal();
                    const resolved = merge(local, remote);
                    setLocal(resolved);
                    return true;
                }
                return false;
            }
        };
    })();

    function generateItemHtml(item) {
        let mediaHtml = '';
        if (item.video_id) {
            const thumbnailUrl = `https://img.youtube.com/vi/${item.video_id}/sddefault.jpg`;
            mediaHtml = `<div class="video-placeholder" data-video-id="${item.video_id}"><img src="${thumbnailUrl}" alt="Video Thumbnail" class="video-thumbnail"><div class="play-button"></div></div>`;
        } else if (item.thumbnail) {
            mediaHtml = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="${item.title}" class="feed-thumbnail"></a>`;
        }

        const starredItems = getStarredItems();
        const isStarred = starredItems.includes(item.id);
        const starHtml = `<span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>`;

        return `<div class="feed-item" data-item-id="${item.id}">${starHtml}${mediaHtml}<div class="feed-item-info"><h2><a href="${item.link}" target="_blank">${item.title}</a></h2></div></div>`;
    }

    let cachedRetentionDays = null;

    function getRetentionDays() {
        if (cachedRetentionDays !== null) {
            return cachedRetentionDays;
        }
        const lastUpdatedElement = document.querySelector('.last-updated');
        if (lastUpdatedElement) {
            const match = lastUpdatedElement.textContent.match(/\|\s*(\d+)d/);
            if (match && match[1]) {
                const parsed = parseInt(match[1], 10);
                if (!Number.isNaN(parsed)) {
                    cachedRetentionDays = parsed;
                    return cachedRetentionDays;
                }
            }
        }
        cachedRetentionDays = 5;
        return cachedRetentionDays;
    }

    function escapeItemId(itemId) {
        if (window.CSS && CSS.escape) {
            return CSS.escape(itemId);
        }
        return itemId.replace(/"/g, '\\"');
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
                published: feedItem.published
            };
        }
        return getDomMetadataForItem(itemId);
    }

    function ensureMetadataForItems(meta) {
        if (!meta || !Array.isArray(meta.items)) return false;
        let changed = false;
        meta.items.forEach(item => {
            if (!item || !item.starred) return;
            if (item.title && (item.url || item.link) && item.published) return;
            const metadata = resolveItemMetadata(item.id);
            if (metadata) {
                let itemChanged = false;
                if (!item.title && metadata.title) {
                    item.title = metadata.title;
                    itemChanged = true;
                }
                if (!item.url && metadata.url) {
                    item.url = metadata.url;
                    itemChanged = true;
                }
                if (!item.link && metadata.url) {
                    item.link = metadata.url;
                    itemChanged = true;
                }
                if (!item.published && metadata.published) {
                    item.published = metadata.published;
                    itemChanged = true;
                }
                if (itemChanged) changed = true;
            }
        });
        return changed;
    }

    const SAFE_ARCHIVE_PROTOCOLS = new Set(['http:', 'https:']);

    function getSafeArchiveUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return '';
        const trimmed = rawUrl.trim();
        if (!trimmed) return '';
        try {
            const parsed = new URL(trimmed, window.location.origin);
            return SAFE_ARCHIVE_PROTOCOLS.has(parsed.protocol) ? trimmed : '';
        } catch {
            return '';
        }
    }

    function renderArchive(metaItems = []) {
        if (!archiveSection || !archiveList) return;
        const retentionMs = getRetentionDays() * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const activeFeedIds = new Set(feedData.map(item => item.id));
        const archived = (metaItems || [])
            .filter(item => item && item.starred && !activeFeedIds.has(item.id))
            .map(item => {
                const publishedSource = item.published || item.date;
                const publishedTime = publishedSource ? new Date(publishedSource).getTime() : NaN;
                return {
                    id: item.id,
                    title: item.title,
                    url: item.url || item.link,
                    published: publishedSource,
                    publishedTime
                };
            })
            .filter(item => item.url && Number.isFinite(item.publishedTime) && (now - item.publishedTime) > retentionMs)
            .sort((a, b) => b.publishedTime - a.publishedTime);

        archiveSection.style.display = '';
        if (archived.length === 0) {
            archiveList.innerHTML = '';
            if (archiveEmpty) archiveEmpty.style.display = '';
            return;
        }

        if (archiveEmpty) archiveEmpty.style.display = 'none';
        archiveList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        archived.forEach(item => {
            const li = document.createElement('li');
            li.className = 'archive-item';
            li.dataset.itemId = item.id;

            const linkWrapper = document.createElement('div');
            linkWrapper.className = 'archive-item-info';

            const link = document.createElement('a');
            const title = item.title || 'Untitled item';
            link.textContent = title;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const safeUrl = getSafeArchiveUrl(item.url);
            if (safeUrl) {
                link.href = safeUrl;
            } else {
                link.removeAttribute('href');
                link.setAttribute('aria-disabled', 'true');
            }
            linkWrapper.appendChild(link);
            li.appendChild(linkWrapper);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'archive-delete-btn';
            deleteBtn.textContent = 'Delete';
            deleteBtn.dataset.itemId = item.id;
            deleteBtn.title = 'Delete this archived item';
            deleteBtn.setAttribute('aria-label', `Delete ${title} from archive`);
            li.appendChild(deleteBtn);

            fragment.appendChild(li);
        });
        archiveList.appendChild(fragment);
    }

    function deleteArchivedItem(itemId) {
        if (!itemId) return;
        const meta = gistSync.getLocal();
        if (!meta || !Array.isArray(meta.items)) return;
        const index = meta.items.findIndex(item => item && item.id === itemId);
        if (index === -1) return;
        meta.items.splice(index, 1);
        meta.updated_at = new Date().toISOString();
        gistSync.setLocal(meta);
        renderArchive(meta.items || []);
        gistSync.pushSoon();
    }

    function renderFeed() {
        if (!feedContainer) return;
        if (feedData.length) {
            feedContainer.innerHTML = feedData.map(generateItemHtml).join('');
        }
    }

    function applyView(metaItems) {
        if (!feedContainer) return;
        const allItems = Array.from(feedContainer.querySelectorAll('.feed-item'));
        if (allItems.length === 0) return;
        
        const metaItemsById = new Map((metaItems || []).map(i => [i.id, i]));

        if (showingNew) {
            viewToggleButton.textContent = 'new';

            // Sort: starred items go to bottom, unseen items stay at top
            allItems.sort((a, b) => {
                const aItem = metaItemsById.get(a.dataset.itemId);
                const bItem = metaItemsById.get(b.dataset.itemId);
                const aIsStarred = aItem?.starred;
                const bIsStarred = bItem?.starred;
                if (aIsStarred === bIsStarred) return 0;
                return aIsStarred ? 1 : -1;
            });

            const fragment = document.createDocumentFragment();
            allItems.forEach(item => {
                const metaItem = metaItemsById.get(item.dataset.itemId);
                // Hide if item has been seen AND is not starred
                const shouldHide = metaItem && metaItem.seen && !metaItem.starred;
                item.style.display = shouldHide ? 'none' : '';
                fragment.appendChild(item);
            });
            feedContainer.appendChild(fragment);
        } else {
            viewToggleButton.textContent = 'all';
            const fragment = document.createDocumentFragment();
            allItems.forEach(item => {
                item.style.display = '';
                fragment.appendChild(item);
            });
            feedContainer.appendChild(fragment);
        }
    }

    if (viewToggleButton) {
        viewToggleButton.addEventListener('click', () => {
            showingNew = !showingNew;
            const meta = gistSync.getLocal();
            applyView(meta.items || []);
        });
    }

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
                    // Always mark as seen when interacting with star
                    item.seen = true;
                    if (item.starred) {
                        if (!item.title && metadata.title) item.title = metadata.title;
                        if ((!item.url && metadata.url) || (!item.link && metadata.url)) {
                            item.url = metadata.url;
                            item.link = metadata.url;
                        }
                        if (!item.published && metadata.published) item.published = metadata.published;
                    }
                    starIcon.classList.toggle('starred', item.starred);
                } else {
                    const published = metadata.published || now;
                    item = {
                        id: itemId,
                        date: now,
                        starred: true,
                        starred_changed_at: now,
                        seen: true, // Mark as seen when starring
                        title: metadata.title || '',
                        url: metadata.url || '',
                        link: metadata.url || '',
                        published
                    };
                    items.push(item);
                    starIcon.classList.add('starred');
                }
                meta.items = items;
                meta.updated_at = now;
                gistSync.setLocal(meta);
                renderArchive(meta.items || []);
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

                    loadYouTubeAPI(() => {
                        new YT.Player(playerContainer, {
                            videoId: videoId,
                            width: '100%',
                            height: '100%',
                            playerVars: {
                                'autoplay': 0,
                                'playsinline': 1,
                                'controls': 1,
                                'mute': 0

                            },
                            events: {
                                'onReady': (event) => {
                                    event.target.getIframe().className = 'video-iframe';
                                    event.target.playVideo();
                                }
                            }
                        });
                    });
                }
            }
        });
    }

    if (refreshIcon) {
        refreshIcon.addEventListener('click', () => window.location.reload());
    }

    if (archiveList) {
        archiveList.addEventListener('click', e => {
            const deleteBtn = e.target.closest('.archive-delete-btn');
            if (!deleteBtn) return;
            e.preventDefault();
            const itemId = deleteBtn.dataset.itemId || deleteBtn.closest('li')?.dataset.itemId;
            if (!itemId) return;

            const archiveItem = deleteBtn.closest('.archive-item');
            const itemTitle = archiveItem?.querySelector('.archive-item-info a')?.textContent?.trim();
            const confirmed = window.confirm(itemTitle ? `Delete "${itemTitle}" from the archive? This cannot be undone.` : 'Delete this archived item? This cannot be undone.');
            if (!confirmed) return;

            deleteArchivedItem(itemId);
        });
    }

    const startupLogic = async () => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        await gistSync.syncOnStartup();
        const meta = gistSync.getLocal();
        meta.items = meta.items || [];
        const starredSet = new Set(meta.items.filter(i => i.starred).map(i => i.id));

        // Check if items are already pre-rendered in the DOM
        const existingItems = feedContainer ? feedContainer.querySelectorAll('.feed-item') : [];
        
        if (existingItems.length === 0 && feedData.length) {
            // Only render if container is empty but we have data
            renderFeed();
        }

        // Hydrate star icons based on synced state
        document.querySelectorAll('#feed-container .star-icon').forEach(star => {
            const id = star.getAttribute('data-item-id');
            if (starredSet.has(id)) {
                star.classList.add('starred');
            }
        });

        ensureMetadataForItems(meta);
        applyView(meta.items || []);
        renderArchive(meta.items || []);

        // Track all items displayed on the page - if displayed, it's considered seen
        const allDomIds = Array.from(document.querySelectorAll('#feed-container .feed-item')).map(el => el.dataset.itemId);
        const metaItemsById = new Map(meta.items.map(item => [item.id, item]));
        let changed = false;
        const now = new Date().toISOString();

        allDomIds.forEach(id => {
            if (!metaItemsById.has(id)) {
                // New item - mark as seen since it's being displayed
                meta.items.push({ id, date: now, starred: false, seen: true });
                changed = true;
            } else {
                // Existing item - mark as seen if not already
                const item = metaItemsById.get(id);
                if (!item.seen) {
                    item.seen = true;
                    changed = true;
                }
            }
        });

        if (changed) {
            meta.updated_at = now;
            gistSync.setLocal(meta);
            gistSync.pushSoon();
            renderArchive(meta.items || []);
        }

        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (feedContainer) feedContainer.style.display = '';
    };

    startupLogic();
});
