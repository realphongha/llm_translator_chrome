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
import { applyTranslations, injectStyles, markElementsTranslating } from "./renderer";
import type { SiteConfig } from "../storage/config";
import type { TranslationResult } from "../background/queue";

// ── State ─────────────────────────────────────

let siteConfig: SiteConfig | null = null;
let observer: DOMObserver | null = null;
let enabled = true;
let queueCount = 0;

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

  // Start observer
  observer = new DOMObserver(
    handleNewNodes,
    {
      target: siteConfig.observe || "body",
      selector: siteConfig.selector || "",
      ignoreSelectors: siteConfig.ignore || [],
    }
  );
  observer.start();

  // Extract initial content
  const nodes = extractTranslatableNodes(
    document,
    siteConfig.selector || "",
    siteConfig.ignore || []
  );

  if (nodes.length > 0) {
    await enqueueNodes(nodes);
  }
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

  // Mark as translating
  markElementsTranslating(nodes.map((n) => n.elementIndex));

  const items = nodes.map((n) => ({
    text: n.text,
    elementIndex: n.elementIndex,
  }));

  await sendToBackground({ type: "ENQUEUE", items });
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
        applyTranslations(results);
        sendResponse({ ok: true });
        break;
      }

      case "QUEUE_COUNT": {
        queueCount = message.count as number;
        sendResponse({ ok: true });
        break;
      }

      case "RETRANSLATE": {
        restoreOriginals();
        // Re-extract and enqueue
        if (siteConfig) {
          const nodes = extractTranslatableNodes(
            document,
            siteConfig.selector || "",
            siteConfig.ignore || []
          );
          enqueueNodes(nodes).catch(console.error);
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
