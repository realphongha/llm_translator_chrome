// ─────────────────────────────────────────────
//  Renderer
//  Applies translations to the DOM
// ─────────────────────────────────────────────

import {
  ATTR_ORIGINAL,
  ATTR_STATE,
  ATTR_TRANSLATION_ID,
  findElementByIndex,
} from "./extractor";
import type { TranslationResult } from "../background/queue";

/**
 * Marks an element as "translating" with a spinner indicator.
 */
export function markTranslating(el: Element): void {
  el.setAttribute(ATTR_STATE, "translating");
  // Add a subtle indicator without changing the text
  ensureStateIndicator(el, "translating");
}

/**
 * Applies a translation to the element matching elementIndex.
 * Stores the original text in data-original for retranslation.
 */
export function applyTranslation(result: TranslationResult): void {
  const el = findElementByIndex(result.elementIndex);
  if (!el) return;

  if (result.state === "translated" && result.translation) {
    // Save original before first translation
    if (!el.hasAttribute(ATTR_ORIGINAL)) {
      el.setAttribute(ATTR_ORIGINAL, el.textContent ?? "");
    }

    // Replace text content
    el.textContent = result.translation;
    el.setAttribute(ATTR_STATE, "translated");
    ensureStateIndicator(el, "translated");
  } else if (result.state === "error") {
    el.setAttribute(ATTR_STATE, "error");
    ensureStateIndicator(el, "error");
  }
}

/**
 * Applies a batch of translation results.
 */
export function applyTranslations(results: TranslationResult[]): void {
  for (const result of results) {
    applyTranslation(result);
  }
}

/**
 * Marks elements as waiting/translating by their indices.
 */
export function markElementsTranslating(indices: number[]): void {
  for (const idx of indices) {
    const el = findElementByIndex(idx);
    if (el) markTranslating(el);
  }
}

// ── State indicator ───────────────────────────

type StateType = "waiting" | "translating" | "translated" | "error";

function ensureStateIndicator(el: Element, state: StateType): void {
  // Remove existing indicator
  el.querySelector(".llt-state")?.remove();

  const span = document.createElement("span");
  span.className = "llt-state";

  switch (state) {
    case "translating":
      span.textContent = " ⟳";
      span.title = "Translating…";
      span.style.cssText = `
        color: #7c9ef0;
        font-size: 0.75em;
        opacity: 0.7;
        animation: llt-spin 1s linear infinite;
        display: inline-block;
        margin-left: 2px;
      `;
      break;
    case "translated":
      // No visible indicator for clean look — just attribute
      return;
    case "error":
      span.textContent = " ⚠";
      span.title = "Translation failed";
      span.style.cssText = `
        color: #f07c7c;
        font-size: 0.75em;
        opacity: 0.8;
        margin-left: 2px;
      `;
      break;
    default:
      return;
  }

  el.appendChild(span);
}

// ── Inject global styles ──────────────────────

export function injectStyles(): void {
  if (document.getElementById("llt-styles")) return;

  const style = document.createElement("style");
  style.id = "llt-styles";
  style.textContent = `
    @keyframes llt-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    [data-translation-state="translating"] {
      opacity: 0.7;
      transition: opacity 0.2s ease;
    }

    [data-translation-state="translated"] {
      opacity: 1;
    }

    [data-translation-state="error"] {
      text-decoration: underline wavy #f07c7c;
    }

    .llt-state {
      user-select: none;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}
