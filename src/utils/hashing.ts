// ─────────────────────────────────────────────
//  SHA-256 hashing for cache keys
//  Uses Web Crypto API (available in SW + browser)
// ─────────────────────────────────────────────

/**
 * Produces a hex SHA-256 hash for a string.
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Produces a cache key from the components that uniquely identify a translation.
 * Key = SHA-256(systemPrompt + "\x00" + model + "\x00" + text)
 */
export async function hashForCache(
  systemPrompt: string,
  model: string,
  text: string
): Promise<string> {
  const combined = `${systemPrompt}\x00${model}\x00${text}`;
  return sha256(combined);
}
