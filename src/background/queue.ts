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
  /** Priority (lower = higher priority, Infinity = default) */
  priority: number;
  /** Optional review instruction appended to the user prompt for retranslate */
  instruction?: string;
  /** If true, skip cache lookup and always call the API */
  skipCache?: boolean;
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
  activeItemsCount: number;
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
  items: Array<{ text: string; elementIndex: number; priority?: number; instruction?: string; skipCache?: boolean }>
): void {
  let queue = tabQueues.get(tabId);
  if (!queue) {
    queue = { items: [], paused: false, processing: false, activeItemsCount: 0 };
    tabQueues.set(tabId, queue);
  }

  for (const item of items) {
    queue.items.push({
      id: ++queueIdCounter,
      text: item.text,
      tabId,
      elementIndex: item.elementIndex,
      priority: item.priority ?? Infinity,
      instruction: item.instruction,
      skipCache: item.skipCache,
    });
  }

  // Sort: lower priority first, then by id (FIFO within same priority)
  queue.items.sort((a, b) => a.priority - b.priority || a.id - b.id);

  emitQueueChanged(tabId, queue.items.length + (queue.activeItemsCount || 0));
}

export function clearQueue(tabId: number): void {
  const queue = tabQueues.get(tabId);
  if (queue) {
    queue.items = [];
    queue.activeItemsCount = 0;
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
  const queue = tabQueues.get(tabId);
  return queue ? queue.items.length + (queue.activeItemsCount || 0) : 0;
}

export function isPaused(tabId: number): boolean {
  return tabQueues.get(tabId)?.paused ?? false;
}

// ── Worker pool ───────────────────────────────

/**
 * Processes a single batch job with retry logic.
 * Calls onBatchDone after each sub-batch so results can be streamed
 * to the content script incrementally for better UX.
 */
async function processBatch(
  job: BatchJob,
  onBatchDone?: (results: TranslationResult[]) => void
): Promise<TranslationResult[]> {
  const { items, systemPrompt, apiConfig, translationConfig } = job;

  const paragraphs = items.map((item) => ({
    id: item.elementIndex,
    text: item.instruction ? `${item.text}\n\n${item.instruction}` : item.text,
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
      // Emit error results for this sub-batch immediately
      const errorResults = batch.paragraphs.map((p) => ({
        elementIndex: p.id,
        translation: "",
        state: "error" as TranslationState,
        error: lastError?.message ?? "Unknown error",
      }));
      onBatchDone?.(errorResults);
      return errorResults;
    }

    // --- Emit results for this sub-batch right away (better UX) ---
    // Only emit IDs that belong to unsplit items in this sub-batch so we
    // don't emit partial results for a paragraph that was split across batches.
    const batchTranslations = new Map<number, string>();
    for (const p of batch.paragraphs) {
      const translation = allTranslations.get(p.id);
      if (translation !== undefined) batchTranslations.set(p.id, translation);
    }

    // Determine which original items are fully resolved by this sub-batch
    // (i.e. their entire text was contained in a single sub-batch).
    const resolvedItems: QueueItem[] = [];
    for (const item of items) {
      const splitInfo = splitMap.get(item.elementIndex);
      if (splitInfo) {
        // Item was split — only emit when ALL parts have been translated
        const allPartsReady = splitInfo.partIds.every((pid) => allTranslations.has(pid));
        if (allPartsReady) resolvedItems.push(item);
      } else if (batchTranslations.has(item.elementIndex)) {
        resolvedItems.push(item);
      }
    }

    if (resolvedItems.length > 0 && onBatchDone) {
      const partialMerged = mergeSplitTranslations(batchTranslations, splitMap);
      const partialResults = resolvedItems.map((item) => {
        const translation = partialMerged.get(item.elementIndex) ?? batchTranslations.get(item.elementIndex);
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
      onBatchDone(partialResults);
    }
  }

  // Merge all split parts and build the final complete result list
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
 *
 * @param onPartialResults - Called after each sub-batch completes so results
 *   can be streamed to the content script immediately (better UX).
 */
async function processWithCache(
  items: QueueItem[],
  systemPrompt: string,
  apiConfig: ApiConfig,
  translationConfig: TranslationConfig,
  onPartialResults?: (results: TranslationResult[]) => void
): Promise<TranslationResult[]> {
  const results: TranslationResult[] = [];
  const uncached: QueueItem[] = [];

  // Check cache for each item (skip if skipCache is set, e.g. retranslate)
  for (const item of items) {
    if (item.skipCache) {
      uncached.push(item);
      continue;
    }
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

  // Emit cache hits immediately so they appear right away
  if (results.length > 0) {
    onPartialResults?.(results);
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

  // Track which items have already been emitted by onBatchDone
  // so we don't double-emit them in the final return.
  const emittedIndices = new Set<number>();

  const apiResults = await processBatch(job, (partialResults) => {
    // Cache and emit each sub-batch result immediately
    for (const result of partialResults) {
      emittedIndices.add(result.elementIndex);
      if (result.state === "translated" && result.translation) {
        const item = uncached.find((i) => i.elementIndex === result.elementIndex);
        if (item) {
          setCached(systemPrompt, apiConfig.model, item.text, result.translation).catch(() => {});
        }
      }
    }
    onPartialResults?.(partialResults);
  });

  // Cache any successful translations not yet handled by onBatchDone
  for (const result of apiResults) {
    if (!emittedIndices.has(result.elementIndex)) {
      if (result.state === "translated" && result.translation) {
        const item = uncached.find((i) => i.elementIndex === result.elementIndex);
        if (item) {
          setCached(systemPrompt, apiConfig.model, item.text, result.translation).catch(() => {});
        }
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
  queue.activeItemsCount = 0;

  try {
    const parallelLimit = apiConfig.parallelCalls;
    const maxChunk = apiConfig.chunkSize;
    const active: Promise<void>[] = [];

    while (queue.items.length > 0 || active.length > 0) {
      if (queue.paused) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Fill up to parallel limit
      while (queue.items.length > 0 && active.length < parallelLimit) {
        // Take a chunk of items, capped at chunkSize so each worker only
        // sends a small batch — results trickle in as workers finish
        const chunkSize = Math.min(
          Math.ceil(queue.items.length / Math.max(1, parallelLimit - active.length)),
          maxChunk
        );
        const chunk = queue.items.splice(0, Math.max(1, chunkSize));
        
        queue.activeItemsCount += chunk.length;
        emitQueueChanged(tabId, queue.items.length + queue.activeItemsCount);

        const task = processWithCache(
          chunk,
          systemPrompt,
          apiConfig,
          translationConfig,
          // Stream partial results to the content script after each sub-batch
          (partialResults) => emitResults(tabId, partialResults)
        )
          .then(() => {
            // Full results were already emitted incrementally via onPartialResults;
            // nothing extra to emit here.
          })
          .catch((err) => {
            console.error("[LLM Translator] Queue worker error:", err);
          })
          .finally(() => {
            queue.activeItemsCount = Math.max(0, queue.activeItemsCount - chunk.length);
            emitQueueChanged(tabId, queue.items.length + queue.activeItemsCount);
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
    queue.activeItemsCount = 0;
    emitQueueChanged(tabId, 0);
  }
}
