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

        const actionsHtml = `
            <div class="feed-item-actions">
                <span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>
            </div>
        `;

        const leavingSoonHtml = item.leaving_soon ? '<p class="leaving-soon">⏰ Leaving soon</p>' : '';

        return `
            <div class="feed-item" data-item-id="${item.id}">
                ${mediaHtml}
                <div class="feed-item-info">
                    <h2><a href="${item.link}" target="_blank">${item.title}</a></h2>
                    <p class="published-date">${item.published}</p>
                    <p class="feed-title">${item.feed_title}</p>
                    ${leavingSoonHtml}
                    ${actionsHtml}
                </div>
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
            // Inject actions row if missing
            let actions = itemEl.querySelector('.feed-item-actions');
            if (!actions) {
                actions = document.createElement('div');
                actions.className = 'feed-item-actions';
                const info = itemEl.querySelector('.feed-item-info') || itemEl;
                info.appendChild(actions);
            }
            // Inject star icon if missing
            if (!actions.querySelector('.star-icon')) {
                const star = document.createElement('span');
                star.className = 'star-icon' + (starred.has(id) ? ' starred' : '');
                star.dataset.itemId = id;
                star.textContent = '★';
                actions.prepend(star);
            }
        });
        // Mark seen IDs
        const ids = Array.from(feedContainer.querySelectorAll('.feed-item'))
            .map(el => el.getAttribute('data-item-id'))
            .filter(Boolean);
        localStorage.setItem('seenItemIds', JSON.stringify(ids));
    } else {
        // Dynamic render path
        renderFeed();
        const allItemIds = feedData.map(item => item.id);
        localStorage.setItem('seenItemIds', JSON.stringify(allItemIds));
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
