// ─────────────────────────────────────────────
//  Storage / Configuration module
//  All settings live in chrome.storage.local
// ─────────────────────────────────────────────

export interface ApiConfig {
  base: string;
  key: string;
  model: string;
  parallelCalls: number;
  chunkSize: number;
  timeout: number; // seconds
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  chat_template_kwargs?: Record<string, unknown>;
}

export interface TranslationConfig {
  maxChars: number;
  retryCount: number;
}

export interface CacheConfig {
  maxMb: number;
}

export interface GlobalConfig {
  api: ApiConfig;
  translation: TranslationConfig;
  cache: CacheConfig;
  /** Custom user-created prompts keyed by id */
  userPrompts: Record<string, UserPrompt>;
}

export interface UserPrompt {
  id: string;
  name: string;
  systemPrompt: string;
  /** null = use shared user prompt template */
  userPrompt: string | null;
}

export interface PriorityRule {
  selector: string;
  priority: number; // lower = higher priority (1 = highest)
}

export type SiteMode = "off" | "on" | "auto";

export interface SiteConfig {
  hostname: string;
  /** @deprecated use `mode` instead */
  enabled?: boolean;
  /** Translation mode: off = do nothing, on = manual (floating bar), auto = auto-translate on load */
  mode: SiteMode;
  /** id of built-in or user prompt */
  prompt: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** CSS selector of the container to observe */
  observe: string;
  /** CSS selector for translatable paragraphs (empty = smart extract) */
  selector: string;
  /** CSS selectors to ignore */
  ignore: string[];
  /** Priority rules for translation ordering */
  priorityRules: PriorityRule[];
}

// ── Defaults ─────────────────────────────────

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  api: {
    base: "",
    key: "",
    model: "",
    parallelCalls: 8,
    chunkSize: 8,
    timeout: 60,
    temperature: 0.1,
  },
  translation: {
    maxChars: 4000,
    retryCount: 3,
  },
  cache: {
    maxMb: 7,
  },
  userPrompts: {},
};

export const DEFAULT_SITE_CONFIG: Omit<SiteConfig, "hostname"> = {
  mode: "off",
  prompt: "general",
  sourceLanguage: "Auto",
  targetLanguage: "English",
  observe: "body",
  selector: "",
  ignore: [],
  priorityRules: [],
};

// ── Storage keys ─────────────────────────────

const GLOBAL_KEY = "global_config";
const SITE_PREFIX = "site_";

// ── Load / Save ───────────────────────────────

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const result = await chrome.storage.local.get(GLOBAL_KEY);
  const stored = result[GLOBAL_KEY] as Partial<GlobalConfig> | undefined;
  if (!stored) return { ...DEFAULT_GLOBAL_CONFIG };

  return {
    api: { ...DEFAULT_GLOBAL_CONFIG.api, ...stored.api },
    translation: { ...DEFAULT_GLOBAL_CONFIG.translation, ...stored.translation },
    cache: { ...DEFAULT_GLOBAL_CONFIG.cache, ...stored.cache },
    userPrompts: stored.userPrompts ?? {},
  };
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await chrome.storage.local.set({ [GLOBAL_KEY]: config });
}

export async function loadSiteConfig(hostname: string): Promise<SiteConfig> {
  const key = SITE_PREFIX + hostname;
  const result = await chrome.storage.local.get(key);
  const stored = result[key] as SiteConfig | undefined;
  if (stored) {
    // Migrate legacy boolean `enabled` to the new `mode` field.
    if (stored.mode === undefined && stored.enabled !== undefined) {
      stored.mode = stored.enabled ? "auto" : "off";
    }
    if (stored.mode === undefined) stored.mode = "off";
    return stored;
  }

  // Auto-create on first visit using site defaults from sites/defaults.ts
  // The caller is responsible for applying site-specific defaults
  return { hostname, ...DEFAULT_SITE_CONFIG };
}

export async function saveSiteConfig(config: SiteConfig): Promise<void> {
  const key = SITE_PREFIX + config.hostname;
  await chrome.storage.local.set({ [key]: config });
}

export async function loadAllSiteConfigs(): Promise<SiteConfig[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(SITE_PREFIX))
    .map(([, v]) => v as SiteConfig);
}

export async function deleteSiteConfig(hostname: string): Promise<void> {
  await chrome.storage.local.remove(SITE_PREFIX + hostname);
}
