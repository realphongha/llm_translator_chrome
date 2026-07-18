// ─────────────────────────────────────────────
//  Content Script — Entry Point
// ─────────────────────────────────────────────

import { DOMObserver } from "./observer";
import {
  extractTranslatableNodes,
  restoreOriginals,
  isTranslated,
  clearTranslationMemory,
  ATTR_TRANSLATION_ID,
  ATTR_ORIGINAL,
  ATTR_STATE,
  ATTR_PRIORITY,
} from "./extractor";
import { applyTranslations, injectStyles, markElementsTranslating, revertTranslatingElement, toggleOriginal } from "./renderer";
import type { SiteConfig, PriorityRule } from "../storage/config";
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
let isReloading = false;

async function reloadAndRetranslate(): Promise<void> {
  if (isReloading) return;
  isReloading = true;
  try {
    cancelCleanup();
    observer?.stop();
    restoreOriginals();
    clearTranslationMemory();
    pendingIndices.clear();
    await init();
  } finally {
    isReloading = false;
  }
}

// ── Init ──────────────────────────────────────

async function init(): Promise<void> {
  injectStyles();

  // Wait a small moment (300ms) to let client-side frameworks (React, Vue, etc.)
  // render their initial content before extraction. This allows priority rules
  // to be applied to a more complete DOM state.
  await new Promise((resolve) => setTimeout(resolve, 300));

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

  // Clear any existing queue items for this tab first to avoid translating stale nodes
  await sendToBackground({ type: "CLEAR_QUEUE" });

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
    siteConfig.ignore || [],
    siteConfig.priorityRules || []
  );

  // Enqueue all elements together so the background queue has the full set of
  // nodes to sort and prioritize. Streaming to the user is handled incrementally
  // by the background script after each sub-batch completion.
  if (allNodes.length > 0) {
    enqueueNodes(allNodes).catch(console.error);
  }

  // Start observer for dynamic content
  observer.start();
}

// ── Node handling ─────────────────────────────

async function handleNewNodes(addedElements: Element[]): Promise<void> {
  if (!siteConfig || !enabled) return;

  const newNodes: ReturnType<typeof extractTranslatableNodes> = [];

  for (const root of addedElements) {
    if (
      !isTranslated(root) &&
      root.textContent?.trim() &&
      !root.querySelector("[" + ATTR_TRANSLATION_ID + "]")
    ) {
      const extracted = extractTranslatableNodes(
        root,
        siteConfig.selector || "",
        siteConfig.ignore || [],
        siteConfig.priorityRules || []
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
    priority: n.priority !== Infinity ? n.priority : undefined,
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
    // Re-enqueue only elements still stuck in "translating" state. These
    // retain a valid data-original (the true source text), so we can safely
    // retry them. We deliberately do NOT re-walk the whole document here:
    // doing so would re-capture already-translated text (e.g. Vietnamese left
    // behind after a framework like Vue re-rendered a paragraph and dropped
    // our wrapper) and store it as a bogus data-original.
    const stuck = document.querySelectorAll(`[${ATTR_STATE}="translating"]`);
    if (stuck.length > 0 && siteConfig) {
      const nodes: ReturnType<typeof extractTranslatableNodes> = [];
      for (const el of stuck) {
        const idxAttr = el.getAttribute(ATTR_TRANSLATION_ID);
        if (!idxAttr) continue;
        const idx = parseInt(idxAttr, 10);
        const original = (el.getAttribute(ATTR_ORIGINAL) ?? "").trim();
        if (!original) continue;
        nodes.push({
          elementIndex: idx,
          text: original,
          element: el,
          priority: el.hasAttribute(ATTR_PRIORITY)
            ? parseInt(el.getAttribute(ATTR_PRIORITY)!, 10)
            : Infinity,
        });
      }
      if (nodes.length > 0) {
        console.log(`[LLM Translator] Re-enqueuing ${nodes.length} stuck items`);
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
        for (const r of results) {
          pendingIndices.delete(r.elementIndex);
        }
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
        reloadAndRetranslate().catch(console.error);
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

      case "SCAN_DOM": {
        const scanSelector = (message.selector as string) || "";
        const scanIgnore = (message.ignore as string[]) || [];
        const scanRules = (message.priorityRules as PriorityRule[]) || [];
        const result = scanDOM(scanSelector, scanIgnore, scanRules);
        sendResponse({ ok: true, data: result });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  }
);

// ── DOM Scan (for popup debug) ───────────────

interface ScanGroup {
  selector: string;
  count: number;
  sampleText: string;
  isSelected: boolean;
  isIgnored: boolean;
  reason: string;
  suggestion: "content" | "ignore" | "priority" | "none";
  priority: number;
}

/** Build a grouping key for an element (full CSS path, minus nth-child) */
function getGroupKey(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < 4) {
    let seg = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift("#" + current.id);
      break;
    }
    const classes = Array.from(current.classList).filter(
      c => !c.startsWith("data-") && c !== ATTR_TRANSLATION_ID
    ).sort();
    if (classes.length > 0) seg += "." + classes.join(".");
    parts.unshift(seg);
    current = current.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

/** Extract a short CSS selector from a full path (tag + meaningful classes only) */
function shortenSelector(path: string): string {
  // Take the last segment (deepest element)
  const segments = path.split(" > ");
  const last = segments[segments.length - 1];
  // Filter out tailwind utility noise
  const parts = last.split(".");
  const tag = parts[0];
  const meaningful = parts.slice(1).filter(c => {
    if (/[[\]:]/.test(c)) return false;
    if (/^\d/.test(c) || /[:]$/.test(c) || /^[0-9.]+(px|em|rem)$/.test(c)) return false;
    if (c.startsWith("sm:") || c.startsWith("md:") || c.startsWith("lg:") || c.startsWith("xl:")) return false;
    if (c.startsWith("hover:") || c.startsWith("focus:") || c.startsWith("active:")) return false;
    return true;
  });
  if (meaningful.length > 0) return tag + "." + meaningful.join(".");
  return tag;
}

/** Get display text from an element — returns translated text if available */
function getDisplayText(el: Element): string {
  // Direct span[data-translation-id]
  if (el.hasAttribute(ATTR_TRANSLATION_ID)) {
    const original = el.getAttribute(ATTR_ORIGINAL) || "";
    const current = el.textContent || "";
    if (current !== original) return current.trim();
    return "";
  }
  // Parent might be the translated span
  const p = el.parentElement;
  if (p && p.hasAttribute(ATTR_TRANSLATION_ID)) {
    return getDisplayText(p);
  }
  // Child might contain translated spans
  const translated = el.querySelector(`[${ATTR_TRANSLATION_ID}]`);
  if (translated) {
    return getDisplayText(translated);
  }
  return "";
}

/** Get sample display text for a group */
function getGroupSample(elements: Element[]): { text: string; translated: boolean } {
  for (const el of elements) {
    const display = getDisplayText(el);
    if (display) return { text: display.slice(0, 120), translated: true };
  }
  // No translated text found — return first available original text
  for (const el of elements) {
    const text = (el.textContent || "").trim();
    if (text) return { text: "", translated: false };
  }
  return { text: "", translated: false };
}

function scanDOM(
  selector: string,
  ignoreSelectors: string[],
  priorityRules: PriorityRule[]
): ScanGroup[] {
  const groups = new Map<string, { elements: Element[] }>();

  // Collect all text-containing elements in the document
  const allElements: Element[] = [];

  // 1. Walk elements with data-translation-id (already extracted)
  const translatedEls = document.querySelectorAll(`[${ATTR_TRANSLATION_ID}]`);
  for (const el of translatedEls) {
    allElements.push(el);
  }

  // 2. Walk raw text nodes not yet extracted
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenText = new Set<Node>();
  while (walker.nextNode()) {
    const tn = walker.currentNode as Text;
    if (seenText.has(tn)) continue;
    seenText.add(tn);
    const raw = (tn.textContent ?? "").trim();
    if (!raw || !/\p{L}/u.test(raw)) continue;
    if (!tn.parentElement) continue;
    // Skip if already inside a translated wrapper
    if (tn.parentElement.closest(`[${ATTR_TRANSLATION_ID}]`)) continue;
    allElements.push(tn.parentElement);
  }

  // Group by container path
  for (const el of allElements) {
    // Find the container: for translated spans, use the parent that matches selector pattern
    const container = el.hasAttribute(ATTR_TRANSLATION_ID) ? (el.parentElement || el) : el;
    const key = getGroupKey(container);
    if (!groups.has(key)) groups.set(key, { elements: [] });
    groups.get(key)!.elements.push(container);
  }

  // Deduplicate elements within each group
  for (const [, group] of groups) {
    const seen = new Set<Element>();
    group.elements = group.elements.filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  const results: ScanGroup[] = [];

  for (const [path, group] of groups) {
    const count = group.elements.length;
    if (count === 0) continue;

    const sampleEl = group.elements[0];
    const isSelected = selector?.trim() ? !!sampleEl.closest(selector) : true;
    const isIgnored = ignoreSelectors.some(s => {
      try { return sampleEl.closest(s); } catch { return false; }
    });

    const sample = getGroupSample(group.elements);
    const sampleText = sample.translated ? sample.text : "";

    let suggestion: ScanGroup["suggestion"] = "none";
    let reason = "";
    let priority = 99;

    if (isIgnored) {
      suggestion = "none";
      reason = `Ignored by config`;
    } else if (isSelected) {
      suggestion = "none";
      reason = `${count} occurrences — already in content selector`;
    } else if (count >= 15) {
      suggestion = "content";
      reason = `${count} occurrences — likely main content`;
      priority = 1;
    } else if (count >= 5) {
      suggestion = "priority";
      reason = `${count} occurrences — moderate frequency`;
      priority = 50;
    } else {
      suggestion = "ignore";
      reason = `Only ${count} occurrence${count > 1 ? "s" : ""} — likely nav/UI`;
      priority = 99;
    }

    results.push({
      selector: path,
      count,
      sampleText: sampleText || (sample.translated ? sample.text.slice(0, 120) : ""),
      isSelected,
      isIgnored,
      reason,
      suggestion,
      priority,
    });
  }

  // Sort: actionable groups first (by count desc), then already-handled groups last
  results.sort((a, b) => {
    const aAction = a.suggestion !== "none" ? 0 : 1;
    const bAction = b.suggestion !== "none" ? 0 : 1;
    return aAction - bAction || b.count - a.count;
  });

  return results;
}

// ── Hover tooltip for translated elements ──

function buildRetranslateInstruction(previousTranslation: string, comment?: string): string {
  let text = "The above paragraph was previously translated.\n\n";
  text += `Previous translation: ${previousTranslation}\n\n`;
  text += "The new translation should be different from the previous translation.\n\n";
  if (comment) {
    text += `Review note: ${comment}\n\n`;
  }
  text += "Please review the translation above and provide a corrected version.\n";
  text += "Return only the corrected translation.";
  return text;
}

let _tooltipTimer: ReturnType<typeof setTimeout> | null = null;
let _tooltipEl: HTMLElement | null = null;
let _tooltipTarget: Element | null = null;

function hideTooltip(): void {
  if (_tooltipTimer) { clearTimeout(_tooltipTimer); _tooltipTimer = null; }
  _tooltipEl?.remove();
  _tooltipEl = null;
  _tooltipTarget = null;
}

function scheduleHideTooltip(delay: number): void {
  if (_tooltipTimer) clearTimeout(_tooltipTimer);
  _tooltipTimer = setTimeout(hideTooltip, delay);
}

function showTooltip(el: Element): void {
  // Same element → just refresh timer
  if (_tooltipTarget === el) {
    scheduleHideTooltip(3000);
    return;
  }

  hideTooltip();
  _tooltipTarget = el;

  const rect = el.getBoundingClientRect();
  const t = document.createElement("div");
  _tooltipEl = t;
  t.id = "llt-tooltip";
  t.style.cssText = `
    position: fixed; z-index: 2147483647;
    left: ${Math.min(rect.right + 6, window.innerWidth - 160)}px;
    top: ${rect.top}px;
    background: #1c1f28; border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px; padding: 1px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
    font-family: -apple-system, system-ui, sans-serif;
    display: flex; flex-direction: row; align-items: center;
  `;

  const idx = parseInt(el.getAttribute(ATTR_TRANSLATION_ID)!);

  // Hide toggle when original matches current text (corrupted)
  const orig = el.getAttribute(ATTR_ORIGINAL);
  const showingOrig = el.getAttribute("data-showing-original") === "true";
  const canToggle = orig != null && (showingOrig || el.textContent !== orig);

  const btnStyle = "width:28px;height:28px;padding:0;border:none;border-radius:4px;background:none;cursor:pointer;color:#c8cbd8;font-size:16px;display:flex;align-items:center;justify-content:center;line-height:1;";

  function addBtn(symbol: string, title: string, action: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = symbol;
    btn.title = title;
    btn.style.cssText = btnStyle;
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.07)"; if (_tooltipTimer) { clearTimeout(_tooltipTimer); _tooltipTimer = null; } });
    btn.addEventListener("mouseleave", () => { btn.style.background = "none"; scheduleHideTooltip(3000); });
    btn.addEventListener("click", (e) => { e.stopPropagation(); action(); });
    t.appendChild(btn);
    return btn;
  }

  if (canToggle) addBtn("\u21C4", "Toggle Original / Translated", () => { toggleOriginal(idx); hideTooltip(); });
  addBtn("\u21BB", "Retranslate", () => { hideTooltip(); retranslateElement(el, false); });
  addBtn("\u270E", "Retranslate with Comment", () => { hideTooltip(); retranslateElement(el, true); });
  addBtn("\u2715", "Close", () => hideTooltip());

  document.body.appendChild(t);
  scheduleHideTooltip(3000);
}

document.addEventListener("mouseover", (e) => {
  const el = (e.target as Element).closest(`[${ATTR_TRANSLATION_ID}]`);
  if (el) {
    showTooltip(el);
  } else if (_tooltipEl && !_tooltipEl.contains(e.target as Node)) {
    scheduleHideTooltip(3000);
  }
});

async function retranslateElement(el: Element, withComment: boolean): Promise<{ ok: boolean; error?: string }> {
  const originalText = el.getAttribute(ATTR_ORIGINAL);
  if (!originalText) return { ok: false, error: "No original text found" };

  const previousTranslation = el.textContent || "";

  let comment: string | null = null;
  if (withComment) {
    comment = window.prompt("Enter a review note for the retranslation:");
    if (comment === null) return { ok: false, error: "Cancelled" };
  }

  // Revert the element to original text
  const idx = parseInt(el.getAttribute(ATTR_TRANSLATION_ID)!);
  pendingIndices.delete(idx);
  const parent = el.parentElement;
  if (!parent) return { ok: false, error: "Element has no parent" };
  revertTranslatingElement(el);

  // Re-extract the parent scope to get a fresh element index
  const extracted = extractTranslatableNodes(
    parent,
    siteConfig?.selector || "",
    siteConfig?.ignore || [],
    siteConfig?.priorityRules || []
  );

  // Find the re-extracted node
  const newNode = extracted.find((n) => n.text === originalText.trim());
  if (!newNode) return { ok: false, error: "Failed to re-extract element" };

  // Build instruction with previous translation for context
  const instruction = buildRetranslateInstruction(previousTranslation, comment || undefined);

  // Enqueue with skipCache so the API is called fresh
  pendingIndices.add(newNode.elementIndex);
  markElementsTranslating([newNode.elementIndex]);

  const response = await sendToBackground({
    type: "ENQUEUE",
    items: [{
      text: newNode.text,
      elementIndex: newNode.elementIndex,
      priority: newNode.priority !== Infinity ? newNode.priority : undefined,
      instruction,
      skipCache: true,
    }],
  });

  if (!response.ok) {
    pendingIndices.delete(newNode.elementIndex);
    revertTranslatingElement(newNode.element);
    return { ok: false, error: response.error || "Failed to enqueue" };
  }

  return { ok: true };
}

// ── Helpers ───────────────────────────────────

// ── Helpers ───────────────────────────────────

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const hostname = location.hostname;
  const siteKey = "site_" + hostname;

  if (changes["global_config"] || changes[siteKey]) {
    console.log("[LLM Translator] Config changed in storage, reloading site configuration...");
    reloadAndRetranslate().catch(console.error);
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch(console.error));
} else {
  init().catch(console.error);
}
