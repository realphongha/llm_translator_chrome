// ─────────────────────────────────────────────
//  API Client
//  Supports:
//   1. OpenAI-compatible Chat Completions
//   2. Chrome Built-in AI (Prompt API / Gemini Nano)
//   3. Chrome Built-in Translator (Translator API)
// ─────────────────────────────────────────────

import type { ApiConfig } from "../storage/config";
import { getLanguageByName, getLanguageByCode } from "../utils/language";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly type:
      | "timeout"
      | "http_error"
      | "invalid_json"
      | "api_unavailable"
      | "empty_response"
      | "unknown",
    public readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  chat_template_kwargs?: Record<string, unknown>;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Chrome Built-in AI Helpers ────────────────

export function getLanguageModelApi(): any {
  if (typeof (globalThis as any).LanguageModel !== "undefined") {
    return (globalThis as any).LanguageModel;
  }
  if (typeof (globalThis as any).ai !== "undefined" && (globalThis as any).ai.languageModel) {
    return (globalThis as any).ai.languageModel;
  }
  return null;
}

export function getTranslatorApi(): any {
  if (typeof (globalThis as any).Translator !== "undefined") {
    return (globalThis as any).Translator;
  }
  if (typeof (globalThis as any).translation !== "undefined") {
    return (globalThis as any).translation;
  }
  return null;
}

export interface ChromeAiStatus {
  enabled: boolean;
  availability: "readily" | "downloadable" | "no" | "unavailable" | "not_supported";
  message: string;
}

export async function checkChromeAiStatus(): Promise<ChromeAiStatus> {
  const lm = getLanguageModelApi();
  if (!lm) {
    return {
      enabled: false,
      availability: "not_supported",
      message: "Prompt API is disabled in Chrome flags or not supported in this browser version.",
    };
  }

  try {
    let avail: any = "no";
    if (typeof lm.availability === "function") {
      avail = await lm.availability();
    } else if (typeof lm.capabilities === "function") {
      const caps = await lm.capabilities();
      avail = caps?.available ?? "no";
    }

    const availStr = (typeof avail === "string" ? avail : (avail?.available || avail?.status || String(avail))).toLowerCase();

    if (availStr === "readily" || availStr === "available") {
      return {
        enabled: true,
        availability: "readily",
        message: "Gemini Nano is downloaded and ready to translate on-device.",
      };
    }

    if (availStr === "downloadable" || availStr === "after-download") {
      return {
        enabled: true,
        availability: "downloadable",
        message: "Gemini Nano flags are enabled. The model needs to be downloaded.",
      };
    }

    // Secondary probe: In Chrome 138-155 with BypassPerfRequirement, availability()
    // may return "no" while lm.create() actually succeeds immediately.
    try {
      const probePromise = lm.create({
        systemPrompt: "You are a test probe.",
        initialPrompts: [{ role: "system", content: "You are a test probe." }],
      });
      const probeTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      const probe = await Promise.race([probePromise, probeTimeout]);
      if (probe) {
        if (typeof probe.destroy === "function") probe.destroy();
        return {
          enabled: true,
          availability: "readily",
          message: "Gemini Nano is downloaded and verified active on-device.",
        };
      }
    } catch {
      // Probe failed, fall through to reporting unready
    }

    return {
      enabled: false,
      availability: (availStr as any) || "no",
      message: "Gemini Nano flags are not enabled or your hardware does not meet requirements.",
    };
  } catch (err) {
    // Before giving up, attempt a probe with timeout
    try {
      const probePromise = lm.create({
        systemPrompt: "You are a test probe.",
        initialPrompts: [{ role: "system", content: "You are a test probe." }],
      });
      const probeTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      const probe = await Promise.race([probePromise, probeTimeout]);
      if (probe) {
        if (typeof probe.destroy === "function") probe.destroy();
        return {
          enabled: true,
          availability: "readily",
          message: "Gemini Nano is downloaded and verified active on-device.",
        };
      }
    } catch {}

    const rawMsg = err instanceof Error ? err.message : String(err);
    let friendly = rawMsg;
    if (rawMsg.toLowerCase().includes("feature flag gating model execution was disabled")) {
      friendly = "On-device AI is disabled. Open 'chrome://settings/ai' and turn on 'On-device AI', or set '#prompt-api' to 'Enabled' in chrome://flags.";
    }
    return {
      enabled: false,
      availability: "not_supported",
      message: friendly,
    };
  }
}

export async function checkChromeTranslatorStatus(): Promise<ChromeAiStatus> {
  const translator = getTranslatorApi();
  if (!translator) {
    return {
      enabled: false,
      availability: "not_supported",
      message: "Translator API is not available in this browser version.",
    };
  }

  try {
    let avail: any = "no";
    if (typeof translator.availability === "function") {
      avail = await translator.availability({ sourceLanguage: "en", targetLanguage: "es" });
    } else if (typeof translator.canTranslate === "function") {
      avail = await translator.canTranslate({ sourceLanguage: "en", targetLanguage: "es" });
    }

    const availStr = (typeof avail === "string" ? avail : (avail?.available || avail?.status || String(avail))).toLowerCase();

    if (availStr === "readily" || availStr === "available") {
      return {
        enabled: true,
        availability: "readily",
        message: "Translator API is active and ready on-device.",
      };
    }

    if (availStr === "after-download" || availStr === "downloadable") {
      return {
        enabled: true,
        availability: "downloadable",
        message: "Translator API is enabled. Language packs will download on demand.",
      };
    }

    // Secondary probe
    try {
      const probePromise = typeof translator.create === "function"
        ? translator.create({ sourceLanguage: "en", targetLanguage: "es" })
        : translator({ sourceLanguage: "en", targetLanguage: "es" });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      const probe = await Promise.race([probePromise, timeoutPromise]);
      if (probe) {
        if (typeof probe.destroy === "function") probe.destroy();
        return {
          enabled: true,
          availability: "readily",
          message: "Translator API is active and ready on-device.",
        };
      }
    } catch {}

    return {
      enabled: false,
      availability: (availStr as any) || "no",
      message: "Translator API is not available or language pack is downloading.",
    };
  } catch (err) {
    return {
      enabled: false,
      availability: "not_supported",
      message: `Error checking status: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Chrome Built-in AI Execution ──────────────

async function callChromeGeminiNano(
  systemPrompt: string,
  userPrompt: string,
  config?: ApiConfig
): Promise<string> {
  const lm = getLanguageModelApi();
  if (!lm) {
    throw new ApiError(
      "Chrome Built-in AI is not enabled. Please check chrome://flags instructions in Settings.",
      "api_unavailable"
    );
  }

  try {
    const sessionOptions: any = {
      systemPrompt,
      initialPrompts: [{ role: "system", content: systemPrompt }],
    };
    if (config?.temperature !== undefined) sessionOptions.temperature = config.temperature;
    if (config?.top_k !== undefined) sessionOptions.topK = config.top_k;

    // Use reasoning/thinking for retranslate (when enable_thinking is true),
    // otherwise default to "none" for fast first-pass translation
    const enableThinking = config?.chat_template_kwargs?.enable_thinking === true;
    const thinkingEffort = enableThinking ? "high" : "none";

    console.log(`[LLM Translator] Gemini Nano thinkingEffort: ${thinkingEffort}`);

    let session: any;
    try {
      session = await lm.create({
        ...sessionOptions,
        thinkingEffort,
      });
    } catch {
      session = await lm.create(sessionOptions);
    }

    let result: string;
    try {
      result = await session.prompt(userPrompt, { thinkingEffort });
    } catch {
      result = await session.prompt(userPrompt);
    }

    if (typeof session.destroy === "function") {
      session.destroy();
    }
    if (!result || result.trim().length === 0) {
      throw new ApiError("Empty response from Chrome Built-in AI", "empty_response");
    }
    return result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.toLowerCase().includes("feature flag gating model execution was disabled")) {
      throw new ApiError(
        "Chrome Built-in AI disabled: open 'chrome://settings/ai' and turn on 'On-device AI', or set '#prompt-api' to Enabled in chrome://flags.",
        "api_unavailable"
      );
    }
    throw new ApiError(
      `Chrome Built-in AI error: ${rawMsg}`,
      "api_unavailable"
    );
  }
}

function toBcp47(lang: string | undefined): string | null {
  if (!lang) return null;
  const trimmed = lang.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "auto" || lower === "auto detect") return null;
  const found = getLanguageByName(trimmed) || getLanguageByCode(lower);
  if (found && found.code !== "auto") return found.code;
  if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(trimmed)) return lower;
  return null;
}

function detectScriptLanguage(text: string): string {
  if (/[\u4e00-\u9fa5]/.test(text)) return "zh";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  return "en";
}

async function callChromeTranslator(
  systemPrompt: string,
  userPrompt: string,
  config: ApiConfig,
  sourceLangName?: string,
  targetLangName?: string
): Promise<string> {
  const translatorApi = getTranslatorApi();
  if (!translatorApi) {
    throw new ApiError(
      "Chrome Translator API is not enabled in chrome://flags.",
      "api_unavailable"
    );
  }

  // 1. Resolve target language (Chrome Translator requires valid BCP-47 tag)
  let targetLang = toBcp47(targetLangName);
  if (!targetLang) {
    const match = /Translate (?:from\s+[A-Za-z]+\s+)?to\s+([A-Za-z]+)/i.exec(systemPrompt);
    if (match) targetLang = toBcp47(match[1]);
  }
  if (!targetLang) targetLang = "en";

  // 2. Resolve source language (NEVER pass "auto" to Translator.create)
  let sourceLang = toBcp47(sourceLangName);
  if (!sourceLang) {
    // If auto or not provided, try Chrome's LanguageDetector
    const sampleText = userPrompt.slice(0, 500);
    const detectorApi = (globalThis as any).LanguageDetector || (globalThis as any).translation?.createDetector || (globalThis as any).ai?.languageDetector;
    if (detectorApi) {
      try {
        const detector = await (typeof detectorApi.create === "function" ? detectorApi.create() : detectorApi());
        const detected = await detector.detect(sampleText);
        if (detected?.[0]?.detectedLanguage && detected[0].detectedLanguage !== "und" && detected[0].detectedLanguage !== "auto") {
          sourceLang = detected[0].detectedLanguage;
        }
        if (typeof detector.destroy === "function") detector.destroy();
      } catch {}
    }
  }

  // 3. Fallback to script heuristic if still not resolved
  if (!sourceLang || sourceLang === "auto") {
    sourceLang = detectScriptLanguage(userPrompt);
  }

  // If source and target are the same language, return as-is
  if (sourceLang === targetLang) {
    return userPrompt;
  }

  let translator: any;
  try {
    translator = await (typeof translatorApi.create === "function"
      ? translatorApi.create({ sourceLanguage: sourceLang, targetLanguage: targetLang })
      : translatorApi({ sourceLanguage: sourceLang, targetLanguage: targetLang }));
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      `Chrome Translator failed for ${sourceLang} → ${targetLang}: ${rawMsg}. Make sure Chrome on-device translation is enabled in chrome://flags.`,
      "api_unavailable"
    );
  }

  // Extract <ID=N> blocks from userPrompt to preserve parser compatibility
  const idPattern = /<ID=(\d+)>([\s\S]*?)(?=(?:<ID=\d+>|$))/gi;
  let blockMatch: RegExpExecArray | null;
  const outputs: string[] = [];

  while ((blockMatch = idPattern.exec(userPrompt)) !== null) {
    const id = blockMatch[1];
    const text = blockMatch[2].trim();
    if (!text) continue;
    const translated = await translator.translate(text);
    outputs.push(`<ID=${id}>\n${translated}`);
  }

  if (typeof translator.destroy === "function") {
    translator.destroy();
  }

  if (outputs.length === 0) {
    const translated = await translator.translate(userPrompt);
    return translated;
  }

  return outputs.join("\n\n");
}

// ── Unified Translation Dispatcher ───────────

export async function callTranslation(
  systemPrompt: string,
  userPrompt: string,
  config: ApiConfig,
  sourceLang?: string,
  targetLang?: string
): Promise<string> {
  if (config.provider === "chrome-ai") {
    console.log("[LLM Translator] Translation dispatch: Provider = Chrome Built-in AI (Gemini Nano)");
    return callChromeGeminiNano(systemPrompt, userPrompt, config);
  }
  if (config.provider === "chrome-translator") {
    console.log(`[LLM Translator] Translation dispatch: Provider = Chrome Fast Translator (${sourceLang ?? "auto"} -> ${targetLang ?? "target"})`);
    return callChromeTranslator(systemPrompt, userPrompt, config, sourceLang, targetLang);
  }
  console.log(`[LLM Translator] Translation dispatch: Provider = Custom API (${config.model || config.base})`);
  return callChatCompletions(systemPrompt, userPrompt, config);
}

// ── OpenAI-compatible Chat Completions ────────

export async function callChatCompletions(
  systemPrompt: string,
  userPrompt: string,
  config: ApiConfig
): Promise<string> {
  const base = config.base.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  const body: ChatCompletionRequest = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.top_p !== undefined) body.top_p = config.top_p;
  if (config.top_k !== undefined) body.top_k = config.top_k;
  if (config.min_p !== undefined) body.min_p = config.min_p;
  if (config.presence_penalty !== undefined) body.presence_penalty = config.presence_penalty;
  body.chat_template_kwargs = config.chat_template_kwargs ?? { enable_thinking: false };

  console.log(`[LLM API] ${config.model}`);
  console.log("System:", systemPrompt);
  console.log("User:", userPrompt);

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.timeout * 1000
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        `Request timed out after ${config.timeout}s`,
        "timeout"
      );
    }
    throw new ApiError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      "api_unavailable"
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new ApiError(
      `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
      "http_error",
      response.status
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = await response.json() as ChatCompletionResponse;
  } catch {
    throw new ApiError("Invalid JSON in API response", "invalid_json");
  }

  const content = data.choices?.[0]?.message?.content;
  console.log("Response:", content);
  if (!content || content.trim().length === 0) {
    throw new ApiError("Empty response from API", "empty_response");
  }

  return content;
}

/**
 * Tests API connectivity or built-in model availability.
 */
export async function testApiConnection(
  config: ApiConfig
): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    if (config.provider === "chrome-ai") {
      const status = await checkChromeAiStatus();
      if (!status.enabled) {
        return { ok: false, error: status.message };
      }
      if (status.availability === "downloadable") {
        return {
          ok: false,
          error: "Gemini Nano flags are enabled, but the model (~1.7 GB) is not downloaded yet. Please click 'Download Gemini Nano' above.",
        };
      }
      const testPromise = callTranslation(
        "You are a test assistant.",
        "Reply with exactly: OK",
        config
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Test timed out after 8s. Gemini Nano weights may still be downloading in the background."
              )
            ),
          8000
        )
      );
      await Promise.race([testPromise, timeoutPromise]);
      return { ok: true, model: "Chrome Gemini Nano (Local)" };
    }

    if (config.provider === "chrome-translator") {
      const status = await checkChromeTranslatorStatus();
      if (!status.enabled) {
        return { ok: false, error: status.message };
      }
      const testPromise = callChromeTranslator(
        "You are a translator.",
        "<ID=1>\nHello",
        config,
        "en",
        "es"
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Translator API timed out after 8s. Language packs may be downloading."
              )
            ),
          8000
        )
      );
      await Promise.race([testPromise, timeoutPromise]);
      return { ok: true, model: "Chrome Fast Translator (Local)" };
    }

    const result = await callChatCompletions(
      "You are a test assistant.",
      "Reply with exactly: OK",
      { ...config, timeout: 15 }
    );
    return { ok: true, model: config.model || "Custom" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : String(err)),
    };
  }
}
