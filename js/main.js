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
    // Settings modal logic
    const settingsIcon = document.getElementById('settings-icon');
    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');
    const githubRepoInput = document.getElementById('github-repo');
    const gistIdInput = document.getElementById('gist-id');
    const githubTokenInput = document.getElementById('github-token');
    const settingsCancel = document.getElementById('settings-cancel');

    function openSettingsModal() {
        githubRepoInput.value = localStorage.getItem('GITHUB_REPO') || '';
        gistIdInput.value = localStorage.getItem('GIST_ID') || '';
        githubTokenInput.value = localStorage.getItem('GITHUB_TOKEN') || '';
        settingsModal.style.display = 'flex';
    }

    function closeSettingsModal() {
        settingsModal.style.display = 'none';
    }

    if (settingsIcon) {
        settingsIcon.addEventListener('click', openSettingsModal);
    }
    if (settingsCancel) {
        settingsCancel.addEventListener('click', closeSettingsModal);
    }
    if (settingsForm) {
        settingsForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const githubRepo = githubRepoInput.value.trim();
            const gistId = gistIdInput.value.trim();
            const githubToken = githubTokenInput.value.trim();
            localStorage.setItem('GITHUB_REPO', githubRepo);
            localStorage.setItem('GIST_ID', gistId);
            localStorage.setItem('GITHUB_TOKEN', githubToken);

            if (gistId && githubToken) {
                localStorage.removeItem('blinkMeta');
                const success = await gistSync.pull();
                if (success) {
                    const meta = gistSync.getLocal();
                    renderFeed(showingStarred ? 'starred' : 'all');
                    applyView(meta.items || []);
                    alert('Loaded from Gist!');
                } else {
                    alert('Could not load from Gist. Please check your ID and Token.');
                }
            }

            closeSettingsModal();
        });
    }
    if (settingsModal) {
        settingsModal.addEventListener('click', function (e) {
            if (e.target === settingsModal) closeSettingsModal();
        });
    }

    // Feeds Management Modal Logic
    const feedsIcon = document.getElementById('feeds-icon');
    const feedsModal = document.getElementById('feeds-modal');
    const feedsStatus = document.getElementById('feeds-status');
    const feedsList = document.getElementById('feeds-list');
    const newFeedUrlInput = document.getElementById('new-feed-url');
    const addFeedBtn = document.getElementById('add-feed-btn');
    const feedsSaveBtn = document.getElementById('feeds-save');
    const feedsCancelBtn = document.getElementById('feeds-cancel');
    const feedsTabs = document.querySelectorAll('.feeds-tab');

    let feedsData = { rss: [], youtube: [], sha: null };
    let pendingChanges = { add: [], remove: [] };
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
        const hasChanges = pendingChanges.add.length > 0 || pendingChanges.remove.length > 0;
        feedsSaveBtn.disabled = !hasChanges;
    }

    async function openFeedsModal() {
        feedsModal.style.display = 'flex';
        feedsList.innerHTML = '<div class="feeds-loading">Loading feeds...</div>';
        clearFeedsStatus();
        pendingChanges = { add: [], remove: [] };
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

    function closeFeedsModal() {
        feedsModal.style.display = 'none';
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
        if (pendingChanges.add.length === 0 && pendingChanges.remove.length === 0) return;

        feedsSaveBtn.disabled = true;
        showFeedsStatus('Saving changes...', 'info');

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
        updateSaveButton();
        showFeedsStatus('Changes saved! Run the feed fetcher to update the site.', 'success');
    }

    // Event listeners
    if (feedsIcon) {
        feedsIcon.addEventListener('click', openFeedsModal);
    }
    if (feedsCancelBtn) {
        feedsCancelBtn.addEventListener('click', closeFeedsModal);
    }
    if (feedsModal) {
        feedsModal.addEventListener('click', e => {
            if (e.target === feedsModal) closeFeedsModal();
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

    feedsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentSection = tab.dataset.section;
            feedsTabs.forEach(t => t.classList.toggle('active', t === tab));
            renderFeedsList();
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
    let feedData = [];
    let showingStarred = false;
    let showingNew = true;

    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
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
            const lastUpdatedElement = document.querySelector('.last-updated');
            let retentionDays = 6; // Default to 6 days
            if (lastUpdatedElement) {
                const text = lastUpdatedElement.textContent;
                const match = text.match(/\|\s*(\d+)d/);
                if (match && match[1]) {
                    retentionDays = parseInt(match[1], 10) + 1;
                }
            }
            const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

            const filteredItems = (obj.items || []).filter(item => {
                if (item.starred) return true;
                const itemDate = new Date(item.date).getTime();
                return !isNaN(itemDate) && (now - itemDate) <= retentionMs;
            });

            const { updated_at, ...payloadData } = obj;
            payloadData.items = filteredItems;
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
                    itemsById.set(item.id, item);
                }
            }

            // Then overwrite with items from the newer object. This handles updates.
            for (const item of newerObj.items) {
                if (item && item.id) {
                    itemsById.set(item.id, item);
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

                if (item) {
                    item.starred = !item.starred;
                    starIcon.classList.toggle('starred', item.starred);
                } else {
                    const feedItem = feedData.find(fItem => fItem.id === itemId);
                    const date = (feedItem && feedItem.date) ? feedItem.date : now;
                    item = { id: itemId, date, starred: true };
                    items.push(item);
                    starIcon.classList.add('starred');
                }
                meta.items = items;
                meta.updated_at = now;
                gistSync.setLocal(meta);
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

    const startupLogic = async () => {
        const feedContainer = document.getElementById('feed-container');
        const loadingOverlay = document.getElementById('loading-overlay');

        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        await gistSync.syncOnStartup();
        const meta = gistSync.getLocal();

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

        applyView(meta.items || []);

        const allDomIds = Array.from(document.querySelectorAll('#feed-container .feed-item')).map(el => el.dataset.itemId);
        const metaItemsById = new Map((meta.items || []).map(item => [item.id, item]));
        let changed = false;
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
