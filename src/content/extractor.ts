// ─────────────────────────────────────────────
//  Text Extractor
//  Finds translatable text nodes in the DOM and wraps
//  each in a <span> so child elements are preserved.
// ─────────────────────────────────────────────

export const ATTR_TRANSLATION_ID = "data-translation-id";
export const ATTR_ORIGINAL = "data-original";
export const ATTR_STATE = "data-translation-state";
export const ATTR_PRIORITY = "data-priority";

// Virtual targets (page title / tooltip title attributes) are not DOM text
// nodes, so originals/translations are stashed on the target element itself.
export const ATTR_ORIGINAL_TITLE = "data-llt-original-title";
export const ATTR_TRANSLATED_TITLE = "data-llt-translated-title";
export const ATTR_TTL_MODIFIED = "data-llt-tooltip";

import type { PriorityRule } from "../storage/config";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "BUTTON", "SVG", "CANVAS", "CODE", "PRE", "KBD", "SAMP",
  "MATH", "HEAD", "LINK", "META", "TITLE",
]);

const CHUNK_SIZE = 200;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface ExtractedNode {
  elementIndex: number;
  text: string;
  element: Element;
  priority: number;
}

let _extractionCounter = 0;

// ── Virtual targets (page title + tooltip titles) ──
// Keyed by the same elementIndex counter used for text spans, so results from
// the background flow back through the normal renderer path. The renderer
// consults this registry before treating the index as a DOM text span.

export interface VirtualTarget {
  kind: "title" | "attr";
  el?: Element;
  attr?: string;
}

const _virtualTargets = new Map<number, VirtualTarget>();
let _titleIndex: number | null = null;

export function getVirtualTarget(index: number): VirtualTarget | null {
  return _virtualTargets.get(index) ?? null;
}

export function isVirtualNode(index: number): boolean {
  return _virtualTargets.has(index);
}

export function allVirtualTargets(): Array<[number, VirtualTarget]> {
  return Array.from(_virtualTargets.entries());
}

// ── In-session translation memory ──────────────
// Maps a translated string back to its original source text. Populated when a
// translation is applied (renderer.ts) and consulted during extraction so that
// already-translated text left behind after a framework re-render (e.g. Vue
// discarding our wrapper span) is recognized and re-attached with the correct
// data-original instead of being re-sent to the LLM as a fresh original.

const MAX_MEMORY_ENTRIES = 10_000;

class BoundedMap {
  private map = new Map<string, string>();
  constructor(private max: number) {}
  get(key: string): string | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, value);
  }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

const _translationMemory = new BoundedMap(MAX_MEMORY_ENTRIES);

export function rememberTranslation(original: string, translated: string): void {
  if (!original || !translated) return;
  _translationMemory.set(translated.trim(), original);
}

export function lookupOriginal(translated: string): string | undefined {
  return _translationMemory.get(translated.trim());
}

export function clearTranslationMemory(): void {
  _translationMemory.clear();
  _extractionCounter = 0;
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
    if (isExtensionUi(el)) return true;
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
 * Phase 1: Pre-collect all qualifying text nodes (read-only, fast TreeWalker).
 * Phase 2: Process in chunks, yielding to the event loop between chunks,
 *          so the main thread stays responsive.
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
export async function extractTranslatableNodes(
  root: Element | Document,
  selector: string,
  ignoreSelectors: string[],
  priorityRules: PriorityRule[] = []
): Promise<ExtractedNode[]> {
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

  // ── Phase 1: Pre-collect text nodes (read-only, no DOM mutations) ───

  const pending: Array<{
    textNode: Text;
    raw: string;
    knownOriginal: string | undefined;
    priority: number;
  }> = [];

  const seen = new Set<Node>();

  for (const scope of scopes) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode as Text;
      if (seen.has(tn)) continue;
      seen.add(tn);

      const raw = (tn.textContent ?? "").replace(/ ⟳$/, "");
      const trimmed = raw.trim();
      if (trimmed.length <= 0) continue;
      if (!/\p{L}/u.test(trimmed)) continue;
      if (isInSkippedContext(tn, ignoreSelectors)) continue;

      // Compute priority from the parent element *before* replacing the text
      // node — the parent is already in the DOM so el.closest() works correctly.
      // A freshly-created span that hasn't been inserted yet would always return
      // null from closest(), making every node get priority = Infinity.
      const priority = computePriority(tn.parentElement!, priorityRules);

      const knownOriginal = lookupOriginal(trimmed);

      pending.push({ textNode: tn, raw, knownOriginal, priority });
    }
  }

  // ── Phase 2: Process in chunks (DOM mutations, yields between chunks) ───

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE);

    for (const { textNode, raw, knownOriginal, priority } of chunk) {
      if (knownOriginal !== undefined) {
        // Text left behind after a framework re-render — re-attach with the
        // correct original instead of re-translating it as a fresh source.
        const idx = ++_extractionCounter;
        const span = document.createElement("span");
        span.setAttribute(ATTR_TRANSLATION_ID, String(idx));
        span.setAttribute(ATTR_ORIGINAL, knownOriginal);
        span.setAttribute(ATTR_STATE, "translated");
        span.textContent = raw;
        textNode.parentNode!.replaceChild(span, textNode);
        continue;
      }

      const idx = ++_extractionCounter;
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

    await yieldToMain();
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

// ── Virtual targets (page title + tooltips) ───

// The extension's own UI must never be treated as a translation target —
// neither as a tooltip title attribute nor as translatable body text.
const EXTENSION_UI_SELECTORS = [
  "#llt-floating-bar",
  "#llt-tooltip",
  "#llt-bar-tooltip",
  "#llt-detail",
];

function isExtensionUi(el: Element): boolean {
  for (const sel of EXTENSION_UI_SELECTORS) {
    try {
      if (el.closest(sel)) return true;
    } catch {
    }
  }
  try {
    if (el.closest(".llt-state")) return true;
  } catch {
  }
  return false;
}

function isExtensionTooltip(el: Element): boolean {
  return isExtensionUi(el);
}

/**
 * Extracts the current page title (shown in the tab) as a virtual target.
 * No-op unless the title actually changed from what we last recorded, so it can
 * be called on every scan (including SPA navigation) without re-translating.
 */
export function extractPageTitle(ignoreSelectors: string[]): ExtractedNode | null {
  const titleEl = document.querySelector("title");
  if (!titleEl) return null;

  const current = (document.title ?? "").trim();
  if (!current || !/\p{L}/u.test(current)) return null;

  const original = titleEl.getAttribute(ATTR_ORIGINAL_TITLE);
  const translated = titleEl.getAttribute(ATTR_TRANSLATED_TITLE);
  if (original !== null) {
    if (current === original || current === translated) return null;
    // The site replaced the title (e.g. SPA navigation) — re-register it.
    titleEl.removeAttribute(ATTR_ORIGINAL_TITLE);
    titleEl.removeAttribute(ATTR_TRANSLATED_TITLE);
    titleEl.removeAttribute(ATTR_STATE);
    titleEl.removeAttribute("data-showing-original");
    if (_titleIndex !== null) _virtualTargets.delete(_titleIndex);
    _titleIndex = null;
  }

  const idx = ++_extractionCounter;
  _titleIndex = idx;
  titleEl.setAttribute(ATTR_ORIGINAL_TITLE, current);
  _virtualTargets.set(idx, { kind: "title", el: titleEl });

  return { elementIndex: idx, text: current, element: titleEl, priority: 1 };
}

/**
 * Extracts every element with a non-empty `title` attribute (native hover
 * tooltips) as a virtual target, excluding the extension's own UI and content
 * that is already part of the text pipeline.
 */
export function extractTooltipTargets(
  root: Element | Document,
  ignoreSelectors: string[]
): ExtractedNode[] {
  const results: ExtractedNode[] = [];
  const body = root instanceof Document ? root.body : root;
  if (!body) return results;

  const els = body.querySelectorAll<Element>("[title]");
  for (const el of els) {
    if (el.hasAttribute(ATTR_TTL_MODIFIED)) continue;
    if (el.hasAttribute(ATTR_TRANSLATION_ID)) continue;
    if (el.closest(`[${ATTR_TRANSLATION_ID}]`)) continue;
    if (isExtensionTooltip(el)) continue;
    if (isIgnored(el, ignoreSelectors)) continue;

    const title = (el.getAttribute("title") ?? "").trim();
    if (!title || !/\p{L}/u.test(title)) continue;

    const idx = ++_extractionCounter;
    el.setAttribute(ATTR_TTL_MODIFIED, "true");
    el.setAttribute(ATTR_ORIGINAL_TITLE, title);
    _virtualTargets.set(idx, { kind: "attr", el, attr: "title" });

    results.push({ elementIndex: idx, text: title, element: el, priority: Infinity });
  }
  return results;
}

/**
 * Extracts both the page title and tooltip title attributes within root.
 */
export function extractTitleAndTooltips(
  root: Element | Document,
  ignoreSelectors: string[]
): ExtractedNode[] {
  const results: ExtractedNode[] = [];
  const titleNode = extractPageTitle(ignoreSelectors);
  if (titleNode) results.push(titleNode);
  results.push(...extractTooltipTargets(root, ignoreSelectors));
  return results;
}

/**
 * Restores the page title and every tooltip title attribute back to their
 * originals and clears the virtual-target registry. Used by Retranslate/revert.
 */
export function restoreVirtualTargets(): void {
  const titleEl = document.querySelector("title");
  if (titleEl) {
    const original = titleEl.getAttribute(ATTR_ORIGINAL_TITLE);
    if (original !== null) document.title = original;
    titleEl.removeAttribute(ATTR_ORIGINAL_TITLE);
    titleEl.removeAttribute(ATTR_TRANSLATED_TITLE);
    titleEl.removeAttribute(ATTR_STATE);
    titleEl.removeAttribute("data-showing-original");
  }

  for (const [, target] of _virtualTargets) {
    if (target.kind === "attr" && target.el) {
      const attr = target.attr!;
      const original = target.el.getAttribute(ATTR_ORIGINAL_TITLE);
      if (original !== null) target.el.setAttribute(attr, original);
      target.el.removeAttribute(ATTR_ORIGINAL_TITLE);
      target.el.removeAttribute(ATTR_TRANSLATED_TITLE);
      target.el.removeAttribute(ATTR_TTL_MODIFIED);
      target.el.removeAttribute(ATTR_STATE);
      target.el.removeAttribute("data-showing-original");
    }
  }

  _virtualTargets.clear();
  _titleIndex = null;
}
