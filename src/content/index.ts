// ─────────────────────────────────────────────
//  Content Script — Entry Point
// ─────────────────────────────────────────────

import { DOMObserver } from "./observer";
import {
  extractTranslatableNodes,
  restoreOriginals,
  isTranslated,
  ATTR_TRANSLATION_ID,
} from "./extractor";
import { applyTranslations, injectStyles, markElementsTranslating, revertTranslatingElement, revertStuckElements } from "./renderer";
import type { SiteConfig } from "../storage/config";
import type { TranslationResult } from "../background/queue";

// ── Constants ─────────────────────────────────

const CHUNK_SIZE = 25;
const CHUNK_DELAY = 1500;

// ── State ─────────────────────────────────────

let siteConfig: SiteConfig | null = null;
let observer: DOMObserver | null = null;
let enabled = true;
let queueCount = 0;
let pendingIndices = new Set<number>();
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

// ── Init ──────────────────────────────────────

async function init(): Promise<void> {
  injectStyles();

  // Request site config from background
  const hostname = location.hostname;
  const response = await sendToBackground({
    type: "GET_SITE_CONFIG",
    hostname,
  });

  if (!response.ok) {
    console.warn("[LLM Translator] Could not load site config:", response.error);
    return;
  }

  siteConfig = response.data as SiteConfig;
  enabled = siteConfig.enabled;

  if (!enabled) return;

  // Create observer (not yet started)
  observer = new DOMObserver(
    handleNewNodes,
    {
      target: siteConfig.observe || "body",
      selector: siteConfig.selector || "",
      ignoreSelectors: siteConfig.ignore || [],
    }
  );

  // Extract initial content before observer starts to avoid
  // self-triggering on <span> wrapper mutations
  const allNodes = extractTranslatableNodes(
    document,
    siteConfig.selector || "",
    siteConfig.ignore || []
  );

  // Enqueue in chunks from top to bottom so translation results
  // appear gradually rather than waiting for every node to finish.
  if (allNodes.length > 0) {
    for (let i = 0; i < allNodes.length; i += CHUNK_SIZE) {
      const chunk = allNodes.slice(i, i + CHUNK_SIZE);
      const delay = (i / CHUNK_SIZE) * CHUNK_DELAY;
      setTimeout(() => enqueueNodes(chunk).catch(console.error), delay);
    }
  }

  // Start observer for dynamic content
  observer.start();
}

// ── Node handling ─────────────────────────────

async function handleNewNodes(addedElements: Element[]): Promise<void> {
  if (!siteConfig || !enabled) return;

  const newNodes: ReturnType<typeof extractTranslatableNodes> = [];

  for (const root of addedElements) {
    // Check if the root itself is translatable
    if (
      !isTranslated(root) &&
      root.textContent?.trim() &&
      !root.querySelector("[" + ATTR_TRANSLATION_ID + "]")
    ) {
      const extracted = extractTranslatableNodes(
        root,
        siteConfig.selector || "",
        siteConfig.ignore || []
      );
      newNodes.push(...extracted);
    }
  }

  if (newNodes.length > 0) {
    await enqueueNodes(newNodes);
  }
}

async function enqueueNodes(
  nodes: ReturnType<typeof extractTranslatableNodes>
): Promise<void> {
  if (nodes.length === 0) return;

  const indices = nodes.map((n) => n.elementIndex);

  // Mark as translating
  markElementsTranslating(indices);

  const items = nodes.map((n) => ({
    text: n.text,
    elementIndex: n.elementIndex,
  }));

  // Track pending so cleanup doesn't fire prematurely
  for (const idx of indices) pendingIndices.add(idx);

  const response = await sendToBackground({ type: "ENQUEUE", items });

  if (!response.ok) {
    console.warn(`[LLM Translator] Failed to enqueue ${indices.length} items: ${response.error}`);
    for (const node of nodes) {
      pendingIndices.delete(node.elementIndex);
      revertTranslatingElement(node.element);
    }
  }
}

// ── Cleanup ───────────────────────────────────

function cancelCleanup(): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}

function scheduleCleanup(): void {
  cancelCleanup();
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    // Purge stale pending entries whose elements no longer exist
    for (const idx of [...pendingIndices]) {
      if (!document.querySelector(`[${ATTR_TRANSLATION_ID}="${idx}"]`)) {
        pendingIndices.delete(idx);
      }
    }
    const reverted = revertStuckElements();
    // Re-enqueue the reverted text nodes so they get another chance
    if (reverted > 0 && siteConfig) {
      console.log(`[LLM Translator] Re-enqueuing ${reverted} stuck items`);
      const nodes = extractTranslatableNodes(
        document,
        siteConfig.selector || "",
        siteConfig.ignore || []
      );
      if (nodes.length > 0) {
        enqueueNodes(nodes);
      }
    }
  }, 2000);
}

// ── Message listener ──────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; [key: string]: unknown },
    _sender,
    sendResponse
  ) => {
    switch (message.type) {
      case "TRANSLATION_RESULTS": {
        const results = message.results as TranslationResult[];
        for (const r of results) pendingIndices.delete(r.elementIndex);
        applyTranslations(results);
        sendResponse({ ok: true });
        break;
      }

      case "QUEUE_COUNT": {
        queueCount = message.count as number;
        if (queueCount === 0) {
          scheduleCleanup();
        } else {
          cancelCleanup();
        }
        sendResponse({ ok: true });
        break;
      }

      case "RETRANSLATE": {
        cancelCleanup();
        pendingIndices.clear();
        restoreOriginals();
        if (siteConfig) {
          const nodes = extractTranslatableNodes(
            document,
            siteConfig.selector || "",
            siteConfig.ignore || []
          );
          if (nodes.length > 0) {
            for (let i = 0; i < nodes.length; i += CHUNK_SIZE) {
              const chunk = nodes.slice(i, i + CHUNK_SIZE);
              const delay = (i / CHUNK_SIZE) * CHUNK_DELAY;
              setTimeout(() => enqueueNodes(chunk).catch(console.error), delay);
            }
          }
        }
        sendResponse({ ok: true });
        break;
      }

      case "TRANSLATION_ERROR": {
        console.error("[LLM Translator] Error:", message.error);
        sendResponse({ ok: true });
        break;
      }

      case "RELOAD_CONFIG": {
        // Re-initialize when config changes
        cancelCleanup();
        observer?.stop();
        init().catch(console.error);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  }
);

// ── Helpers ───────────────────────────────────

async function sendToBackground(
  message: object
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Bootstrap ─────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch(console.error));
} else {
  init().catch(console.error);
}
