// ─────────────────────────────────────────────
//  Text Extractor
//  Finds translatable text nodes in the DOM and wraps
//  each in a <span> so child elements are preserved.
// ─────────────────────────────────────────────

export const ATTR_TRANSLATION_ID = "data-translation-id";
export const ATTR_ORIGINAL = "data-original";
export const ATTR_STATE = "data-translation-state";

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "BUTTON", "SVG", "CANVAS", "CODE", "PRE", "KBD", "SAMP",
  "MATH", "HEAD", "LINK", "META", "TITLE",
]);

export interface ExtractedNode {
  elementIndex: number;
  text: string;
  element: Element;
}

let _extractionCounter = 0;

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
 */
export function extractTranslatableNodes(
  root: Element | Document,
  selector: string,
  ignoreSelectors: string[]
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

      const idx = ++_extractionCounter;
      const span = document.createElement("span");
      span.setAttribute(ATTR_TRANSLATION_ID, String(idx));
      span.setAttribute(ATTR_ORIGINAL, raw);
      span.setAttribute(ATTR_STATE, "waiting");
      span.textContent = raw;

      textNode.parentNode!.replaceChild(span, textNode);

      results.push({
        elementIndex: idx,
        text: raw.trim(),
        element: span,
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
