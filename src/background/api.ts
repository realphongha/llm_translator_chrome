// ─────────────────────────────────────────────
//  API Client
//  OpenAI-compatible Chat Completions
// ─────────────────────────────────────────────

import type { ApiConfig } from "../storage/config";

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

/**
 * Calls the OpenAI-compatible Chat Completions endpoint.
 *
 * @returns The assistant message content.
 * @throws ApiError on any failure.
 */
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
    temperature: 0.1,
  };

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
  if (!content || content.trim().length === 0) {
    throw new ApiError("Empty response from API", "empty_response");
  }

  return content;
}

/**
 * Tests API connectivity by sending a minimal request.
 */
export async function testApiConnection(
  config: ApiConfig
): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const result = await callChatCompletions(
      "You are a test assistant.",
      "Reply with exactly: OK",
      { ...config, timeout: 15 }
    );
    return { ok: true, model: config.model };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : String(err),
    };
  }
}
