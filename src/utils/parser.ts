// ─────────────────────────────────────────────
//  Response Parser
//  Maps <ID=N> tagged LLM output back to a dict
// ─────────────────────────────────────────────

/**
 * Parses the LLM response into a map of id → translated text.
 *
 * Expected format (the LLM should mirror the user prompt format):
 *
 *   <ID=1>
 *   Translated paragraph one...
 *
 *   <ID=2>
 *   Translated paragraph two...
 */
export function parseTranslationResponse(
  response: string
): Map<number, string> {
  const result = new Map<number, string>();

  // Split on <ID=N> markers
  // Pattern matches <ID=123> with optional surrounding whitespace
  const idPattern = /<ID=(\d+)>/gi;

  const parts: { id: number; startIdx: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = idPattern.exec(response)) !== null) {
    parts.push({ id: parseInt(match[1], 10), startIdx: match.index + match[0].length });
  }

  for (let i = 0; i < parts.length; i++) {
    const { id, startIdx } = parts[i];
    const endIdx = i + 1 < parts.length ? parts[i + 1].startIdx - parts[i + 1].id.toString().length - 5 : response.length;
    // More robust: find the next <ID= tag position
    const nextTagPos = i + 1 < parts.length
      ? response.indexOf("<ID=", startIdx)
      : response.length;

    const text = response.slice(startIdx, nextTagPos).trim();
    if (text.length > 0) {
      result.set(id, text);
    }
  }

  return result;
}

/**
 * Merges split paragraph parts back into a single translation.
 *
 * @param translations - Map of id → translation (may contain split part IDs)
 * @param splitMap - Map of originalId → { partIds }
 */
export function mergeSplitTranslations(
  translations: Map<number, string>,
  splitMap: Map<number, { originalId: number; partIds: number[] }>
): Map<number, string> {
  const merged = new Map(translations);

  for (const [originalId, splitInfo] of splitMap) {
    const parts = splitInfo.partIds.map((pid) => translations.get(pid) ?? "");
    if (parts.some((p) => p.length > 0)) {
      merged.set(originalId, parts.join("\n\n"));
      // Remove split parts from the map
      for (const pid of splitInfo.partIds) {
        merged.delete(pid);
      }
    }
  }

  return merged;
}
