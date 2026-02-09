// Local storage utilities module

let cachedRetentionDays = null;

/**
 * Get the retention period in days from the page
 * @returns {number} The retention period in days
 */
export function getRetentionDays() {
    if (cachedRetentionDays !== null) {
        return cachedRetentionDays;
    }
    const footerBar = document.querySelector('.footer-bar');
    if (footerBar) {
        const parsed = parseInt(footerBar.dataset.retentionDays, 10);
        if (!Number.isNaN(parsed)) {
            cachedRetentionDays = parsed;
            return cachedRetentionDays;
        }
    }
    cachedRetentionDays = 2;
    return cachedRetentionDays;
}

/**
 * Get starred items from localStorage
 * @returns {string[]} Array of starred item IDs
 */
export function getStarredItems() {
    return JSON.parse(localStorage.getItem('starredItems') || '[]');
}

/**
 * Escape an item ID for use in CSS selectors
 * @param {string} itemId - The item ID to escape
 * @returns {string} The escaped item ID
 */
export function escapeItemId(itemId) {
    if (window.CSS && CSS.escape) {
        return CSS.escape(itemId);
    }
    return itemId.replace(/"/g, '\\"');
}

/**
 * Safe URL protocols for archive links
 */
const SAFE_ARCHIVE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validate and return a safe archive URL
 * @param {string} rawUrl - The URL to validate
 * @returns {string} The safe URL or empty string
 */
export function getSafeArchiveUrl(rawUrl) {
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

/**
 * Get timestamp from a value, returning 0 if invalid
 * @param {*} v - The value to parse
 * @returns {number} The timestamp or 0
 */
export function getTimeOrZero(v) {
    if (!v) return 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
}

/**
 * Sanitize an item for storage, keeping only necessary fields
 * @param {Object} item - The item to sanitize
 * @returns {Object|null} The sanitized item or null
 */
export function sanitizeItemForStorage(item) {
    if (!item || !item.id) return null;
    const minimal = {
        id: item.id,
        date: item.date || new Date().toISOString(),
        starred: !!item.starred,
        seen: !!item.seen
    };
    if (item.starred_changed_at) minimal.starred_changed_at = item.starred_changed_at;
    if (!minimal.starred_changed_at && item.starredChangedAt) minimal.starred_changed_at = item.starredChangedAt;
    if (item.title) minimal.title = item.title;
    if (item.url || item.link) minimal.url = item.url || item.link;
    if (item.published) minimal.published = item.published;
    return minimal;
}
