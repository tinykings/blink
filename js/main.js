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
    // Settings Modal (combined feeds + sync)
    const settingsIcon = document.getElementById('settings-icon');
    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');
    const githubRepoInput = document.getElementById('github-repo');
    const gistIdInput = document.getElementById('gist-id');
    const githubTokenInput = document.getElementById('github-token');
    const feedsStatus = document.getElementById('feeds-status');
    const feedsList = document.getElementById('feeds-list');
    const newFeedUrlInput = document.getElementById('new-feed-url');
    const addFeedBtn = document.getElementById('add-feed-btn');
    const feedsSaveBtn = document.getElementById('feeds-save');
    const feedsCancelBtn = document.getElementById('feeds-cancel');
    const feedsTabs = document.querySelectorAll('.feeds-tab');
    const feedsPanel = document.getElementById('feeds-panel');
    const syncPanel = document.getElementById('sync-panel');

    let feedsData = { rss: [], youtube: [], sha: null };
    let pendingChanges = { add: [], remove: [] };
    let pendingSyncChanges = false;
    let currentSection = 'rss';

    const feedsManager = {
        getConfig() {
            return {
                repo: localStorage.getItem('GITHUB_REPO'),
                token: localStorage.getItem('GITHUB_TOKEN')
            };
        },

        async fetchFeeds() {
            const { repo, token } = this.getConfig();
            if (!repo || !token) {
                return { error: 'Please configure GitHub Repo and Token in Settings first.' };
            }

            try {
                const res = await fetch(`https://api.github.com/repos/${repo}/contents/feeds.txt`, {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github+json'
                    }
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        return { error: 'feeds.txt not found in repository.' };
                    }
                    return { error: `GitHub API error: ${res.status}` };
                }

                const data = await res.json();
                const content = atob(data.content);
                return { content, sha: data.sha };
            } catch (e) {
                return { error: `Failed to fetch feeds: ${e.message}` };
            }
        },

        parseFeeds(content) {
            const lines = content.split('\n');
            const rss = [];
            const youtube = [];
            let currentSection = null;
            let pendingComment = null;

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                if (line.startsWith('#')) {
                    const lowered = line.toLowerCase();
                    if (lowered === '#rss') {
                        currentSection = 'rss';
                        pendingComment = null;
                    } else if (lowered === '#youtube') {
                        currentSection = 'youtube';
                        pendingComment = null;
                    } else if (currentSection === 'youtube') {
                        pendingComment = line.replace(/^#\s*/, '');
                    }
                    continue;
                }

                if (currentSection === 'rss') {
                    rss.push({ url: line, name: this.extractFeedName(line) });
                } else if (currentSection === 'youtube') {
                    youtube.push({ url: line, name: pendingComment || this.extractChannelId(line) });
                    pendingComment = null;
                }
            }

            return { rss, youtube };
        },

        extractFeedName(url) {
            try {
                const urlObj = new URL(url);
                return urlObj.hostname.replace('www.', '');
            } catch {
                return url;
            }
        },

        extractChannelId(url) {
            const match = url.match(/channel_id=([\w-]+)/);
            return match ? match[1] : url;
        },

        buildFeedsContent(rss, youtube) {
            let content = '#rss\n';
            for (const feed of rss) {
                content += `${feed.url}\n`;
            }
            content += '\n#youtube\n';
            for (const feed of youtube) {
                if (feed.name && feed.name !== this.extractChannelId(feed.url)) {
                    content += `# ${feed.name}\n`;
                }
                content += `${feed.url}\n`;
            }
            return content;
        },

        async saveFeeds(content, sha) {
            const { repo, token } = this.getConfig();
            if (!repo || !token) {
                return { error: 'GitHub configuration missing.' };
            }

            try {
                const res = await fetch(`https://api.github.com/repos/${repo}/contents/feeds.txt`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: 'Update feeds.txt via Blink',
                        content: btoa(content),
                        sha: sha
                    })
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    return { error: errData.message || `GitHub API error: ${res.status}` };
                }

                const data = await res.json();
                return { success: true, sha: data.content.sha };
            } catch (e) {
                return { error: `Failed to save feeds: ${e.message}` };
            }
        }
    };

    function showFeedsStatus(message, type = 'info') {
        feedsStatus.textContent = message;
        feedsStatus.className = 'feeds-status ' + type;
    }

    function clearFeedsStatus() {
        feedsStatus.textContent = '';
        feedsStatus.className = 'feeds-status';
    }

    function renderFeedsList() {
        const feeds = currentSection === 'rss' ? feedsData.rss : feedsData.youtube;
        const pendingAdds = pendingChanges.add.filter(f => f.section === currentSection);

        if (feeds.length === 0 && pendingAdds.length === 0) {
            feedsList.innerHTML = '<div class="feeds-empty">No feeds in this section</div>';
            return;
        }

        let html = '';

        // Show pending additions first
        for (const feed of pendingAdds) {
            html += `
                <div class="feed-entry pending-add" data-url="${feed.url}" data-pending="add">
                    <div class="feed-entry-info">
                        <div class="feed-entry-name">+ New</div>
                        <div class="feed-entry-url">${feed.url}</div>
                    </div>
                    <button class="feed-entry-remove" title="Cancel add">×</button>
                </div>
            `;
        }

        // Show existing feeds
        for (const feed of feeds) {
            const isPendingRemove = pendingChanges.remove.some(r => r.url === feed.url && r.section === currentSection);
            html += `
                <div class="feed-entry ${isPendingRemove ? 'pending-remove' : ''}" data-url="${feed.url}">
                    <div class="feed-entry-info">
                        <div class="feed-entry-name">${feed.name}</div>
                        <div class="feed-entry-url">${feed.url}</div>
                    </div>
                    <button class="feed-entry-remove" title="${isPendingRemove ? 'Undo remove' : 'Remove feed'}">${isPendingRemove ? '↩' : '×'}</button>
                </div>
            `;
        }

        feedsList.innerHTML = html;
    }

    function updateSaveButton() {
        const hasFeedChanges = pendingChanges.add.length > 0 || pendingChanges.remove.length > 0;
        const hasChanges = hasFeedChanges || pendingSyncChanges;
        feedsSaveBtn.disabled = !hasChanges;
    }

    async function openSettingsModal() {
        settingsModal.style.display = 'flex';
        
        // Load sync settings
        if (githubRepoInput) githubRepoInput.value = localStorage.getItem('GITHUB_REPO') || '';
        if (gistIdInput) gistIdInput.value = localStorage.getItem('GIST_ID') || '';
        if (githubTokenInput) githubTokenInput.value = localStorage.getItem('GITHUB_TOKEN') || '';
        
        // Reset to RSS tab
        currentSection = 'rss';
        feedsTabs.forEach(t => t.classList.toggle('active', t.dataset.section === 'rss'));
        if (feedsPanel) feedsPanel.style.display = '';
        if (syncPanel) syncPanel.style.display = 'none';
        
        // Load feeds
        feedsList.innerHTML = '<div class="feeds-loading">Loading feeds...</div>';
        clearFeedsStatus();
        pendingChanges = { add: [], remove: [] };
        pendingSyncChanges = false;
        updateSaveButton();

        const result = await feedsManager.fetchFeeds();
        if (result.error) {
            showFeedsStatus(result.error, 'error');
            feedsList.innerHTML = '<div class="feeds-empty">Could not load feeds</div>';
            return;
        }

        const parsed = feedsManager.parseFeeds(result.content);
        feedsData = { ...parsed, sha: result.sha };
        renderFeedsList();
    }

    function closeSettingsModal() {
        settingsModal.style.display = 'none';
    }

    function addFeed() {
        const url = newFeedUrlInput.value.trim();
        if (!url) return;

        // Determine section based on URL
        let section = currentSection;
        if (url.includes('youtube.com')) {
            section = 'youtube';
        }

        // Check if already exists
        const feeds = section === 'rss' ? feedsData.rss : feedsData.youtube;
        if (feeds.some(f => f.url === url) || pendingChanges.add.some(f => f.url === url)) {
            showFeedsStatus('This feed already exists.', 'error');
            return;
        }

        pendingChanges.add.push({ url, section, name: feedsManager.extractFeedName(url) });
        newFeedUrlInput.value = '';
        clearFeedsStatus();

        // Switch to appropriate tab
        if (section !== currentSection) {
            currentSection = section;
            feedsTabs.forEach(t => t.classList.toggle('active', t.dataset.section === section));
        }

        renderFeedsList();
        updateSaveButton();
    }

    async function saveChanges() {
        const hasFeedChanges = pendingChanges.add.length > 0 || pendingChanges.remove.length > 0;
        
        if (!hasFeedChanges && !pendingSyncChanges) return;

        feedsSaveBtn.disabled = true;

        // Save sync settings if changed
        if (pendingSyncChanges) {
            const githubRepo = githubRepoInput ? githubRepoInput.value.trim() : '';
            const gistId = gistIdInput ? gistIdInput.value.trim() : '';
            const githubToken = githubTokenInput ? githubTokenInput.value.trim() : '';
            localStorage.setItem('GITHUB_REPO', githubRepo);
            localStorage.setItem('GIST_ID', gistId);
            localStorage.setItem('GITHUB_TOKEN', githubToken);

            if (gistId && githubToken) {
                showFeedsStatus('Syncing from Gist...', 'info');
                localStorage.removeItem('blinkMeta');
                const success = await gistSync.pull();
                if (success) {
                    const meta = gistSync.getLocal();
                    renderFeed(showingStarred ? 'starred' : 'all');
                    applyView(meta.items || []);
                    renderArchive(meta.items || []);
                }
            }
            
            pendingSyncChanges = false;
        }

        // Save feed changes if any
        if (hasFeedChanges) {
            showFeedsStatus('Saving feed changes...', 'info');

            // Apply pending changes
            let rss = [...feedsData.rss];
            let youtube = [...feedsData.youtube];

            // Add new feeds
            for (const feed of pendingChanges.add) {
                if (feed.section === 'rss') {
                    rss.push({ url: feed.url, name: feed.name });
                } else {
                    youtube.push({ url: feed.url, name: feed.name });
                }
            }

            // Remove feeds
            for (const feed of pendingChanges.remove) {
                if (feed.section === 'rss') {
                    rss = rss.filter(f => f.url !== feed.url);
                } else {
                    youtube = youtube.filter(f => f.url !== feed.url);
                }
            }

            const content = feedsManager.buildFeedsContent(rss, youtube);
            const result = await feedsManager.saveFeeds(content, feedsData.sha);

            if (result.error) {
                showFeedsStatus(result.error, 'error');
                feedsSaveBtn.disabled = false;
                return;
            }

            // Update local state
            feedsData = { rss, youtube, sha: result.sha };
            pendingChanges = { add: [], remove: [] };
            renderFeedsList();
            showFeedsStatus('Changes saved! Run the feed fetcher to update the site.', 'success');
        } else {
            showFeedsStatus('Settings saved!', 'success');
        }
        
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
    if (addFeedBtn) {
        addFeedBtn.addEventListener('click', addFeed);
    }
    if (newFeedUrlInput) {
        newFeedUrlInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addFeed();
            }
        });
    }
    if (feedsSaveBtn) {
        feedsSaveBtn.addEventListener('click', saveChanges);
    }

    // Track sync form changes
    [githubRepoInput, gistIdInput, githubTokenInput].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                pendingSyncChanges = true;
                updateSaveButton();
            });
        }
    });

    feedsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentSection = tab.dataset.section;
            feedsTabs.forEach(t => t.classList.toggle('active', t === tab));
            
            // Show/hide panels based on section
            if (currentSection === 'sync') {
                if (feedsPanel) feedsPanel.style.display = 'none';
                if (syncPanel) syncPanel.style.display = '';
            } else {
                if (feedsPanel) feedsPanel.style.display = '';
                if (syncPanel) syncPanel.style.display = 'none';
                renderFeedsList();
            }
        });
    });

    if (feedsList) {
        feedsList.addEventListener('click', e => {
            const removeBtn = e.target.closest('.feed-entry-remove');
            if (!removeBtn) return;

            const entry = removeBtn.closest('.feed-entry');
            const url = entry.dataset.url;
            const isPendingAdd = entry.dataset.pending === 'add';

            if (isPendingAdd) {
                // Cancel pending add
                pendingChanges.add = pendingChanges.add.filter(f => f.url !== url);
            } else {
                // Toggle pending remove
                const existingIdx = pendingChanges.remove.findIndex(f => f.url === url && f.section === currentSection);
                if (existingIdx >= 0) {
                    pendingChanges.remove.splice(existingIdx, 1);
                } else {
                    pendingChanges.remove.push({ url, section: currentSection });
                }
            }

            renderFeedsList();
            updateSaveButton();
        });
    }

    const feedContainer = document.getElementById('feed-container');
    const starToggle = document.getElementById('star-toggle');
    const refreshIcon = document.getElementById('refresh-icon');
    const viewToggleButton = document.getElementById('view-toggle-button');
    const archiveSection = document.getElementById('archive-section');
    const archiveList = document.getElementById('archive-list');
    const archiveEmpty = document.getElementById('archive-empty');
    let feedData = [];
    let feedDataById = new Map();
    let showingStarred = false;
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

        function sanitizeItemForStorage(item) {
            if (!item || !item.id) return null;
            const minimal = {
                id: item.id,
                date: item.date || new Date().toISOString(),
                starred: !!item.starred
            };
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
                return { items: starred.map(id => ({ id, date: new Date().toISOString(), starred: true })), updated_at: null };
            }
            try {
                const data = JSON.parse(raw);
                if (!data.items) data.items = [];
                localStorage.setItem('starredItems', JSON.stringify((data.items || []).filter(item => item.starred).map(item => item.id)));
                return data;
            } catch {
                const starred = JSON.parse(localStorage.getItem('starredItems') || '[]');
                return { items: starred.map(id => ({ id, date: new Date().toISOString(), starred: true })), updated_at: null };
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
                if (item.starred) return true;
                const itemDate = new Date(item.date).getTime();
                return !isNaN(itemDate) && (now - itemDate) <= retentionMs;
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
            const localTime = localObj && localObj.updated_at ? new Date(localObj.updated_at).getTime() : 0;
            const remoteTime = remoteObj && remoteObj.updated_at ? new Date(remoteObj.updated_at).getTime() : 0;

            if (!remoteObj || !remoteObj.items) return localObj || { items: [], updated_at: null };
            if (!localObj || !localObj.items) return remoteObj;

            const itemsById = new Map();

            const olderObj = remoteTime > localTime ? localObj : remoteObj;
            const newerObj = remoteTime > localTime ? remoteObj : localObj;

            // Add all items from the older object first.
            for (const item of olderObj.items) {
                if (item && item.id) {
                    itemsById.set(item.id, { ...item });
                }
            }

            // Then merge with items from the newer object. This handles updates.
            for (const item of newerObj.items) {
                if (item && item.id) {
                    const existing = itemsById.get(item.id) || {};
                    itemsById.set(item.id, { ...existing, ...item });
                }
            }

            const mergedItems = Array.from(itemsById.values());

            return { items: mergedItems, updated_at: newerObj.updated_at };
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
        const starHtml = item.leaving_soon ? '<span class="leaving-soon-icon" title="one day left, leaving tomorrow" aria-label="one day left, leaving tomorrow" role="img">⏰</span>' : `<span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>`;

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

    function renderFeed(filter = 'all') {
        if (!feedContainer) return;
        if (feedData.length) {
            const starredItems = getStarredItems();
            let itemsToRender = feedData;
            if (filter === 'starred') {
                itemsToRender = feedData.filter(item => starredItems.includes(item.id));
            }
            feedContainer.innerHTML = itemsToRender.map(generateItemHtml).join('');
        } else {
            const starredItems = getStarredItems();
            const items = Array.from(feedContainer.querySelectorAll('.feed-item'));
            items.forEach(el => {
                const id = el.getAttribute('data-item-id');
                el.style.display = (filter === 'starred' && !starredItems.includes(id)) ? 'none' : '';
            });
        }
    }

    function applyView(metaItems) {
        const allItems = Array.from(document.querySelectorAll('#feed-container .feed-item'));
        const metaItemsById = new Map((metaItems || []).map(i => [i.id, i]));

        if (showingNew) {
            viewToggleButton.textContent = 'new';

            allItems.sort((a, b) => {
                const aIsStarred = metaItemsById.get(a.dataset.itemId)?.starred;
                const bIsStarred = metaItemsById.get(b.dataset.itemId)?.starred;
                if (aIsStarred === bIsStarred) return 0;
                return aIsStarred ? 1 : -1;
            });

            if (feedContainer) {
                allItems.forEach(item => feedContainer.appendChild(item));
            }

            allItems.forEach(item => {
                const metaItem = metaItemsById.get(item.dataset.itemId);
                item.style.display = (metaItem && !metaItem.starred) ? 'none' : '';
            });
        } else {
            viewToggleButton.textContent = 'all';
            allItems.forEach(item => {
                item.style.display = '';
            });
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

    if (starToggle) {
        starToggle.addEventListener('click', (e) => {
            e.preventDefault();
            showingStarred = !showingStarred;
            renderFeed(showingStarred ? 'starred' : 'all');
            starToggle.classList.toggle('active', showingStarred);
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
        const feedContainer = document.getElementById('feed-container');
        const loadingOverlay = document.getElementById('loading-overlay');

        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        await gistSync.syncOnStartup();
        const meta = gistSync.getLocal();
        meta.items = meta.items || [];

        if (feedData.length) {
            renderFeed();
        } else {
            const starred = new Set(getStarredItems());
            feedContainer.querySelectorAll('.feed-item').forEach(itemEl => {
                const id = itemEl.getAttribute('data-item-id');
                const star = itemEl.querySelector('.star-icon');
                if (!star) {
                    const newStar = document.createElement('span');
                    newStar.className = 'star-icon' + (starred.has(id) ? ' starred' : '');
                    newStar.dataset.itemId = id;
                    newStar.textContent = '★';
                    itemEl.prepend(newStar);
                } else {
                    star.classList.toggle('starred', starred.has(id));
                }
            });
        }

        const metadataPatched = ensureMetadataForItems(meta);
        applyView(meta.items || []);
        renderArchive(meta.items || []);

        const allDomIds = Array.from(document.querySelectorAll('#feed-container .feed-item')).map(el => el.dataset.itemId);
        const metaItemsById = new Map((meta.items || []).map(item => [item.id, item]));
        let changed = metadataPatched;
        const now = new Date().toISOString();

        allDomIds.forEach(id => {
            if (!metaItemsById.has(id)) {
                meta.items.push({ id, date: now, starred: false });
                changed = true;
            } else {
                const item = metaItemsById.get(id);
                if (!item.starred) {
                    item.date = now;
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

    document.querySelectorAll('img.feed-thumbnail, img.video-thumbnail').forEach(img => {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer-when-downgrade';
    });
});
