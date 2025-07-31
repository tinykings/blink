document.addEventListener('DOMContentLoaded', () => {
    // Reload icon logic
    const reloadIcon = document.getElementById('reload-icon');
    if (reloadIcon) {
        reloadIcon.addEventListener('click', () => {
            localStorage.removeItem('seenItemIds');
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
    let feedData = [];

    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
        } catch (e) {
            console.error("Error parsing feed data:", e);
            return;
        }
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

        let summaryHtml = '';
        if (item.summary) {
            summaryHtml = `
                <button class="toggle-summary-btn" data-target="summary-${itemId}">...</button>
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

    function renderFeed() {
        if (!feedContainer || !feedData.length) {
            return;
        }

        const seenItemIds = JSON.parse(localStorage.getItem('seenItemIds') || '[]');
        const newItems = feedData.filter(item => !seenItemIds.includes(item.id));
        const oldItems = feedData.filter(item => seenItemIds.includes(item.id));
        
        let html = '';

        // Render new items
        newItems.forEach((item, index) => {
            html += generateItemHtml(item, `new-${index}`);
        });

        // Render marker if there are new items and old items
        if (newItems.length > 0 && oldItems.length > 0) {
            html += '<div class="last-seen-marker">New items above</div>';
        }

        // Render old items
        oldItems.forEach((item, index) => {
            html += generateItemHtml(item, `old-${index}`);
        });

        feedContainer.innerHTML = html;
    }

    // Event delegation for all clicks
    if (feedContainer) {
        feedContainer.addEventListener('click', (e) => {
            // Handle summary toggling
            const toggleSummaryBtn = e.target.closest('.toggle-summary-btn');
            if (toggleSummaryBtn) {
                const targetId = toggleSummaryBtn.getAttribute('data-target');
                const summaryDiv = document.getElementById(targetId);
                if (summaryDiv) {
                    summaryDiv.style.display = summaryDiv.style.display === 'none' ? 'block' : 'none';
                }
                return;
            }

            // Handle video lazy loading
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

    renderFeed();

    // Update seen items for next visit
    const allItemIds = feedData.map(item => item.id);
    localStorage.setItem('seenItemIds', JSON.stringify(allItemIds));
});