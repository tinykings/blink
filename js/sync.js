// GitHub Gist synchronization module

import { getRetentionDays, getTimeOrZero, sanitizeItemForStorage } from './storage.js';

const API_BASE = 'https://api.github.com/gists';
let pushTimeout = null;
const DEBOUNCE_MS = 1000;

let pendingPush = false;
let lastETag = null;
let lastKnownRemoteUpdatedAt = null;

let meta = null;

/**
 * Get Gist sync configuration from localStorage
 * @returns {{gistId: string|null, token: string|null}}
 */
function getConfig() {
    return {
        gistId: localStorage.getItem('GIST_ID'),
        token: localStorage.getItem('GITHUB_TOKEN')
    };
}

/**
 * Get current metadata (in-memory only)
 * @returns {Object} The metadata object
 */
export function getLocal() {
    return meta || { items: [], updated_at: null };
}

/**
 * Update metadata in memory
 * @param {Object} obj - The metadata object to store
 */
export function setLocal(obj) {
    meta = obj;
}

/**
 * Get metadata for UI to use
 * @returns {Object} Metadata for UI display
 */
export function getMeta() {
    return meta || { items: [], updated_at: null };
}

/**
 * Fetch remote metadata from GitHub Gist
 * @returns {Promise<Object|null>} The remote metadata or null (null also on 304)
 */
async function fetchRemote() {
    const { gistId, token } = getConfig();
    if (!gistId || !token) return null;
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' };
    if (lastETag) headers['If-None-Match'] = lastETag;
    const res = await fetch(`${API_BASE}/${gistId}`, { headers });
    if (res.status === 304) return null;
    if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
    const etag = res.headers.get('ETag');
    if (etag) lastETag = etag;
    const data = await res.json();
    const file = data.files && data.files['starred.json'];
    if (!file || !file.content) return null;
    try {
        const remoteData = JSON.parse(file.content);
        remoteData.updated_at = data.updated_at;
        lastKnownRemoteUpdatedAt = data.updated_at;
        return remoteData;
    } catch { return null; }
}

/**
 * Push metadata to GitHub Gist
 * @param {Object} obj - The metadata to push
 */
async function pushRemote(obj) {
    const { gistId, token } = getConfig();
    if (!gistId || !token) return;

    const now = Date.now();
    const retentionDays = getRetentionDays();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    const filteredItems = (obj.items || []).filter(item => {
        if (item.starred) return true;
        const starChangeTime = getTimeOrZero(item.starred_changed_at || item.starredChangedAt);
        if (starChangeTime && (now - starChangeTime) <= retentionMs) return true;
        const itemDate = getTimeOrZero(item.date);
        return itemDate && (now - itemDate) <= retentionMs;
    }).map(sanitizeItemForStorage).filter(Boolean);

    const payloadData = {
        ...obj,
        items: filteredItems
    };
    delete payloadData.updated_at;
    delete payloadData.seenItems;

    const payload = { files: { 'starred.json': { content: JSON.stringify(payloadData, null, 2) } } };
    const res = await fetch(`${API_BASE}/${gistId}`, {
        method: 'PATCH',
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        throw new Error(`Gist push failed: ${res.status}`);
    }
    const data = await res.json();
    if (data.updated_at) lastKnownRemoteUpdatedAt = data.updated_at;
    const etag = res.headers.get('ETag');
    if (etag) lastETag = etag;
}

/**
 * Force an immediate push to remote
 * @returns {Promise<void>}
 */
export async function upload() {
    if (pushTimeout) clearTimeout(pushTimeout);
    const local = getLocal();
    await pushRemote(local);
    pendingPush = false;
    dispatchSyncEvent('success', 'Synced');
}

/**
 * Merge local and remote metadata
 * @param {Object} localObj - Local metadata
 * @param {Object} remoteObj - Remote metadata
 * @returns {Object} Merged metadata
 */
function merge(localObj, remoteObj) {
    if (!remoteObj || !remoteObj.items) return localObj || { items: [], updated_at: null };
    if (!localObj || !localObj.items) return remoteObj;

    const mergedById = new Map();
    const now = Date.now();
    const retentionMs = getRetentionDays() * 24 * 60 * 60 * 1000;

    // Process remote items first
    for (const item of (remoteObj.items || [])) {
        if (item && item.id) {
            mergedById.set(item.id, { ...item });
        }
    }

    // Merge local items
    for (const item of (localObj.items || [])) {
        if (!item || !item.id) continue;
        const existing = mergedById.get(item.id);
        if (existing) {
            existing.seen = existing.seen || item.seen;

            const existingStarChangedAt = existing.starred_changed_at || existing.starredChangedAt;
            const itemStarChangedAt = item.starred_changed_at || item.starredChangedAt;
            const existingStarTime = getTimeOrZero(existingStarChangedAt);
            const itemStarTime = getTimeOrZero(itemStarChangedAt);

            if (existingStarTime === 0 && itemStarTime === 0) {
                existing.starred = !!existing.starred;
                existing.starred_changed_at = existing.date || new Date().toISOString();
            } else if (itemStarTime >= existingStarTime) {
                existing.starred = !!item.starred;
                existing.starred_changed_at = itemStarChangedAt || item.date || new Date().toISOString();
            } else {
                existing.starred = !!existing.starred;
                existing.starred_changed_at = existingStarChangedAt || existing.date || new Date().toISOString();
            }

            if (!existing.title && item.title) existing.title = item.title;
            if (!existing.url && item.url) existing.url = item.url;
            if (!existing.link && item.link) existing.link = item.link;
            if (!existing.published && item.published) existing.published = item.published;
            if (!existing.thumbnail && item.thumbnail) existing.thumbnail = item.thumbnail;
            if (!existing.video_id && item.video_id) existing.video_id = item.video_id;
            if (!existing.feed_title && item.feed_title) existing.feed_title = item.feed_title;
            if (item.date && existing.date) {
                const itemTime = new Date(item.date).getTime();
                const existingTime = new Date(existing.date).getTime();
                if (itemTime < existingTime) existing.date = item.date;
            } else if (item.date && !existing.date) {
                existing.date = item.date;
            }
        } else {
            // Item only exists locally
            if (item.starred) {
                mergedById.set(item.id, { ...item });
            } else {
                const localChangeTime = getTimeOrZero(item.starred_changed_at || item.starredChangedAt || item.date || item.published);
                const isOld = (now - localChangeTime) > (retentionMs * 1.5);

                if (!isOld) {
                    mergedById.set(item.id, { ...item });
                }
            }
        }
    }

    const localTime = localObj.updated_at ? new Date(localObj.updated_at).getTime() : 0;
    const remoteTime = remoteObj.updated_at ? new Date(remoteObj.updated_at).getTime() : 0;
    const updated_at = remoteTime > localTime ? remoteObj.updated_at : localObj.updated_at;

    return { items: Array.from(mergedById.values()), updated_at };
}

/**
 * Schedule a push to remote with debouncing
 */
function schedulePush() {
    if (pushTimeout) clearTimeout(pushTimeout);
    pushTimeout = setTimeout(async () => {
        try {
            const local = getLocal();
            const remote = await fetchRemote();
            if (remote && lastKnownRemoteUpdatedAt) {
                const remoteTime = getTimeOrZero(remote.updated_at);
                const knownTime = getTimeOrZero(lastKnownRemoteUpdatedAt);
                if (remoteTime > knownTime) {
                    const merged = merge(local, remote);
                    setLocal(merged);
                    await pushRemote(merged);
                    pendingPush = false;
                    dispatchSyncEvent('success', 'Synced');
                    return;
                }
            }
            await pushRemote(local);
            pendingPush = false;
            dispatchSyncEvent('success', 'Synced');
        } catch (e) {
            console.warn('Failed pushing to gist:', e);
            pendingPush = true;
            dispatchSyncEvent('error', 'Sync push failed');
        }
    }, DEBOUNCE_MS);
}

function dispatchSyncEvent(type, message) {
    window.dispatchEvent(new CustomEvent('blink-sync', { detail: { type, message } }));
}

/**
 * Retry pending push if we're online
 */
function retryPendingPush() {
    if (!pendingPush) return;
    const cfg = getConfig();
    if (!cfg.gistId || !cfg.token) return;
    schedulePush();
}

window.addEventListener('online', retryPendingPush);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryPendingPush();
});

/**
 * Sync on application startup - fetch from gist as source of truth
 * @returns {Promise<boolean>} Whether sync was successful
 */
export async function syncOnStartup() {
    const cfg = getConfig();
    if (!cfg.gistId || !cfg.token) return false;
    try {
        lastETag = null;
        const remote = await fetchRemote();
        if (remote) {
            meta = remote;
            dispatchSyncEvent('success', 'Synced');
            return true;
        } else {
            meta = { items: [], updated_at: null };
            dispatchSyncEvent('success', 'Up to date');
            return true;
        }
    } catch (e) {
        console.warn('Sync on startup failed:', e);
        dispatchSyncEvent('error', 'Gist unreachable');
        return false;
    }
}

/**
 * Schedule a push to remote soon
 */
export function pushSoon() {
    schedulePush();
}

/**
 * Pull from remote and update in-memory
 * @returns {Promise<boolean>} Whether pull was successful
 */
export async function pull() {
    const cfg = getConfig();
    if (!cfg.gistId || !cfg.token) return false;
    const remote = await fetchRemote();
    if (remote) {
        meta = remote;
        return true;
    }
    return false;
}

// Export sync object for compatibility
export const gistSync = {
    getLocal,
    setLocal,
    getMeta,
    syncOnStartup,
    pushSoon,
    pull
};
