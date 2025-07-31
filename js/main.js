document.addEventListener('DOMContentLoaded', () => {
    // Reload icon logic
    const reloadIcon = document.getElementById('reload-icon');
    if (reloadIcon) {
        reloadIcon.addEventListener('click', () => {
            localStorage.removeItem('seenItemIds');
            localStorage.removeItem('starredItems');
            window.location.reload();
        });
    }

    // Profile link logic
    const profileLink = document.getElementById('profile-link');
    const blinkText = document.getElementById('blink-text');
    if (profileLink && blinkText) {
        profileLink.addEventListener('click', (e) => {
            e.preventDefault();
            blinkText.style.display = 'block';
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        });
    }

    // Feed rendering and "new items" logic
    const feedContainer = document.getElementById('feed-container');
    const showStarredBtn = document.getElementById('show-starred-btn');
    let feedData = [];
    let showingStarred = false;

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

    function generateItemHtml(item, itemId) {
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

        let summaryHtml = '';
        if (item.summary) {
            summaryHtml = `
            <div class="feed-item-actions">
                <span class="star-icon ${isStarred ? 'starred' : ''}" data-item-id="${item.id}">★</span>
                <button class="toggle-summary-btn" data-target="summary-${itemId}">...</button>
            </div>
            <div id="summary-${itemId}" class="summary" style="display: none;">${item.summary}</div>
            `;
        }



        return `
            <div class="feed-item" data-item-id="${item.id}">
                ${mediaHtml}
                <div class="feed-item-info">
                    <h2><a href="${item.link}" target="_blank">${item.title}</a></h2>
                    <p class="published-date">${item.published}</p>
                    <p class="feed-title">${item.feed_title}</p>
                    ${summaryHtml}
                </div>
            </div>
        `;
    }

    function renderFeed(filter = 'all') {
        if (!feedContainer || !feedData.length) {
            return;
        }

        const seenItemIds = JSON.parse(localStorage.getItem('seenItemIds') || '[]');
        const starredItems = getStarredItems();

        let itemsToRender = feedData;
        if (filter === 'starred') {
            itemsToRender = feedData.filter(item => starredItems.includes(item.id));
        }

        const newItems = itemsToRender.filter(item => !seenItemIds.includes(item.id));
        const oldItems = itemsToRender.filter(item => seenItemIds.includes(item.id));

        let html = '';

        newItems.forEach((item, index) => {
            html += generateItemHtml(item, `new-${index}`);
        });

        if (newItems.length > 0 && oldItems.length > 0) {
            html += '<div class="last-seen-marker">^ New ^</div>';
        }

        oldItems.forEach((item, index) => {
            html += generateItemHtml(item, `old-${index}`);
        });

        feedContainer.innerHTML = html;
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
            
            const toggleSummaryBtn = e.target.closest('.toggle-summary-btn');
            if (toggleSummaryBtn) {
                const targetId = toggleSummaryBtn.getAttribute('data-target');
                const summaryDiv = document.getElementById(targetId);
                if (summaryDiv) {
                    summaryDiv.style.display = summaryDiv.style.display === 'none' ? 'block' : 'none';
                }
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

    if (showStarredBtn) {
        showStarredBtn.addEventListener('click', () => {
            showingStarred = !showingStarred;
            if (showingStarred) {
                renderFeed('starred');
                showStarredBtn.textContent = 'Show All';
            } else {
                renderFeed('all');
                showStarredBtn.textContent = 'Show Starred';
            }
        });
    }

    renderFeed();

    const allItemIds = feedData.map(item => item.id);
    localStorage.setItem('seenItemIds', JSON.stringify(allItemIds));
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
