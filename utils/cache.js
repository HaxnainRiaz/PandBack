const cache = globalThis.__pandaApiCache || new Map();
globalThis.__pandaApiCache = cache;

function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCache(key, value, ttlSeconds = 60) {
    cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return value;
}

function invalidateCache(prefix) {
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
}

module.exports = { getCache, setCache, invalidateCache };
