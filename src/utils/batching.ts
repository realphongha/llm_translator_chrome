// ─────────────────────────────────────────────
//  Batch builder
//  Groups paragraphs into batches by character limit
// ─────────────────────────────────────────────

export interface ParagraphItem {
  id: number;
  text: string;
}

export interface Batch {
  paragraphs: ParagraphItem[];
  /** If this batch contains a split chunk, track it */
  splitInfo?: SplitInfo[];
}

export interface SplitInfo {
  originalId: number;
  partIds: number[];
}

let _nextSplitId = 1_000_000; // IDs for split parts start high to avoid collision

function nextSplitId(): number {
  return _nextSplitId++;
}

/**
 * Splits text into chunks of at most maxChars characters,
 * attempting to split on paragraph boundaries (double newline) first,
 * then sentence boundaries, then hard cut.
 */
function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let cutAt = maxChars;

    // Try double newline
    const dnl = remaining.lastIndexOf("\n\n", maxChars);
    if (dnl > maxChars * 0.4) {
      cutAt = dnl + 2;
    } else {
      // Try single newline
      const snl = remaining.lastIndexOf("\n", maxChars);
      if (snl > maxChars * 0.4) {
        cutAt = snl + 1;
      } else {
        // Try sentence end
        const dot = remaining.lastIndexOf(". ", maxChars);
        if (dot > maxChars * 0.4) {
          cutAt = dot + 2;
        }
        // else hard cut at maxChars
      }
    }

    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Groups an array of paragraphs into batches where each batch
 * does not exceed maxChars total characters.
 *
 * Paragraphs that individually exceed maxChars are split into parts
 * with synthetic IDs. The splitInfo on each batch describes how to
 * recombine the parts back into the original paragraph.
 */
export function buildBatches(
  paragraphs: ParagraphItem[],
  maxChars: number
): { batches: Batch[]; splitMap: Map<number, SplitInfo> } {
  const batches: Batch[] = [];
  const splitMap = new Map<number, SplitInfo>(); // originalId → SplitInfo

  // Expand paragraphs that are too large
  const expanded: ParagraphItem[] = [];
  for (const p of paragraphs) {
    if (p.text.length <= maxChars) {
      expanded.push(p);
    } else {
      const parts = splitText(p.text, maxChars);
      const partIds = parts.map(nextSplitId);
      const splitInfo: SplitInfo = { originalId: p.id, partIds };
      splitMap.set(p.id, splitInfo);
      for (let i = 0; i < parts.length; i++) {
        expanded.push({ id: partIds[i], text: parts[i] });
      }
    }
  }

  // Group into batches
  let currentBatch: ParagraphItem[] = [];
  let currentChars = 0;

  for (const item of expanded) {
    if (currentChars + item.text.length > maxChars && currentBatch.length > 0) {
      batches.push({ paragraphs: currentBatch });
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(item);
    currentChars += item.text.length;
  }

  if (currentBatch.length > 0) {
    batches.push({ paragraphs: currentBatch });
  }

  return { batches, splitMap };
}
