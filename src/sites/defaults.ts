// ─────────────────────────────────────────────
//  Site Defaults
//  Built-in profiles for well-known sites
// ─────────────────────────────────────────────

import type { SiteConfig } from "../storage/config";

type SitePreset = Omit<SiteConfig, "hostname">;

const SITE_PRESETS: Record<string, SitePreset> = {
  "qidian.com": {
    mode: "off",
    prompt: "qidian-vn",
    sourceLanguage: "Chinese (Simplified)",
    targetLanguage: "Vietnamese",
    observe: ".article-wrapper",
    selector: ".article-wrapper p",
    ignore: [".comment-wrap", ".ads-area", ".qd_GamePlatform"],
    priorityRules: [{ selector: ".article-wrapper p", priority: 1 }],
  },
  "m.qidian.com": {
    mode: "off",
    prompt: "qidian-vn",
    sourceLanguage: "Chinese (Simplified)",
    targetLanguage: "Vietnamese",
    observe: ".read-content",
    selector: ".read-content p",
    ignore: [],
    priorityRules: [{ selector: ".read-content p", priority: 1 }],
  },
  "www.novelupdates.com": {
    mode: "off",
    prompt: "general",
    sourceLanguage: "Auto",
    targetLanguage: "Vietnamese",
    observe: "body",
    selector: "",
    ignore: [".navbar", "footer", ".sidebar"],
    priorityRules: [],
  },
  "fanyi.baidu.com": {
    mode: "off",
    prompt: "general",
    sourceLanguage: "Auto",
    targetLanguage: "English",
    observe: "body",
    selector: "",
    ignore: [],
    priorityRules: [],
  },
};

const DEFAULT_PRESET: SitePreset = {
  mode: "off",
  prompt: "general",
  sourceLanguage: "Auto",
  targetLanguage: "English",
  observe: "body",
  selector: "",
  ignore: [],
  priorityRules: [],
};

/**
 * Returns the default site config for a given hostname.
 * Checks for exact match and then domain suffix match.
 */
export function getDefaultSitePreset(hostname: string): SitePreset {
  // Exact match
  if (SITE_PRESETS[hostname]) return SITE_PRESETS[hostname];

  // Try removing www.
  const withoutWww = hostname.replace(/^www\./, "");
  if (SITE_PRESETS[withoutWww]) return SITE_PRESETS[withoutWww];

  // Domain suffix match (e.g. "chapter.qidian.com" → "qidian.com")
  for (const [domain, preset] of Object.entries(SITE_PRESETS)) {
    if (hostname.endsWith("." + domain) || hostname === domain) {
      return preset;
    }
  }

  return DEFAULT_PRESET;
}

/**
 * Creates a new SiteConfig for a hostname, merging defaults with site preset.
 */
export function createDefaultSiteConfig(hostname: string): SiteConfig {
  const preset = getDefaultSitePreset(hostname);
  return { hostname, ...preset };
}

export const ALL_SITE_PRESETS = Object.keys(SITE_PRESETS);
