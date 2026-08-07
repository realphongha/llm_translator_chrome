// ─────────────────────────────────────────────
//  Renderer
//  Applies translations to the DOM
// ─────────────────────────────────────────────

import {
  ATTR_ORIGINAL,
  ATTR_STATE,
  ATTR_TRANSLATION_ID,
  ATTR_ORIGINAL_TITLE,
  ATTR_TRANSLATED_TITLE,
  findElementByIndex,
  getVirtualTarget,
  allVirtualTargets,
  rememberTranslation,
} from "./extractor";
import type { VirtualTarget } from "./extractor";
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
  // Virtual targets (page title + tooltip title attributes) have no
  // data-translation-id in the DOM, so resolve them before findElementByIndex.
  const virtual = getVirtualTarget(result.elementIndex);
  if (virtual) {
    if (result.state === "translated" && result.translation) {
      applyVirtualTranslation(virtual, result.translation);
    }
    return;
  }

  const el = findElementByIndex(result.elementIndex);
  if (!el) {
    return;
  }

  if (result.state === "translated") {
    const text = result.translation || el.getAttribute(ATTR_ORIGINAL);
    if (text == null) return;

    el.textContent = text;
    el.setAttribute(ATTR_STATE, "translated");
    ensureStateIndicator(el, "translated");

    // Remember the mapping so already-translated text left behind after a
    // framework re-render can be recognized and re-attached with the correct
    // data-original instead of being re-translated.
    const original = el.getAttribute(ATTR_ORIGINAL);
    if (original !== null) rememberTranslation(original, text);
  } else if (result.state === "error") {
    el.setAttribute(ATTR_STATE, "error");
    ensureStateIndicator(el, "error");
  }
}

/**
 * Applies a translation to a virtual target (page title or tooltip attribute).
 */
function applyVirtualTranslation(target: VirtualTarget, translation: string): void {
  const el = target.el;
  if (!el) return;
  if (target.kind === "title") {
    el.setAttribute(ATTR_TRANSLATED_TITLE, translation);
    document.title = translation;
    el.setAttribute(ATTR_STATE, "translated");
  } else {
    const attr = target.attr ?? "title";
    el.setAttribute(attr, translation);
    el.setAttribute(ATTR_STATE, "translated");
  }
}

/**
 * Reverts a stuck translating element back to its original text node,
 * removing all translation-related attributes and the spinner.
 */
export function revertTranslatingElement(el: Element): void {
  el.querySelector(".llt-state")?.remove();

  // Use data-original (captured before any spinner existed).
  // Sanitize trailing spinner character that previous buggy versions
  // may have baked into the attribute.
  const text = (el.getAttribute(ATTR_ORIGINAL) ?? el.textContent ?? "").replace(/ ⟳$/, "");

  el.removeAttribute(ATTR_TRANSLATION_ID);
  el.removeAttribute(ATTR_ORIGINAL);
  el.removeAttribute(ATTR_STATE);

  const textNode = document.createTextNode(text);
  el.parentNode?.replaceChild(textNode, el);
}

/**
 * Scans the DOM for any elements still stuck in "translating" state
 * and reverts them. Called as a safety net when the queue is empty
 * and no results are pending.
 */
/** Returns the number of reverted elements. */
export function revertStuckElements(): number {
  const selector = `[${ATTR_STATE}="translating"]`;
  const stuck = document.querySelectorAll(selector);
  for (const el of stuck) {
    const id = el.getAttribute(ATTR_TRANSLATION_ID);
    console.warn(`[LLM Translator] Cleanup: reverting stuck element #${id}`);
    revertTranslatingElement(el);
  }
  return stuck.length;
}

/**
 * Toggles between the translated text and original text for an element.
 * Stores the translation in data-translated when showing original.
 */
export function toggleOriginal(index: number): boolean {
  const el = findElementByIndex(index);
  if (!el) return false;
  const original = el.getAttribute(ATTR_ORIGINAL);
  if (original == null) return false;

  if (el.getAttribute("data-showing-original") === "true") {
    const translated = el.getAttribute("data-translated");
    if (!translated) return false;
    if (translated === original) {
      // Same text on both sides — no visual change, just clean up
      el.removeAttribute("data-translated");
      el.removeAttribute("data-showing-original");
      el.setAttribute(ATTR_STATE, "translated");
      return true;
    }
    el.textContent = translated;
    el.removeAttribute("data-translated");
    el.removeAttribute("data-showing-original");
    el.setAttribute(ATTR_STATE, "translated");
  } else {
    const translated = el.textContent || "";
    if (translated === original) return true; // nothing to toggle
    el.setAttribute("data-translated", translated);
    el.textContent = original;
    el.setAttribute("data-showing-original", "true");
    el.setAttribute(ATTR_STATE, "waiting");
  }
  return true;
}

/**
 * Page-wide toggle between original (source) and translated text for all
 * translated elements. Non-destructive: current text is stashed in
 * data-translated when showing original, and restored on toggle back. No LLM
 * calls are made.
 *
 * @returns true if the page is now showing ORIGINAL text, false if showing
 *          translated text.
 */
export function toggleAllOriginal(): boolean {
  const els = document.querySelectorAll(
    `[${ATTR_TRANSLATION_ID}][${ATTR_ORIGINAL}]`
  );
  // Determine current state: if any element is currently showing original,
  // treat the page as "showing original" and toggle everything back.
  const showingOriginal = document.querySelector('[data-showing-original="true"]') !== null;

  for (const el of els) {
    const original = el.getAttribute(ATTR_ORIGINAL);
    if (original == null) continue;

    if (showingOriginal) {
      const translated = el.getAttribute("data-translated");
      if (translated != null) el.textContent = translated;
      el.removeAttribute("data-translated");
      el.removeAttribute("data-showing-original");
      el.setAttribute(ATTR_STATE, "translated");
    } else {
      const current = el.textContent || "";
      if (current === original) continue; // nothing to swap
      el.setAttribute("data-translated", current);
      el.textContent = original;
      el.setAttribute("data-showing-original", "true");
      el.setAttribute(ATTR_STATE, "waiting");
    }
  }

  // Virtual targets: page title + tooltip title attributes.
  for (const [, target] of allVirtualTargets()) {
    if (target.kind === "title") {
      toggleTitleTarget(target, showingOriginal);
    } else {
      toggleAttrTarget(target, showingOriginal);
    }
  }

  return !showingOriginal;
}

/**
 * Swaps a tooltip title attribute between translated and original text.
 */
function toggleAttrTarget(target: VirtualTarget, showingOriginal: boolean): void {
  const el = target.el;
  const attr = target.attr ?? "title";
  if (!el) return;

  if (showingOriginal) {
    const translated = el.getAttribute(ATTR_TRANSLATED_TITLE);
    if (translated != null) el.setAttribute(attr, translated);
    el.removeAttribute(ATTR_TRANSLATED_TITLE);
    el.removeAttribute("data-showing-original");
    el.setAttribute(ATTR_STATE, "translated");
  } else {
    const original = el.getAttribute(ATTR_ORIGINAL_TITLE);
    const current = el.getAttribute(attr) || "";
    if (original == null || current === original) return;
    el.setAttribute(ATTR_TRANSLATED_TITLE, current);
    el.setAttribute(attr, original);
    el.setAttribute("data-showing-original", "true");
    el.setAttribute(ATTR_STATE, "waiting");
  }
}

/**
 * Swaps the page title (tab name) between translated and original text.
 */
function toggleTitleTarget(target: VirtualTarget, showingOriginal: boolean): void {
  const el = target.el;
  if (!el) return;

  if (showingOriginal) {
    const translated = el.getAttribute(ATTR_TRANSLATED_TITLE);
    if (translated != null) document.title = translated;
    el.removeAttribute(ATTR_TRANSLATED_TITLE);
    el.removeAttribute("data-showing-original");
    el.setAttribute(ATTR_STATE, "translated");
  } else {
    const original = el.getAttribute(ATTR_ORIGINAL_TITLE);
    const current = document.title || "";
    if (original == null || current === original) return;
    el.setAttribute(ATTR_TRANSLATED_TITLE, current);
    document.title = original;
    el.setAttribute("data-showing-original", "true");
    el.setAttribute(ATTR_STATE, "waiting");
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
