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

export function feedSnapshot(item) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.link !== 'string') return null;
    const snapshot = { id: item.id, link: item.link };
    for (const key of ['title', 'published', 'thumbnail', 'video_id', 'feed_title', 'description']) {
        if (typeof item[key] === 'string') snapshot[key] = item[key];
    }
    return snapshot;
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
    let changed = false;
    for (const snapshot of mergeFeedItems(items)) {
        let record = byId.get(snapshot.id);
        if (!record) {
            record = { id: snapshot.id, date: new Date().toISOString(), seen: false, starred: false };
            state.items.push(record);
            byId.set(record.id, record);
        }
        if (!record.tracked) {
            record.tracked = true;
            changed = true;
        }
        if (isSeenVersion(snapshot, record) && !record.starred) continue;
        const latest = mergeFeedItems([record.feed_item], [snapshot])[0];
        if (JSON.stringify(record.feed_item) !== JSON.stringify(latest)) {
            record.feed_item = latest;
            record.feed_item_updated_at = new Date().toISOString();
            changed = true;
        }
    }
    return changed;
}
