// ─────────────────────────────────────────────
//  Storage / Configuration module
//  All settings live in chrome.storage.local
// ─────────────────────────────────────────────

export interface ApiConfig {
  base: string;
  key: string;
  model: string;
  parallelCalls: number;
  timeout: number; // seconds
}

export interface TranslationConfig {
  maxChars: number;
  retryCount: number;
}

export interface GlobalConfig {
  api: ApiConfig;
  translation: TranslationConfig;
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

export interface SiteConfig {
  hostname: string;
  enabled: boolean;
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
}

// ── Defaults ─────────────────────────────────

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  api: {
    base: "",
    key: "",
    model: "",
    parallelCalls: 8,
    timeout: 60,
  },
  translation: {
    maxChars: 4000,
    retryCount: 3,
  },
  userPrompts: {},
};

export const DEFAULT_SITE_CONFIG: Omit<SiteConfig, "hostname"> = {
  enabled: false,
  prompt: "general",
  sourceLanguage: "Auto",
  targetLanguage: "English",
  observe: "body",
  selector: "",
  ignore: [],
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
  if (stored) return stored;

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
