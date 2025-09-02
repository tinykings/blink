document.addEventListener('DOMContentLoaded', () => {
    const feedContainer = document.getElementById('feed-container');
    const topIcon = document.getElementById('top-icon');
    const starToggle = document.getElementById('star-toggle');
    const refreshIcon = document.getElementById('refresh-icon');
    let feedData = [];
    let showingStarred = false;

    // Feed rendering and "new items" logic
    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
        } catch (e) {
            console.error("Error parsing feed data:", e);
            return;
        }
    }

    function getStarredItems() {
        return JSON.parse(localStorage.getItem('starredItems') || '[]');
    }

    /* === BEGIN: Gist-based cross-device starred sync helper === */
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

        function promptForConfig() {
            const gistId = prompt('Enter your GIST ID to sync starred items (leave blank to disable sync):', localStorage.getItem('GIST_ID') || '');
            if (gistId) localStorage.setItem('GIST_ID', gistId.trim());
            const token = prompt('Enter your GitHub personal access token (gist scope) to allow sync (stored locally):', localStorage.getItem('GITHUB_TOKEN') || '');
            if (token) localStorage.setItem('GITHUB_TOKEN', token.trim());
        }

        function getLocal() {
            const raw = localStorage.getItem('starredMeta');
            if (!raw) return { items: getStarredItems(), updated_at: null };
            try { return JSON.parse(raw); } catch { return { items: getStarredItems(), updated_at: null }; }
        }

        function setLocal(obj) {
            localStorage.setItem('starredMeta', JSON.stringify(obj));
            localStorage.setItem('starredItems', JSON.stringify(obj.items || []));
        }

        async function fetchRemote() {
            const { gistId, token } = getConfig();
            if (!gistId || !token) return null;
            const res = await fetch(`${API_BASE}/${gistId}`, {
                headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
            });
            if (!res.ok) return null;
            const data = await res.json();
            const file = data.files && data.files['starred.json'];
            if (!file || !file.content) return null;
            try { return JSON.parse(file.content); } catch { return null; }
        }

        async function pushRemote(obj) {
            const { gistId, token } = getConfig();
            if (!gistId || !token) return;
            const payload = { files: { 'starred.json': { content: JSON.stringify(obj, null, 2) } } };
            await fetch(`${API_BASE}/${gistId}`, {
                method: 'PATCH',
                headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        // merge strategy: union of item ids, keep updated_at = now
        function merge(localObj, remoteObj) {
            const set = new Set([...(localObj.items || []), ...(remoteObj?.items || [])]);
            return { items: Array.from(set), updated_at: new Date().toISOString() };
        }

        function schedulePush() {
            if (pushTimeout) clearTimeout(pushTimeout);
            pushTimeout = setTimeout(async () => {
                const local = getLocal();
                try {
                    await pushRemote(local);
                    // ignore result; best-effort
                } catch (e) { console.warn('Failed pushing starred gist:', e); }
            }, DEBOUNCE_MS);
        }

        return {
            promptIfMissing: () => {
                const cfg = getConfig();
                if (!cfg.gistId || !cfg.token) promptForConfig();
            },
            syncOnStartup: async () => {
                const cfg = getConfig();
                if (!cfg.gistId || !cfg.token) return;
                const remote = await fetchRemote();
                const local = getLocal();
                if (!remote) {
                    // if remote missing, push local (create file must exist in gist)
                    try { await pushRemote(local); } catch (e) { console.warn('Push remote failed (startup):', e); }
                    return;
                }
                const merged = merge(local, remote);
                setLocal(merged);
            },
            pushSoon: schedulePush
        };
    })();
    /* === END gistSync helper === */

    function generateItemHtml(item) {
        let mediaHtml = '';
        if (item.video_id) {
            const thumbnailUrl = `https://img.youtube.com/vi/${item.video_id}/hqdefault.jpg`;
            mediaHtml = `
                <div class="video-placeholder" data-video-id="${item.video_id}">
                    <img src="${thumbnailUrl}" alt="Video Thumbnail" class="video-thumbnail">
                    <div class="play-button"></div>
                </div>
            `;
        } else if (item.thumbnail) {
            mediaHtml = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="${item.title}" class="feed-thumbnail"></a>`;
        }

        const starredItems = getStarredItems();
        const isStarred = starredItems.includes(item.id);

        // If item is leaving soon, replace the star with the leaving-soon icon
        const starHtml = item.leaving_soon
            ? '<span class="leaving-soon-icon" title="one day left, leaving tomorrow" aria-label="one day left, leaving tomorrow" role="img">⏰</span>'
            : `<span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>`;

        // No separate bottom-right indicator anymore; icon now lives in star slot
        const leavingSoonIconHtml = '';

        return `
            <div class="feed-item" data-item-id="${item.id}">
                ${starHtml}
                ${mediaHtml}
                <div class="feed-item-info">
                    <h2><a href="${item.link}" target="_blank">${item.title}</a></h2>
                </div>
                ${leavingSoonIconHtml}
            </div>
        `;
    }

    function renderFeed(filter = 'all') {
        if (!feedContainer) return;

        if (feedData.length) {
            const seenItemIds = JSON.parse(localStorage.getItem('seenItemIds') || '[]');
            const starredItems = getStarredItems();

            let itemsToRender = feedData;
            if (filter === 'starred') {
                itemsToRender = feedData.filter(item => starredItems.includes(item.id));
            }

            const newItems = itemsToRender.filter(item => !seenItemIds.includes(item.id));
            const oldItems = itemsToRender.filter(item => seenItemIds.includes(item.id));

            let html = '';

            newItems.forEach((item) => { html += generateItemHtml(item); });
            if (newItems.length > 0 && oldItems.length > 0) {
                html += '<div class="last-seen-marker">^ New ^</div>';
            }
            oldItems.forEach((item) => { html += generateItemHtml(item); });

            feedContainer.innerHTML = html;
        } else {
            // Static DOM mode: toggle visibility based on starred items
            const starredItems = getStarredItems();
            const items = Array.from(feedContainer.querySelectorAll('.feed-item'));
            if (filter === 'starred') {
                items.forEach(el => {
                    const id = el.getAttribute('data-item-id');
                    el.style.display = starredItems.includes(id) ? '' : 'none';
                });
            } else {
                items.forEach(el => { el.style.display = ''; });
            }
        }
    }

    if (feedContainer) {
        feedContainer.addEventListener('click', (e) => {
            const starIcon = e.target.closest('.star-icon');
            if (starIcon) {
                const itemId = starIcon.getAttribute('data-item-id');
                let starredItems = getStarredItems();
                if (starredItems.includes(itemId)) {
                    starredItems = starredItems.filter(id => id !== itemId);
                    starIcon.classList.remove('starred');
                } else {
                    starredItems.push(itemId);
                    starIcon.classList.add('starred');
                }
                localStorage.setItem('starredItems', JSON.stringify(starredItems));
                // keep metadata in sync and schedule push to gist
                const meta = { items: starredItems, updated_at: new Date().toISOString() };
                localStorage.setItem('starredMeta', JSON.stringify(meta));
                gistSync.pushSoon();
                return;
            }
            
            const videoPlaceholder = e.target.closest('.video-placeholder');
            if (videoPlaceholder && !videoPlaceholder.classList.contains('video-loaded')) {
                const videoId = videoPlaceholder.getAttribute('data-video-id');
                if (videoId) {
                    const iframe = document.createElement('iframe');
                    iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}?autoplay=1`);
                    iframe.setAttribute('frameborder', '0');
                    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                    iframe.setAttribute('allowfullscreen', '');
                    iframe.classList.add('video-iframe');
                    
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

    if (topIcon) {
        topIcon.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (refreshIcon) {
        refreshIcon.addEventListener('click', () => {
            window.location.reload();
        });
    }

    // Enhance static DOM if needed: add star icons and lazy-loading
    if (feedContainer && !feedData.length) {
        const starred = new Set(getStarredItems());
        feedContainer.querySelectorAll('.feed-item').forEach(itemEl => {
            const id = itemEl.getAttribute('data-item-id');
            // Inject star icon as a floating tab if missing
            if (!itemEl.querySelector('.star-icon')) {
                const star = document.createElement('span');
                star.className = 'star-icon' + (starred.has(id) ? ' starred' : '');
                star.dataset.itemId = id;
                star.textContent = '★';
                itemEl.prepend(star);
            }
        });
        // Mark seen IDs
        const ids = Array.from(feedContainer.querySelectorAll('.feed-item'))
            .map(el => el.getAttribute('data-item-id'))
            .filter(Boolean);
        localStorage.setItem('seenItemIds', JSON.stringify(ids));
    } else {
        // Dynamic render path with startup gist sync
        (async () => {
            gistSync.promptIfMissing();
            await gistSync.syncOnStartup();
            renderFeed();
            const allItemIds = feedData.map(item => item.id);
            localStorage.setItem('seenItemIds', JSON.stringify(allItemIds));
        })();
    }

    // Progressive image hints
    document.querySelectorAll('img.feed-thumbnail, img.video-thumbnail').forEach(img => {
        img.loading = img.loading || 'lazy';
        img.decoding = img.decoding || 'async';
        img.referrerPolicy = img.referrerPolicy || 'no-referrer-when-downgrade';
    });

});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
