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
  pauseQueue,
  resumeQueue,
  getQueueCount,
  isPaused,
  runQueue,
  onResults,
  onQueueChanged,
} from "./queue";
import { clearCache, getCacheStats, initCache } from "./cache";
import { testApiConnection } from "./api";

// ── Message types ─────────────────────────────

export type BgMessage =
  | { type: "ENQUEUE"; items: Array<{ text: string; elementIndex: number; priority?: number; instruction?: string; skipCache?: boolean }> }
  | { type: "TRANSLATE_NOW" }
  | { type: "RETRANSLATE" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "GET_STATUS" }
  | { type: "GET_SITE_CONFIG"; hostname: string }
  | { type: "SAVE_SITE_CONFIG"; config: import("../storage/config").SiteConfig }
  | { type: "TEST_API" }
  | { type: "CLEAR_CACHE" }
  | { type: "GET_CACHE_STATS" }
  | { type: "CLEAR_QUEUE" };

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

    if (!siteConfig.enabled) {
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
            enqueue(tabId, message.items);
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
            startTranslation(tabId, true).catch(console.error);
            sendResponse({ ok: true });
            break;
          }

          case "PAUSE": {
            if (!tabId) break;
            pauseQueue(tabId);
            sendResponse({ ok: true });
            break;
          }

          case "RESUME": {
            if (!tabId) break;
            resumeQueue(tabId);
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
