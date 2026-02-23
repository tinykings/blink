// GitHub Gist synchronization module

import { getRetentionDays, getTimeOrZero, sanitizeItemForStorage } from './storage.js';

const API_BASE = 'https://api.github.com/gists';
let pushTimeout = null;
const DEBOUNCE_MS = 1000;

let pendingPush = false;
let lastETag = null;
let lastKnownRemoteUpdatedAt = null;

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
 * Get local metadata from localStorage
 * @returns {Object} The local metadata object
 */
export function getLocal() {
    let raw = localStorage.getItem('blinkMeta');
    if (!raw) {
        const starred = JSON.parse(localStorage.getItem('starredItems') || '[]');
        const now = new Date().toISOString();
        return {
            items: starred.map(id => ({ id, date: now, starred: true, seen: true, starred_changed_at: now })),
            updated_at: null
        };
    }
    try {
        const data = JSON.parse(raw);
        if (!data.items) data.items = [];
        // Migration: ensure all items have the 'seen' field
        data.items.forEach(item => {
            if (item && item.seen === undefined) {
                item.seen = true;
            }
            if (item && !item.starred_changed_at && item.starredChangedAt) {
                item.starred_changed_at = item.starredChangedAt;
            }
            if (item && !item.starred_changed_at) {
                item.starred_changed_at = data.updated_at || item.date || new Date().toISOString();
            }
        });
        localStorage.setItem('starredItems', JSON.stringify((data.items || []).filter(item => item.starred).map(item => item.id)));
        return data;
    } catch {
        const starred = JSON.parse(localStorage.getItem('starredItems') || '[]');
        const now = new Date().toISOString();
        return {
            items: starred.map(id => ({ id, date: now, starred: true, seen: true, starred_changed_at: now })),
            updated_at: null
        };
    }
}

/**
 * Save metadata to localStorage
 * @param {Object} obj - The metadata object to save
 */
export function setLocal(obj) {
    localStorage.setItem('blinkMeta', JSON.stringify(obj));
    localStorage.setItem('starredItems', JSON.stringify((obj.items || []).filter(item => item.starred).map(item => item.id)));
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
    if (!res.ok) return null;
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
                const localTime = getTimeOrZero(localObj.updated_at);
                const remoteTime = getTimeOrZero(remoteObj.updated_at);
                const localWins = localTime >= remoteTime;
                if (localWins) {
                    existing.starred = !!item.starred;
                } else {
                    existing.starred = !!existing.starred;
                }
                existing.starred_changed_at = localWins
                    ? (localObj.updated_at || item.date || new Date().toISOString())
                    : (remoteObj.updated_at || existing.date || new Date().toISOString());
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
                // For non-starred, check if it should be kept
                const localChangeTime = getTimeOrZero(item.starred_changed_at || item.starredChangedAt || item.date || item.published);
                const isOld = (now - localChangeTime) > (retentionMs * 1.5); // Grace period

                if (!isOld) {
                    // If remote is newer, but this item isn't in it, it MIGHT have been deleted.
                    // However, it's safer to keep "seen" status locally for current feed items
                    // than to aggressively delete them and have them reappear as new.
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
            // Optimistic concurrency: check for remote changes before pushing
            const remote = await fetchRemote();
            if (remote && lastKnownRemoteUpdatedAt) {
                const remoteTime = getTimeOrZero(remote.updated_at);
                const knownTime = getTimeOrZero(lastKnownRemoteUpdatedAt);
                if (remoteTime > knownTime) {
                    // Remote changed since we last saw it — merge first
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

// Retry on reconnect and when tab becomes visible
window.addEventListener('online', retryPendingPush);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryPendingPush();
});

/**
 * Sync on application startup
 */
export async function syncOnStartup() {
    const cfg = getConfig();
    if (!cfg.gistId || !cfg.token) return;
    try {
        const remote = await fetchRemote();
        if (remote) {
            const local = getLocal();
            const resolved = merge(local, remote);
            setLocal(resolved);
            dispatchSyncEvent('success', 'Synced');
        }
    } catch (e) {
        console.warn('Sync on startup failed:', e);
        dispatchSyncEvent('error', 'Sync failed');
    }
}

/**
 * Schedule a push to remote soon
 */
export function pushSoon() {
    schedulePush();
}

/**
 * Pull from remote and merge with local
 * @returns {Promise<boolean>} Whether the pull was successful
 */
export async function pull() {
    const cfg = getConfig();
    if (!cfg.gistId || !cfg.token) return false;
    const remote = await fetchRemote();
    if (remote) {
        const local = getLocal();
        const resolved = merge(local, remote);
        setLocal(resolved);
        return true;
    }
    return false;
}

// Export sync object for compatibility
export const gistSync = {
    getLocal,
    setLocal,
    syncOnStartup,
    pushSoon,
    pull
};
