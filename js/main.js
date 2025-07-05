document.addEventListener('DOMContentLoaded', () => {
    let feedData = null;

    const profileLink = document.getElementById('profile-link');
    const blinkText = document.getElementById('blink-text');

    if (profileLink && blinkText) {
        profileLink.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent immediate navigation
            blinkText.style.display = 'block'; // Show BLINK text
            setTimeout(() => {
                window.location.href = 'index.html'; // Redirect after a delay
            }, 1000); // 1 second delay
        });
    }

    // Function to generate HTML for a single feed item
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
            <div class="feed-item">
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

    // Load feed data from the embedded JSON
    const feedDataElement = document.getElementById('feed-data');
    if (feedDataElement) {
        feedData = JSON.parse(feedDataElement.textContent);
    }

    // Event delegation for all clicks in the feed container
    const feedContainer = document.getElementById('feed-container');
    if (feedContainer) {
        feedContainer.addEventListener('click', (e) => {
            const dayHeader = e.target.closest('.day-header');
            const toggleSummaryBtn = e.target.closest('.toggle-summary-btn');

            // Handle day toggling
            if (dayHeader) {
                const button = dayHeader.querySelector('.toggle-day-btn');
                const targetId = button.getAttribute('data-target');
                const contentDiv = document.getElementById(targetId);

                if (contentDiv) {
                    const isHidden = contentDiv.style.display === 'none';
                    contentDiv.style.display = isHidden ? 'block' : 'none';
                    button.textContent = isHidden ? '-' : '+';

                    // If expanding and content is not loaded yet
                    if (isHidden && !contentDiv.innerHTML.trim() && feedData) {
                        const date = dayHeader.getAttribute('data-date');
                        if (date && feedData[date]) {
                            let itemsHtml = '';
                            feedData[date].forEach((item, index) => {
                                const itemId = `${date}-${index}`;
                                itemsHtml += generateItemHtml(item, itemId);
                            });
                            contentDiv.innerHTML = itemsHtml;
                        }
                    }
                }
            }

            // Handle summary toggling
            if (toggleSummaryBtn) {
                const targetId = toggleSummaryBtn.getAttribute('data-target');
                const summaryDiv = document.getElementById(targetId);
                if (summaryDiv) {
                    summaryDiv.style.display = summaryDiv.style.display === 'none' ? 'block' : 'none';
                }
            }
        // Handle video lazy loading
            const videoPlaceholder = e.target.closest('.video-placeholder');
            if (videoPlaceholder) {
                const videoId = videoPlaceholder.getAttribute('data-video-id');
                if (videoId) {
                    const iframe = document.createElement('iframe');
                    iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}?autoplay=1`);
                    iframe.setAttribute('frameborder', '0');
                    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                    iframe.setAttribute('allowfullscreen', '');
                    iframe.classList.add('video-iframe'); // Add a class for styling if needed
                    videoPlaceholder.innerHTML = ''; // Clear the thumbnail and play button
                    videoPlaceholder.appendChild(iframe);
                    videoPlaceholder.classList.add('video-loaded'); // Add a class to indicate video is loaded
                }
            }
        });
    }
});
