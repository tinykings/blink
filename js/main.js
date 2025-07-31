'''document.addEventListener('DOMContentLoaded', () => {
    const reloadIcon = document.getElementById('reload-icon');
    if (reloadIcon) {
        reloadIcon.addEventListener('click', () => {
            // Clear last seen item on reload
            localStorage.removeItem('lastSeenItemId');
            window.location.reload();
        });
    }

    const feedContainer = document.getElementById('feed-container');
    let feedData = [];
    let lastSeenItemId = localStorage.getItem('lastSeenItemId');
    let observer;

    // Load feed data from the embedded JSON
    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        try {
            feedData = JSON.parse(feedDataElement.textContent);
        } catch (e) {
            console.error("Error parsing feed data:", e);
        }
    }

    function renderFeed() {
        if (!feedContainer || !feedData.length) {
            return;
        }

        let html = '';
        let lastSeenMarkerInserted = false;

        feedData.forEach((item, index) => {
            const itemId = item.id;

            // Insert "last seen" marker
            if (lastSeenItemId && itemId === lastSeenItemId && !lastSeenMarkerInserted) {
                html += '<div class="last-seen-marker">New items above</div>';
                lastSeenMarkerInserted = true;
            }

            html += generateItemHtml(item, index.toString());
        });

        feedContainer.innerHTML = html;
        setupIntersectionObserver();
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

    function setupIntersectionObserver() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.5 // Trigger when 50% of the item is visible
        };

        observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const itemId = entry.target.getAttribute('data-item-id');
                    if (itemId) {
                        lastSeenItemId = itemId;
                        localStorage.setItem('lastSeenItemId', itemId);
                    }
                }
            });
        }, options);

        const feedItems = document.querySelectorAll('.feed-item');
        feedItems.forEach(item => observer.observe(item));
    }

    if (feedContainer) {
        feedContainer.addEventListener('click', (e) => {
            const toggleSummaryBtn = e.target.closest('.toggle-summary-btn');
            if (toggleSummaryBtn) {
                const targetId = toggleSummaryBtn.getAttribute('data-target');
                const summaryDiv = document.getElementById(targetId);
                if (summaryDiv) {
                    summaryDiv.style.display = summaryDiv.style.display === 'none' ? 'block' : 'none';
                }
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

    renderFeed();
});
''
