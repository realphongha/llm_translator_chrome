// ─────────────────────────────────────────────
//  Translation Cache
//  Backed by chrome.storage.local with SHA-256 keys
// ─────────────────────────────────────────────

import { hashForCache } from "../utils/hashing";

const CACHE_PREFIX = "cache_";
const MAX_CACHE_ENTRIES = 10_000;
const CACHE_INDEX_KEY = "cache_index";

interface CacheEntry {
  translation: string;
  timestamp: number;
}

interface CacheIndex {
  keys: string[]; // ordered by insertion (oldest first)
}

async function getCacheIndex(): Promise<CacheIndex> {
  const result = await chrome.storage.local.get(CACHE_INDEX_KEY);
  return result[CACHE_INDEX_KEY] ?? { keys: [] };
}

async function saveCacheIndex(index: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
}

/**
 * Retrieves a cached translation, or null if not found.
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
  return entry?.translation ?? null;
}

/**
 * Stores a translation in cache with LRU eviction.
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

  // Update index for LRU eviction
  const index = await getCacheIndex();
  index.keys = index.keys.filter((k) => k !== key);
  index.keys.push(key);

  // Evict oldest entries if over limit
  if (index.keys.length > MAX_CACHE_ENTRIES) {
    const toEvict = index.keys.splice(0, index.keys.length - MAX_CACHE_ENTRIES);
    const keysToRemove = toEvict.map((k) => CACHE_PREFIX + k);
    await chrome.storage.local.remove(keysToRemove);
  }

  await saveCacheIndex(index);
}

/**
 * Clears the entire translation cache.
 */
export async function clearCache(): Promise<void> {
  const index = await getCacheIndex();
  const keysToRemove = index.keys.map((k) => CACHE_PREFIX + k);
  keysToRemove.push(CACHE_INDEX_KEY);
  await chrome.storage.local.remove(keysToRemove);
}

/**
 * Returns cache statistics.
 */
export async function getCacheStats(): Promise<{ count: number }> {
  const index = await getCacheIndex();
  return { count: index.keys.length };
}
