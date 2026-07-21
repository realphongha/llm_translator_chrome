import { hashForCache } from "../utils/hashing";

const CACHE_PREFIX = "cache_";
const MAX_CACHE_ENTRIES = 10_000;
const CACHE_INDEX_KEY = "cache_index";

let maxCacheBytes = 7 * 1024 * 1024;

interface CacheEntry {
  translation: string;
  timestamp: number;
}

interface CacheIndex {
  keys: string[];
}

export function initCache(maxMb: number): void {
  maxCacheBytes = maxMb * 1024 * 1024;
}

async function getCacheIndex(): Promise<CacheIndex> {
  const result = await chrome.storage.local.get(CACHE_INDEX_KEY);
  return result[CACHE_INDEX_KEY] ?? { keys: [] };
}

async function saveCacheIndex(index: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
}

const _indexCache: { index: CacheIndex | null } = { index: null };

async function loadIndex(): Promise<CacheIndex> {
  if (!_indexCache.index) {
    _indexCache.index = await getCacheIndex();
  }
  return _indexCache.index!;
}

function dropIndexCache(): void {
  _indexCache.index = null;
}

// ── Debounced index save ────────────────────────
// Aggregates sequential index writes and flushes once, so rapid calls
// (e.g. during batch translation) don't hammer chrome.storage.

let _indexSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIndexSave(): void {
  if (_indexSaveTimer) return;
  _indexSaveTimer = setTimeout(async () => {
    _indexSaveTimer = null;
    if (_indexCache.index) {
      await saveCacheIndex(_indexCache.index);
    }
  }, 500);
}

/**
 * Retrieves a cached translation, or null if not found.
 * On hit, promotes the key to most-recently-used (true LRU).
 */
export async function getCached(
  systemPrompt: string,
  model: string,
  text: string
): Promise<string | null> {
  const key = await hashForCache(systemPrompt, model, text);
  const storageKey = CACHE_PREFIX + key;
  const result = await chrome.storage.local.get(storageKey);
  const entry = result[storageKey] as CacheEntry | undefined;

  if (!entry) return null;

  // Promote to most-recently-used (true LRU)
  const index = await loadIndex();
  const pos = index.keys.indexOf(key);
  if (pos !== -1) {
    index.keys.splice(pos, 1);
    index.keys.push(key);
    scheduleIndexSave();
  }

  return entry.translation;
}

/**
 * Stores a translation in cache with LRU eviction.
 * Evicts oldest entries when total cache size exceeds maxCacheBytes.
 */
export async function setCached(
  systemPrompt: string,
  model: string,
  text: string,
  translation: string
): Promise<void> {
  const key = await hashForCache(systemPrompt, model, text);
  const storageKey = CACHE_PREFIX + key;

  const entry: CacheEntry = {
    translation,
    timestamp: Date.now(),
  };

  await chrome.storage.local.set({ [storageKey]: entry });

  // Update index (move to end = most recently used)
  const index = await loadIndex();
  const alreadyExists = index.keys.indexOf(key);
  if (alreadyExists !== -1) {
    index.keys.splice(alreadyExists, 1);
  }
  index.keys.push(key);

  // Safety floor: evict by entry count if over hard limit
  if (index.keys.length > MAX_CACHE_ENTRIES) {
    const toEvict = index.keys.splice(0, index.keys.length - MAX_CACHE_ENTRIES);
    const keysToRemove = toEvict.map((k) => CACHE_PREFIX + k);
    await chrome.storage.local.remove(keysToRemove);
  }

  // Evict by byte size: use a single getBytesInUse call and estimate
  // per-entry size by average to avoid N+1 storage queries.
  if (index.keys.length > 0) {
    const cacheStorageKeys = index.keys.map((k) => CACHE_PREFIX + k);
    const bytesInUse = await chrome.storage.local.getBytesInUse(cacheStorageKeys);
    if (bytesInUse > maxCacheBytes) {
      const avgBytesPerEntry = Math.max(1, Math.round(bytesInUse / index.keys.length));
      const toFree = bytesInUse - maxCacheBytes;
      const toRemoveCount = Math.min(index.keys.length, Math.ceil(toFree / avgBytesPerEntry));
      if (toRemoveCount > 0) {
        const toEvict = index.keys.splice(0, toRemoveCount);
        await chrome.storage.local.remove(toEvict.map((k) => CACHE_PREFIX + k));
      }
    }
  }

  scheduleIndexSave();
}

/**
 * Clears the entire translation cache.
 */
export async function clearCache(): Promise<void> {
  if (_indexSaveTimer) {
    clearTimeout(_indexSaveTimer);
    _indexSaveTimer = null;
  }
  const index = await loadIndex();
  const keysToRemove = index.keys.map((k) => CACHE_PREFIX + k);
  keysToRemove.push(CACHE_INDEX_KEY);
  await chrome.storage.local.remove(keysToRemove);
  dropIndexCache();
}

/**
 * Returns cache statistics.
 */
export async function getCacheStats(): Promise<{ count: number; bytes: number }> {
  const index = await loadIndex();
  const storageKeys = index.keys.map((k) => CACHE_PREFIX + k);
  const bytes = storageKeys.length > 0 ? await chrome.storage.local.getBytesInUse(storageKeys) : 0;
  return { count: index.keys.length, bytes };
}
