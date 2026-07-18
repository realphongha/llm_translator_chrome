// ─────────────────────────────────────────────
//  Text Extractor
//  Finds translatable text nodes in the DOM and wraps
//  each in a <span> so child elements are preserved.
// ─────────────────────────────────────────────

export const ATTR_TRANSLATION_ID = "data-translation-id";
export const ATTR_ORIGINAL = "data-original";
export const ATTR_STATE = "data-translation-state";
export const ATTR_PRIORITY = "data-priority";

import type { PriorityRule } from "../storage/config";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "BUTTON", "SVG", "CANVAS", "CODE", "PRE", "KBD", "SAMP",
  "MATH", "HEAD", "LINK", "META", "TITLE",
]);

export interface ExtractedNode {
  elementIndex: number;
  text: string;
  element: Element;
  priority: number;
}

let _extractionCounter = 0;

// ── In-session translation memory ──────────────
// Maps a translated string back to its original source text. Populated when a
// translation is applied (renderer.ts) and consulted during extraction so that
// already-translated text left behind after a framework re-render (e.g. Vue
// discarding our wrapper span) is recognized and re-attached with the correct
// data-original instead of being re-sent to the LLM as a fresh original.
const _translationMemory = new Map<string, string>();

export function rememberTranslation(original: string, translated: string): void {
  if (!original || !translated) return;
  _translationMemory.set(translated.trim(), original);
}

export function lookupOriginal(translated: string): string | undefined {
  return _translationMemory.get(translated.trim());
}

export function clearTranslationMemory(): void {
  _translationMemory.clear();
}

export function isTranslated(el: Element): boolean {
  return el.hasAttribute(ATTR_TRANSLATION_ID);
}

function isIgnored(el: Element, ignoreSelectors: string[]): boolean {
  for (const sel of ignoreSelectors) {
    if (!sel) continue;
    try {
      if (el.closest(sel)) return true;
    } catch {
    }
  }
  return false;
}

function isInSkippedContext(node: Text, ignoreSelectors: string[]): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (isIgnored(el, ignoreSelectors)) return true;
    if (el.hasAttribute(ATTR_TRANSLATION_ID)) return true;
    el = el.parentElement;
  }
  return false;
}

function computePriority(el: Element, priorityRules: PriorityRule[]): number {
  let min = Infinity;
  for (const rule of priorityRules) {
    try {
      if (el.closest(rule.selector)) {
        if (rule.priority < min) min = rule.priority;
      }
    } catch {
    }
  }
  return min;
}

/**
 * Extracts all translatable text nodes from the root.
 *
 * Each text node is wrapped in a <span data-translation-id="N">
 * so that translations can be applied without destroying child elements.
 *
 * @param root - The root element to search within
 * @param selector - Optional CSS selector. If provided, only text nodes
 *                   inside matching elements are extracted.
 * @param ignoreSelectors - CSS selectors for elements to ignore
 * @param priorityRules - Rules for assigning translation priority
 */
export function extractTranslatableNodes(
  root: Element | Document,
  selector: string,
  ignoreSelectors: string[],
  priorityRules: PriorityRule[] = []
): ExtractedNode[] {
  const results: ExtractedNode[] = [];

  const scopes: Element[] = [];
  if (selector && selector.trim()) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (SKIP_TAGS.has(el.tagName) || isTranslated(el) || isIgnored(el, ignoreSelectors)) continue;
      scopes.push(el);
    }
  } else {
    const body = root instanceof Document ? root.body : root;
    if (body) scopes.push(body);
  }

  const seen = new Set<Node>();

  for (const scope of scopes) {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode as Text;
      if (!seen.has(tn)) {
        seen.add(tn);
        textNodes.push(tn);
      }
    }

    for (const textNode of textNodes) {
      const raw = (textNode.textContent ?? "").replace(/ ⟳$/, "");
      const trimmed = raw.trim();
      if (trimmed.length <= 0) continue;
      if (!/\p{L}/u.test(trimmed)) continue;
      if (isInSkippedContext(textNode, ignoreSelectors)) continue;

      // If this text is already one of our translations (left behind after a
      // framework re-render dropped our wrapper span), re-attach it with the
      // correct original instead of re-translating it as a fresh source.
      const knownOriginal = lookupOriginal(trimmed);
      if (knownOriginal !== undefined) {
        const idx = ++_extractionCounter;
        const span = document.createElement("span");
        span.setAttribute(ATTR_TRANSLATION_ID, String(idx));
        span.setAttribute(ATTR_ORIGINAL, knownOriginal);
        span.setAttribute(ATTR_STATE, "translated");
        span.textContent = raw;
        textNode.parentNode!.replaceChild(span, textNode);
        // Do NOT add to results — no LLM call needed; it's already translated.
        continue;
      }

      const idx = ++_extractionCounter;

      // Compute priority from the parent element *before* replacing the text
      // node — the parent is already in the DOM so el.closest() works correctly.
      // A freshly-created span that hasn't been inserted yet would always return
      // null from closest(), making every node get priority = Infinity.
      const priority = computePriority(textNode.parentElement!, priorityRules);

      const span = document.createElement("span");
      span.setAttribute(ATTR_TRANSLATION_ID, String(idx));
      span.setAttribute(ATTR_ORIGINAL, raw);
      span.setAttribute(ATTR_STATE, "waiting");
      span.textContent = raw;

      if (priority !== Infinity) {
        span.setAttribute(ATTR_PRIORITY, String(priority));
      }

      textNode.parentNode!.replaceChild(span, textNode);

      results.push({
        elementIndex: idx,
        text: raw.trim(),
        element: span,
        priority,
      });
    }
  }

  return results;
}

export function findElementByIndex(index: number): Element | null {
  return document.querySelector(`[${ATTR_TRANSLATION_ID}="${index}"]`);
}

/**
 * Restores all translated elements back to their original text,
 * unwrapping the <span> wrappers so re-extraction starts fresh.
 */
export function restoreOriginals(): void {
  const translated = document.querySelectorAll(`[${ATTR_TRANSLATION_ID}]`);
  for (const el of translated) {
    const original = el.getAttribute(ATTR_ORIGINAL);
    if (original !== null) {
      const textNode = document.createTextNode(original);
      el.parentNode?.replaceChild(textNode, el);
    } else {
      el.removeAttribute(ATTR_TRANSLATION_ID);
      el.removeAttribute(ATTR_ORIGINAL);
      el.removeAttribute(ATTR_STATE);
    }
  }
}
