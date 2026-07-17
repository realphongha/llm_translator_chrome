// ─────────────────────────────────────────────
//  Text Extractor
//  Finds translatable nodes in the DOM
// ─────────────────────────────────────────────

/** Attribute used to mark elements as translated */
export const ATTR_TRANSLATION_ID = "data-translation-id";
export const ATTR_ORIGINAL = "data-original";
export const ATTR_STATE = "data-translation-state";

/** Tags whose content should never be translated */
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

/**
 * Tests if an element has meaningful text (not just whitespace).
 */
function hasMeaningfulText(el: Element): boolean {
  const text = el.textContent?.trim() ?? "";
  return text.length > 1; // at least 2 chars
}

/**
 * Tests if an element is already translated.
 */
export function isTranslated(el: Element): boolean {
  return el.hasAttribute(ATTR_TRANSLATION_ID);
}

/**
 * Tests if an element matches any of the ignore selectors.
 */
function isIgnored(el: Element, ignoreSelectors: string[]): boolean {
  for (const sel of ignoreSelectors) {
    if (!sel) continue;
    try {
      if (el.closest(sel)) return true;
    } catch {
      // Invalid selector — skip
    }
  }
  return false;
}

/**
 * Extracts all translatable elements from the root.
 *
 * @param root - The root element to search within
 * @param selector - Optional CSS selector. If provided, uses querySelectorAll.
 *                   If empty, walks the tree and finds leaf text nodes.
 * @param ignoreSelectors - CSS selectors for elements to ignore
 */
export function extractTranslatableNodes(
  root: Element | Document,
  selector: string,
  ignoreSelectors: string[]
): ExtractedNode[] {
  const results: ExtractedNode[] = [];

  if (selector && selector.trim()) {
    // Use provided selector
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (
        SKIP_TAGS.has(el.tagName) ||
        isTranslated(el) ||
        !hasMeaningfulText(el) ||
        isIgnored(el, ignoreSelectors)
      ) {
        continue;
      }
      const idx = ++_extractionCounter;
      el.setAttribute(ATTR_TRANSLATION_ID, String(idx));
      el.setAttribute(ATTR_STATE, "waiting");
      results.push({
        elementIndex: idx,
        text: el.textContent!.trim(),
        element: el,
      });
    }
  } else {
    // Smart extraction: find block-level leaf elements with text
    walkForTranslatableLeaves(root, ignoreSelectors, results);
  }

  return results;
}

/**
 * Walks the DOM tree looking for elements that contain text
 * and whose children do not themselves contain meaningful text.
 * These are the "leaf" text containers.
 */
function walkForTranslatableLeaves(
  node: Element | Document,
  ignoreSelectors: string[],
  results: ExtractedNode[]
): void {
  const BLOCK_TAGS = new Set([
    "P", "DIV", "ARTICLE", "SECTION", "LI", "TD", "TH",
    "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE",
    "FIGCAPTION", "CAPTION", "DT", "DD", "SUMMARY",
  ]);

  const children = node instanceof Document
    ? Array.from(node.body?.children ?? [])
    : Array.from(node.children);

  for (const child of children) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (isTranslated(child)) continue;
    if (isIgnored(child, ignoreSelectors)) continue;

    const isBlock = BLOCK_TAGS.has(child.tagName);
    const hasBlockChildren = Array.from(child.children).some(
      (c) => BLOCK_TAGS.has(c.tagName)
    );

    if (isBlock && !hasBlockChildren && hasMeaningfulText(child)) {
      const idx = ++_extractionCounter;
      child.setAttribute(ATTR_TRANSLATION_ID, String(idx));
      child.setAttribute(ATTR_STATE, "waiting");
      results.push({
        elementIndex: idx,
        text: child.textContent!.trim(),
        element: child,
      });
    } else {
      walkForTranslatableLeaves(child, ignoreSelectors, results);
    }
  }
}

/**
 * Finds an already-marked element by its translation ID.
 */
export function findElementByIndex(index: number): Element | null {
  return document.querySelector(`[${ATTR_TRANSLATION_ID}="${index}"]`);
}

/**
 * Restores all translated elements back to their original text,
 * removing translation markers so they can be re-translated.
 */
export function restoreOriginals(): void {
  const translated = document.querySelectorAll(`[${ATTR_TRANSLATION_ID}]`);
  for (const el of translated) {
    const original = el.getAttribute(ATTR_ORIGINAL);
    if (original !== null) {
      el.textContent = original;
    }
    el.removeAttribute(ATTR_TRANSLATION_ID);
    el.removeAttribute(ATTR_ORIGINAL);
    el.removeAttribute(ATTR_STATE);
    // Remove state indicator if present
    el.querySelector(".llt-state")?.remove();
  }
}
