// ─────────────────────────────────────────────
//  Translation Cache
//  Backed by chrome.storage.local with SHA-256 keys
//  True LRU eviction + MB-based size limit
// ─────────────────────────────────────────────

import { hashForCache } from "../utils/hashing";

const CACHE_PREFIX = "cache_";
const MAX_CACHE_ENTRIES = 10_000;
const CACHE_INDEX_KEY = "cache_index";

let maxCacheBytes = 7 * 1024 * 1024; // default 7MB

interface CacheEntry {
  translation: string;
  timestamp: number;
}

interface CacheIndex {
  keys: string[]; // ordered by use (most recently used at end)
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
    // Fire-and-forget index save (non-blocking)
    saveCacheIndex(index).catch(() => {});
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

  // Evict by byte size: check total cache storage and evict oldest until under limit
  const cacheStorageKeys = index.keys.map((k) => CACHE_PREFIX + k);
  const bytesInUse = await chrome.storage.local.getBytesInUse(cacheStorageKeys);
  if (bytesInUse > maxCacheBytes) {
    const toRemove: string[] = [];
    let freed = 0;
    for (const k of index.keys) {
      if (bytesInUse - freed <= maxCacheBytes) break;
      const sk = CACHE_PREFIX + k;
      const entryBytes = await chrome.storage.local.getBytesInUse(sk);
      toRemove.push(sk);
      freed += entryBytes;
    }
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      index.keys = index.keys.slice(toRemove.length);
    }
  }

  await saveCacheIndex(index);
}

/**
 * Clears the entire translation cache.
 */
export async function clearCache(): Promise<void> {
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
