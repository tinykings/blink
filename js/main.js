document.addEventListener('DOMContentLoaded', () => {
    let feedData = null;

    // Function to generate HTML for a single feed item
    function generateItemHtml(item, itemId) {
        let thumbnailHtml = '';
        if (item.video_id) {
            thumbnailHtml = `<div class="video-container"><iframe src="https://www.youtube.com/embed/${item.video_id}" frameborder="0" allowfullscreen></iframe></div>`;
        } else if (item.thumbnail) {
            thumbnailHtml = `<a href="${item.link}" target="_blank"><img src="${item.thumbnail}" alt="${item.title}" class="feed-thumbnail"></a>`;
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
                ${thumbnailHtml}
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
        });
    }
});
