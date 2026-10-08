// Feed snapshots are separate from the publication version marked read.
export function isSeenVersion(item, itemMeta) {
    if (!itemMeta?.seen) return false;
    if (!item?.published) return true;
    const seenVersion = itemMeta.published || itemMeta.starred_changed_at || itemMeta.starredChangedAt || itemMeta.date;
    if (!seenVersion) return true;
    const currentPublished = Date.parse(item.published);
    const seenPublished = Date.parse(seenVersion);
    if (!Number.isFinite(currentPublished) || !Number.isFinite(seenPublished)) return true;
    return currentPublished <= seenPublished;
}

export function isUnreadVersion(item, itemMeta) {
    return !itemMeta?.starred && !isSeenVersion(item, itemMeta);
}

export function shouldShowInFeed(item, itemMeta) {
    return !!itemMeta?.starred || isUnreadVersion(item, itemMeta);
}

export function markFeedItemsRead(state, items, changedAt = new Date().toISOString()) {
    state.items = state.items || [];
    const byId = new Map(state.items.map(item => [item.id, item]));
    let changed = false;
    for (const item of items || []) {
        let record = byId.get(item.id);
        if (!isUnreadVersion(item, record)) continue;
        if (!record) {
            record = { id: item.id, date: changedAt, starred: false };
            state.items.push(record);
            byId.set(item.id, record);
        }
        record.tracked = true;
        record.seen = true;
        record.published = item.published;
        record.read_changed_at = changedAt;
        changed = true;
    }
    if (changed) state.updated_at = changedAt;
    return changed;
}

export function feedSnapshot(item) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.link !== 'string') return null;
    const snapshot = { id: item.id, link: item.link };
    for (const key of ['title', 'published', 'thumbnail', 'video_id', 'feed_title', 'description']) {
        if (typeof item[key] === 'string') snapshot[key] = item[key];
    }
    return snapshot;
}

const SNAPSHOT_KEYS = ['id', 'link', 'title', 'published', 'thumbnail', 'video_id', 'feed_title', 'description'];

function sameSnapshot(a, b) {
    if (!a || !b) return a === b;
    return SNAPSHOT_KEYS.every(key => a[key] === b[key]);
}

// Later sources win ties, but an older page must not replace a newer version.
export function mergeFeedItems(...sources) {
    const byId = new Map();
    for (const items of sources) {
        for (const item of items || []) {
            const snapshot = feedSnapshot(item);
            if (!snapshot) continue;
            const previous = byId.get(snapshot.id);
            if (!previous || (Date.parse(snapshot.published) || 0) >= (Date.parse(previous.published) || 0)) {
                byId.set(snapshot.id, snapshot);
            }
        }
    }
    return [...byId.values()].sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
}

// Never change read or star flags while remembering feed content.
export function rememberFeedItems(state, items) {
    state.items = state.items || [];
    const byId = new Map(state.items.map(item => [item.id, item]));
    const now = new Date().toISOString();
    let changed = false;
    for (const snapshot of mergeFeedItems(items)) {
        let record = byId.get(snapshot.id);
        if (!record) {
            record = { id: snapshot.id, date: now, seen: false, starred: false };
            state.items.push(record);
            byId.set(record.id, record);
        }
        if (!record.tracked) {
            record.tracked = true;
            changed = true;
        }
        if (isSeenVersion(snapshot, record) && !record.starred) continue;
        const previous = feedSnapshot(record.feed_item);
        const previousPublished = Date.parse(previous?.published) || 0;
        const currentPublished = Date.parse(snapshot.published) || 0;
        const latest = previous && previousPublished > currentPublished ? previous : snapshot;
        if (!sameSnapshot(previous, latest)) {
            record.feed_item = latest;
            record.feed_item_updated_at = now;
            changed = true;
        }
    }
    return changed;
}
