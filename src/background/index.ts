// ─────────────────────────────────────────────
//  Background Service Worker — Entry Point
// ─────────────────────────────────────────────

import {
  loadGlobalConfig,
  loadSiteConfig,
  saveSiteConfig,
} from "../storage/config";
import { createDefaultSiteConfig } from "../sites/defaults";
import { getSystemPrompt } from "../prompts/builtins";
import {
  enqueue,
  clearQueue,
  resumeQueue,
  getQueueCount,
  isPaused,
  runQueue,
  onResults,
  onQueueChanged,
  emitResults,
} from "./queue";
import { clearCache, getCacheStats, initCache, setCached, getCached } from "./cache";
import { testApiConnection } from "./api";

// ── Message types ─────────────────────────────

export type BgMessage =
  | { type: "ENQUEUE"; items: Array<{ text: string; elementIndex: number; priority?: number; instruction?: string; skipCache?: boolean }> }
  | { type: "TRANSLATE_NOW" }
  | { type: "RETRANSLATE" }
  | { type: "GET_STATUS" }
  | { type: "GET_SITE_CONFIG"; hostname: string }
  | { type: "SAVE_SITE_CONFIG"; config: import("../storage/config").SiteConfig }
  | { type: "TEST_API" }
  | { type: "CLEAR_CACHE" }
  | { type: "GET_CACHE_STATS" }
  | { type: "CLEAR_QUEUE" }
  | { type: "SET_MANUAL_TRANSLATION"; original: string; translation: string };

export type BgResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// ── Result forwarding to content scripts ─────

onResults(async (tabId, results) => {
  // Notify content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "TRANSLATION_RESULTS",
      results,
    });
  } catch {
    // Tab may have closed
  }

  // Notify popup/options page if open
  try {
    await chrome.runtime.sendMessage({
      type: "TRANSLATION_RESULTS",
      tabId,
      results,
    }).catch(() => {});
  } catch {}
});

onQueueChanged(async (tabId, count) => {
  // Notify content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "QUEUE_COUNT",
      count,
    });
  } catch {
    // Tab may have closed
  }

  // Notify popup/options page if open
  try {
    await chrome.runtime.sendMessage({
      type: "QUEUE_COUNT",
      tabId,
      count,
    }).catch(() => {});
  } catch {}
});

// ── Track active translation sessions ─────────

const activeSessions = new Map<number, boolean>(); // tabId → running
const pendingRetranslate = new Map<number, boolean>(); // tabId → a retranslate is queued until the current session ends

/**
 * Resolves the system prompt and model for a tab, mirroring the resolution
 * used when starting a translation. Returns null if the API is not configured.
 */
async function resolveSession(
  tabId: number
): Promise<{ systemPrompt: string; model: string } | null> {
  const globalConfig = await loadGlobalConfig();
  initCache(globalConfig.cache.maxMb);

  if (!globalConfig.api.base || !globalConfig.api.model) {
    return null;
  }

  const tab = await chrome.tabs.get(tabId);
  const hostname = tab.url ? new URL(tab.url).hostname : "";

  let siteConfig = await loadSiteConfig(hostname);
  if (!siteConfig.prompt) {
    siteConfig = createDefaultSiteConfig(hostname);
    await saveSiteConfig(siteConfig);
  }

  const systemPrompt = getSystemPrompt(
    siteConfig.prompt,
    {
      source_language: siteConfig.sourceLanguage,
      target_language: siteConfig.targetLanguage,
      hostname,
      url: tab.url ?? "",
      page_title: tab.title ?? "",
    },
    globalConfig.userPrompts
  );

  return { systemPrompt, model: globalConfig.api.model };
}

async function startTranslation(tabId: number, retranslate = false): Promise<void> {
  if (activeSessions.get(tabId)) return;
  activeSessions.set(tabId, true);

  try {
    const globalConfig = await loadGlobalConfig();
    initCache(globalConfig.cache.maxMb);

    if (!globalConfig.api.base || !globalConfig.api.model) {
      const err = "API not configured. Please open Settings.";
      await chrome.tabs.sendMessage(tabId, { type: "TRANSLATION_ERROR", error: err }).catch(() => {});
      await chrome.runtime.sendMessage({ type: "TRANSLATION_ERROR", tabId, error: err }).catch(() => {});
      return;
    }

    // Get hostname from tab
    const tab = await chrome.tabs.get(tabId);
    const hostname = tab.url ? new URL(tab.url).hostname : "";

    let siteConfig = await loadSiteConfig(hostname);

    // If no site config exists yet, create from defaults
    if (!siteConfig.prompt) {
      siteConfig = createDefaultSiteConfig(hostname);
      await saveSiteConfig(siteConfig);
    }

    if (siteConfig.mode === "off") {
      clearQueue(tabId);
      // Tell content script to disable itself (restore originals, stop observer)
      await chrome.tabs.sendMessage(tabId, { type: "RETRANSLATE" }).catch(() => {});
      activeSessions.delete(tabId);
      return;
    }

    if (retranslate) {
      clearQueue(tabId);
      // Tell content script to restore originals and re-extract
      await chrome.tabs.sendMessage(tabId, { type: "RETRANSLATE" }).catch(() => {});
    }

    const systemPrompt = getSystemPrompt(
      siteConfig.prompt,
      {
        source_language: siteConfig.sourceLanguage,
        target_language: siteConfig.targetLanguage,
        hostname,
        url: tab.url ?? "",
        page_title: tab.title ?? "",
      },
      globalConfig.userPrompts
    );

    resumeQueue(tabId);

    await runQueue(tabId, systemPrompt, globalConfig.api, globalConfig.translation);
  } finally {
    activeSessions.delete(tabId);
    // If a retranslate arrived while this session was running, run it now so a
    // mid-translation setting change (e.g. target language) isn't silently dropped.
    if (pendingRetranslate.get(tabId)) {
      pendingRetranslate.delete(tabId);
      startTranslation(tabId, true).catch(console.error);
    }
  }
}

// ── Message handler ───────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: BgMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BgResponse) => void
  ) => {
    const tabId = sender.tab?.id;

    (async () => {
      try {
        switch (message.type) {
          case "ENQUEUE": {
            if (!tabId) break;

            // Check cache immediately so cached translations don't wait in the queue
            const session = await resolveSession(tabId);
            const uncached: Array<{ text: string; elementIndex: number; priority?: number; instruction?: string; skipCache?: boolean }> = [];
            const cacheHits: Array<{ elementIndex: number; translation: string }> = [];

            if (session) {
              const checks = await Promise.all(
                message.items.map(async (item) => {
                  if (item.skipCache) return { item, cached: null };
                  const cached = await getCached(session.systemPrompt, session.model, item.text);
                  return { item, cached };
                })
              );
              for (const { item, cached } of checks) {
                if (cached !== null) {
                  cacheHits.push({ elementIndex: item.elementIndex, translation: cached });
                } else {
                  uncached.push(item);
                }
              }
            } else {
              uncached.push(...message.items);
            }

            // Emit cache hits immediately
            if (cacheHits.length > 0) {
              emitResults(tabId, cacheHits.map((h) => ({
                elementIndex: h.elementIndex,
                translation: h.translation,
                state: "translated" as const,
              })));
            }

            // Only enqueue uncached items
            if (uncached.length > 0) {
              enqueue(tabId, uncached);
            }

            // Auto-start if not already running
            startTranslation(tabId).catch(console.error);
            sendResponse({ ok: true });
            break;
          }

          case "TRANSLATE_NOW": {
            if (!tabId) break;
            startTranslation(tabId).catch(console.error);
            sendResponse({ ok: true });
            break;
          }

          case "RETRANSLATE": {
            if (!tabId) break;
            if (activeSessions.get(tabId)) {
              // A translation is already running (e.g. the initial auto-translate).
              // Don't drop this request: clear the stale queue, tell the content
              // script to restore originals, and defer the re-translation until
              // the current session finishes.
              clearQueue(tabId);
              pendingRetranslate.set(tabId, true);
              await chrome.tabs.sendMessage(tabId, { type: "RETRANSLATE" }).catch(() => {});
            } else {
              startTranslation(tabId, true).catch(console.error);
            }
            sendResponse({ ok: true });
            break;
          }

          case "CLEAR_QUEUE": {
            if (!tabId) break;
            clearQueue(tabId);
            sendResponse({ ok: true });
            break;
          }

          case "GET_STATUS": {
            if (!tabId) {
              sendResponse({ ok: true, data: { queueCount: 0, paused: false } });
              break;
            }
            sendResponse({
              ok: true,
              data: {
                queueCount: getQueueCount(tabId),
                paused: isPaused(tabId),
                running: activeSessions.has(tabId),
              },
            });
            break;
          }

          case "GET_SITE_CONFIG": {
            let config = await loadSiteConfig(message.hostname);
            if (!config.observe) {
              config = createDefaultSiteConfig(message.hostname);
              await saveSiteConfig(config);
            }
            sendResponse({ ok: true, data: config });
            break;
          }

          case "SAVE_SITE_CONFIG": {
            await saveSiteConfig(message.config);
            sendResponse({ ok: true });
            break;
          }

          case "TEST_API": {
            const config = await loadGlobalConfig();
            const result = await testApiConnection(config.api);
            sendResponse({ ok: true, data: result });
            break;
          }

          case "CLEAR_CACHE": {
            await clearCache();
            sendResponse({ ok: true });
            break;
          }

          case "GET_CACHE_STATS": {
            const stats = await getCacheStats();
            sendResponse({ ok: true, data: stats });
            break;
          }

          case "SET_MANUAL_TRANSLATION": {
            if (!tabId) break;
            const session = await resolveSession(tabId);
            if (!session) {
              sendResponse({ ok: false, error: "API not configured" });
              break;
            }
            await setCached(
              session.systemPrompt,
              session.model,
              message.original,
              message.translation
            );
            sendResponse({ ok: true });
            break;
          }

          default:
            sendResponse({ ok: false, error: "Unknown message type" });
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // Return true to keep the message channel open for async response
    return true;
  }
);

// ── Tab lifecycle ─────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  clearQueue(tabId);
  activeSessions.delete(tabId);
});

// ── Install / Update ──────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    console.log("[LLM Translator] Installed v0.1.0");
    // Open options on first install
    await chrome.runtime.openOptionsPage();
  } else if (details.reason === "update") {
    console.log("[LLM Translator] Updated to v0.1.0");
  }
});

console.log("[LLM Translator] Background worker started");
