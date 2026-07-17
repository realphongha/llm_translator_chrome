// ─────────────────────────────────────────────
//  Translation Queue & Parallel Worker Pool
// ─────────────────────────────────────────────

import { callChatCompletions, ApiError } from "./api";
import { getCached, setCached } from "./cache";
import { buildBatches } from "../utils/batching";
import { buildUserPrompt } from "../prompts/builtins";
import { parseTranslationResponse, mergeSplitTranslations } from "../utils/parser";
import type { ApiConfig, TranslationConfig } from "../storage/config";

// ── Types ─────────────────────────────────────

export type TranslationState =
  | "waiting"
  | "translating"
  | "translated"
  | "error";

export interface QueueItem {
  id: number;
  text: string;
  /** Chrome tab ID that owns this item */
  tabId: number;
  /** Element index within the tab (for the content script to match) */
  elementIndex: number;
}

export interface TranslationResult {
  elementIndex: number;
  translation: string;
  state: TranslationState;
  error?: string;
}

export interface BatchJob {
  items: QueueItem[];
  systemPrompt: string;
  apiConfig: ApiConfig;
  translationConfig: TranslationConfig;
  retryCount: number;
}

// ── Queue state (per tab) ─────────────────────

interface TabQueue {
  items: QueueItem[];
  paused: boolean;
  processing: boolean;
}

const tabQueues = new Map<number, TabQueue>();
let queueIdCounter = 0;

// ── Event callbacks ───────────────────────────

type ResultCallback = (tabId: number, results: TranslationResult[]) => void;
type QueueChangedCallback = (tabId: number, count: number) => void;

const resultCallbacks: ResultCallback[] = [];
const queueChangedCallbacks: QueueChangedCallback[] = [];

export function onResults(cb: ResultCallback): void {
  resultCallbacks.push(cb);
}

export function onQueueChanged(cb: QueueChangedCallback): void {
  queueChangedCallbacks.push(cb);
}

function emitResults(tabId: number, results: TranslationResult[]): void {
  for (const cb of resultCallbacks) cb(tabId, results);
}

function emitQueueChanged(tabId: number, count: number): void {
  for (const cb of queueChangedCallbacks) cb(tabId, count);
}

// ── Queue management ──────────────────────────

export function enqueue(
  tabId: number,
  items: Array<{ text: string; elementIndex: number }>
): void {
  let queue = tabQueues.get(tabId);
  if (!queue) {
    queue = { items: [], paused: false, processing: false };
    tabQueues.set(tabId, queue);
  }

  for (const item of items) {
    queue.items.push({
      id: ++queueIdCounter,
      text: item.text,
      tabId,
      elementIndex: item.elementIndex,
    });
  }

  emitQueueChanged(tabId, queue.items.length);
}

export function clearQueue(tabId: number): void {
  const queue = tabQueues.get(tabId);
  if (queue) {
    queue.items = [];
    emitQueueChanged(tabId, 0);
  }
}

export function pauseQueue(tabId: number): void {
  const queue = tabQueues.get(tabId);
  if (queue) queue.paused = true;
}

export function resumeQueue(tabId: number): void {
  const queue = tabQueues.get(tabId);
  if (queue) {
    queue.paused = false;
  }
}

export function getQueueCount(tabId: number): number {
  return tabQueues.get(tabId)?.items.length ?? 0;
}

export function isPaused(tabId: number): boolean {
  return tabQueues.get(tabId)?.paused ?? false;
}

// ── Worker pool ───────────────────────────────

/**
 * Processes a single batch job with retry logic.
 * Returns a map of elementIndex → translation.
 */
async function processBatch(
  job: BatchJob
): Promise<TranslationResult[]> {
  const { items, systemPrompt, apiConfig, translationConfig } = job;

  const paragraphs = items.map((item) => ({
    id: item.elementIndex,
    text: item.text,
  }));

  const { batches, splitMap } = buildBatches(paragraphs, translationConfig.maxChars);
  const allTranslations = new Map<number, string>();

  for (const batch of batches) {
    const userPrompt = buildUserPrompt(batch.paragraphs);

    let lastError: Error | null = null;
    let success = false;

    for (let attempt = 0; attempt <= job.retryCount; attempt++) {
      try {
        const response = await callChatCompletions(
          systemPrompt,
          userPrompt,
          apiConfig
        );

        const parsed = parseTranslationResponse(response);
        for (const [id, translation] of parsed) {
          allTranslations.set(id, translation);
        }
        success = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof ApiError && err.type === "http_error" && err.status === 401) {
          break; // Don't retry auth errors
        }
        if (attempt < job.retryCount) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    if (!success) {
      // Return error results for all items in this batch
      return batch.paragraphs.map((p) => ({
        elementIndex: p.id,
        translation: "",
        state: "error" as TranslationState,
        error: lastError?.message ?? "Unknown error",
      }));
    }
  }

  // Merge split parts
  const merged = mergeSplitTranslations(allTranslations, splitMap);

  return items.map((item) => {
    const translation = merged.get(item.elementIndex);
    if (translation !== undefined) {
      return {
        elementIndex: item.elementIndex,
        translation,
        state: "translated" as TranslationState,
      };
    }
    return {
      elementIndex: item.elementIndex,
      translation: "",
      state: "error" as TranslationState,
      error: "No translation returned for this paragraph",
    };
  });
}

/**
 * Processes items with cache lookup before API calls.
 */
async function processWithCache(
  items: QueueItem[],
  systemPrompt: string,
  apiConfig: ApiConfig,
  translationConfig: TranslationConfig
): Promise<TranslationResult[]> {
  const results: TranslationResult[] = [];
  const uncached: QueueItem[] = [];

  // Check cache for each item
  for (const item of items) {
    const cached = await getCached(systemPrompt, apiConfig.model, item.text);
    if (cached !== null) {
      results.push({
        elementIndex: item.elementIndex,
        translation: cached,
        state: "translated",
      });
    } else {
      uncached.push(item);
    }
  }

  if (uncached.length === 0) return results;

  // Translate uncached items
  const job: BatchJob = {
    items: uncached,
    systemPrompt,
    apiConfig,
    translationConfig,
    retryCount: translationConfig.retryCount,
  };

  const apiResults = await processBatch(job);

  // Cache successful translations
  for (const result of apiResults) {
    if (result.state === "translated" && result.translation) {
      const item = uncached.find((i) => i.elementIndex === result.elementIndex);
      if (item) {
        await setCached(systemPrompt, apiConfig.model, item.text, result.translation).catch(() => {});
      }
    }
  }

  results.push(...apiResults);
  return results;
}

// ── Main processor ────────────────────────────

/**
 * Runs the translation queue for a tab with a parallel worker pool.
 */
export async function runQueue(
  tabId: number,
  systemPrompt: string,
  apiConfig: ApiConfig,
  translationConfig: TranslationConfig
): Promise<void> {
  const queue = tabQueues.get(tabId);
  if (!queue || queue.processing) return;

  queue.processing = true;

  try {
    const parallelLimit = apiConfig.parallelCalls;
    const active: Promise<void>[] = [];

    while (queue.items.length > 0 || active.length > 0) {
      if (queue.paused) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Fill up to parallel limit
      while (queue.items.length > 0 && active.length < parallelLimit) {
        // Take a chunk of items (one per worker to maximize parallelism,
        // but batching happens inside processWithCache)
        const chunkSize = Math.ceil(queue.items.length / Math.max(1, parallelLimit - active.length));
        const chunk = queue.items.splice(0, Math.min(chunkSize, Math.max(1, chunkSize)));
        emitQueueChanged(tabId, queue.items.length);

        const task = processWithCache(chunk, systemPrompt, apiConfig, translationConfig)
          .then((results) => {
            emitResults(tabId, results);
          })
          .catch((err) => {
            console.error("[LLM Translator] Queue worker error:", err);
          });

        const taskWithCleanup = task.then(() => {
          const idx = active.indexOf(taskWithCleanup);
          if (idx !== -1) active.splice(idx, 1);
        });

        active.push(taskWithCleanup);
      }

      if (active.length > 0) {
        await Promise.race(active);
      }
    }
  } finally {
    queue.processing = false;
    emitQueueChanged(tabId, 0);
  }
}
