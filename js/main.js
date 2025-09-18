document.addEventListener('DOMContentLoaded', () => {
    // Settings modal logic
    const settingsIcon = document.getElementById('settings-icon');
    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');
    const gistIdInput = document.getElementById('gist-id');
    const githubTokenInput = document.getElementById('github-token');
    const settingsCancel = document.getElementById('settings-cancel');

    function openSettingsModal() {
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
        settingsForm.addEventListener('submit', function(e) {
            e.preventDefault();
            localStorage.setItem('GIST_ID', gistIdInput.value.trim());
            localStorage.setItem('GITHUB_TOKEN', githubTokenInput.value.trim());
            closeSettingsModal();
        });
    }
    if (settingsModal) {
        settingsModal.addEventListener('click', function(e) {
            if (e.target === settingsModal) closeSettingsModal();
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
            const filteredItems = (obj.items || []).filter(item => {
                if (item.starred) return true;
                const itemDate = new Date(item.date).getTime();
                return !isNaN(itemDate) && (now - itemDate) <= 6 * 24 * 60 * 60 * 1000;
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
                const local = getLocal();
                if (!remote) {
                    try { await pushRemote(local); } catch (e) { console.warn('Push remote failed (startup):', e); }
                    return;
                }
                const resolved = merge(local, remote);
                setLocal(resolved);
            },
            pushSoon: schedulePush
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
                    const iframe = document.createElement('iframe');
                    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
                    iframe.frameBorder = '0';
                    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
                    iframe.allowFullscreen = true;
                    iframe.className = 'video-iframe';
                    videoPlaceholder.innerHTML = '';
                    videoPlaceholder.appendChild(iframe);
                    videoPlaceholder.classList.add('video-loaded');
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
    };

    startupLogic();

    document.querySelectorAll('img.feed-thumbnail, img.video-thumbnail').forEach(img => {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer-when-downgrade';
    });
});
