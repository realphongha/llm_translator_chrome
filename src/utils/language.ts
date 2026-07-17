// ─────────────────────────────────────────────
//  Language utilities
// ─────────────────────────────────────────────

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: "auto", name: "Auto Detect", nativeName: "Auto" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "中文（简体）" },
  { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "中文（繁體）" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "th", name: "Thai", nativeName: "ภาษาไทย" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
];

/** Languages that can be source (includes Auto) */
export const SOURCE_LANGUAGES = LANGUAGES;

/** Languages that can be target (excludes Auto) */
export const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== "auto");

export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function getLanguageByName(name: string): Language | undefined {
  return LANGUAGES.find(
    (l) => l.name === name || l.nativeName === name
  );
}

/**
 * Returns the display name for a language code.
 * Falls back to the code itself if not found.
 */
export function languageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
}

/**
 * Short label for displaying in the popup (e.g. "CN → VN")
 */
export function shortLabel(sourceLang: string, targetLang: string): string {
  const src = sourceLang === "auto" ? "Auto" : sourceLang.toUpperCase().slice(0, 2);
  const tgt = targetLang.toUpperCase().slice(0, 2);
  return `${src} → ${tgt}`;
}
