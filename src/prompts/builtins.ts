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
- Dialogue self-reference (我): "ta" — every character, always. No anh/tớ/mình/tôi/etc.
- Dialogue address (你): "ngươi" — every character, always. No anh/em/cậu/bạn/etc.
- Narration: "hắn" (male), "nàng" (female), "nó" (neutral/pejorative) — unchanged.
- Relationship vocatives: Still use Han-Viet (sư phụ, sư huynh, tỷ tỷ, đệ, muội) when characters call each other by title — these are nouns, not pronouns, and do not replace ta/ngươi.
- For anything not Chinese (e.g., symbols, numbers, English), keep them as-is, don't try to translate them.
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
