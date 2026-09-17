// ─────────────────────────────────────────────
//  Built-in Prompts
// ─────────────────────────────────────────────

export interface BuiltinPrompt {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface TranslatableParagraph {
  id: number;
  text: string;
}

// ── Built-in prompt definitions ───────────────

export const BUILTIN_PROMPTS: BuiltinPrompt[] = [
  {
    id: "general",
    name: "General",
    description: "General-purpose translation for any language pair",
    systemPrompt: `You are a professional translator.

Translate from {{source_language}} to {{target_language}}.

Rules:
- Preserve formatting.
- Preserve paragraph structure.
- Do not summarize.
- Do not explain.
- Output only the translation.`,
  },
  {
    id: "qidian-vn",
    name: "Qidian VN",
    description: "Optimized for Chinese web novels translated to Vietnamese",
    systemPrompt: `You are translating a Chinese web novel into natural Vietnamese.

Rules:
- Preserve the original tone.
- Character names use Han-Viet (Hán Việt) readings as the base.
- Sect names, technique names, and cultivation terms follow established conventions for the genre.
- Existing Vietnamese fan translations of popular works should be referenced for convention alignment when available.
- Use standard cultivation terminology.
- Dialogue self-reference (我): translate as "ta" — every character, always. No anh/tớ/mình/tôi/etc.
- Dialogue address (你): translate as "ngươi" — every character, always. No anh/em/cậu/bạn/etc.
- Narration: "hắn" (male), "nàng" (female), "nó" (neutral/pejorative) — unchanged.
- Relationship vocatives: Still use Han-Viet (sư phụ, sư huynh, tỷ tỷ, đệ, muội) when characters call each other by title — these are nouns, not pronouns, and do not replace ta/ngươi.
- **Do not** keep any Chinese characters in the translation.
- For anything not Chinese (e.g., symbols, numbers, English), keep them as-is, don't try to translate them.
- Foreign brands and proper names:** retain the official Latin/English name if it is already commonly used in Vietnamese; do not Sino-Vietnamese-ize it. Restore the full name from an abbreviated name based on context, for example, '阿迪' in a fashion context → **Adidas**, '耐克' → **Nike**. When there is insufficient context to determine the name with confidence, do not make a definitive guess; add a note for further review.
- For translated chapter numbers, use Arabic numbers instead of Vietnamese (e.g., "第六百七十九章 最后的挽留" => "Chương 679: Sự níu kéo cuối cùng" instead of "Chương sáu trăm bảy mươi chín: Sự níu kéo cuối cùng")
- Preserve paragraph structure.
- Keep dialogue natural.
- Do not summarize.
- Do not explain.
- Output only the translation.`,
  },
  {
    id: "qidian-en",
    name: "Qidian EN",
    description: "Optimized for Chinese web novels translated to English",
    systemPrompt: `You are translating a Chinese web novel (xianxia/xuanhuan/wuxia) into natural, fluent English.

Rules:
- Preserve the original tone, pacing, and point of view.
- Render dialogue in a consistent, natural English style that fits the genre and the character's voice.
- Keep character names consistent across the text. Use the established official romanization when a well-known novel provides one; otherwise use a clear, consistent Pinyin/romanization and do not vary it.
- Cultivation terms follow established English fan conventions for the genre (e.g., qi, dantian, foundation, core, tribulation, sect, dao) rather than literal translation.
- Sect names, technique names, and cultivation terms should be consistent with widely-used English conventions for popular works when available.
- Preserve proper nouns (names, sects, techniques, artifacts, pills, locations) with a consistent romanization; do not translate them into English equivalents.
- Do not localize culturally-specific titles or concepts into Western equivalents; keep the flavor of the source.
- Keep the narrative distance of the original (avoid adding or dropping narration voice).
- **Do not** keep any Chinese characters in the translation.
- For anything not Chinese (e.g., symbols, numbers, English), keep them as-is, don't try to translate them.
- Foreign brands and proper names: retain the official Latin/English name if it is already commonly used in English; do not romanize it into Pinyin. Restore the full name from an abbreviated name based on context, for example, '阿迪' in a fashion context → **Adidas**, '耐克' → **Nike**. When there is insufficient context to determine the name with confidence, do not make a definitive guess; add a note for further review.
- For translated chapter numbers, use Arabic numbers instead of English words (e.g., "第六百七十九章 最后的挽留" => "Chapter 679: The Final Farewell" instead of "Chapter Six Hundred and Seventy-Nine: The Final Farewell")
- Preserve paragraph structure.
- Keep dialogue natural.
- Do not summarize.
- Do not explain.
- Output only the translation.`,
  },
];

export const BUILTIN_PROMPT_MAP = new Map(
  BUILTIN_PROMPTS.map((p) => [p.id, p])
);

// ── Template variable substitution ───────────

export interface PromptVars {
  source_language: string;
  target_language: string;
  hostname?: string;
  url?: string;
  page_title?: string;
}

export function renderSystemPrompt(template: string, vars: PromptVars): string {
  const sourceLang = vars.source_language === "Auto" || vars.source_language === "Auto Detect"
    ? "the original language"
    : vars.source_language;

  return template
    .replace(/\{\{source_language\}\}/g, sourceLang)
    .replace(/\{\{target_language\}\}/g, vars.target_language)
    .replace(/\{\{hostname\}\}/g, vars.hostname ?? "")
    .replace(/\{\{url\}\}/g, vars.url ?? "")
    .replace(/\{\{page_title\}\}/g, vars.page_title ?? "");
}

// ── Get system prompt by id ───────────────────

/**
 * Returns the rendered system prompt for a given prompt id (builtin or user).
 * userPrompts is a map of user-created prompts.
 */
export function getSystemPrompt(
  promptId: string,
  vars: PromptVars,
  userPrompts: Record<string, { systemPrompt: string }> = {}
): string {
  const builtin = BUILTIN_PROMPT_MAP.get(promptId);
  if (builtin) {
    return renderSystemPrompt(builtin.systemPrompt, vars);
  }
  const user = userPrompts[promptId];
  if (user) {
    return renderSystemPrompt(user.systemPrompt, vars);
  }
  // Fallback: general prompt
  return renderSystemPrompt(BUILTIN_PROMPTS[0].systemPrompt, vars);
}

// ── User prompt (the human turn) ─────────────

/**
 * Builds the user-turn message for the LLM with tagged paragraphs.
 *
 * Format:
 *   Translate the following paragraphs.
 *   Each paragraph begins with an ID.
 *   Return one translated paragraph for each ID.
 *
 *   <ID=1>
 *   paragraph text...
 *
 *   <ID=2>
 *   paragraph text...
 */
export function buildUserPrompt(paragraphs: TranslatableParagraph[]): string {
  const header = [
    "Translate the following paragraphs.",
    "Each paragraph begins with an ID.",
    "Return one translated paragraph for each ID.",
    "Preserve the <ID=N> tag at the start of each translated paragraph.",
  ].join("\n");

  const body = paragraphs
    .map((p) => `<ID=${p.id}>\n${p.text}`)
    .join("\n\n");

  return `${header}\n\n${body}`;
}
