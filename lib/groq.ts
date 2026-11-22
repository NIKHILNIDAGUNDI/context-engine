import "server-only";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { getRateLimitRetryDelayMs } from "@/lib/retry-delay";
import { GroqTruncationError, groqReasoningOptions } from "@/lib/groq-config";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

let client: Groq | undefined;

export function getGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY before using agent chat.");
  if (!client) client = new Groq({ apiKey, timeout: 30_000, maxRetries: 0 });
  return client;
}

export function getGroqModel() {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

function isRetryable(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; code?: unknown };
  const status = details.status ?? details.code;
  return status === 408 || status === 409 || status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599);
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withGroqRetry<T>(operation: () => Promise<T>, signal: AbortSignal, attempts = 3): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (signal.aborted || attempt === attempts - 1 || !isRetryable(error)) throw error;
      const headers = typeof error === "object" && error !== null && "headers" in error
        ? error.headers
        : undefined;
      const fallbackMs = 200 * 2 ** attempt + Math.floor(Math.random() * 100);
      await waitForRetry(getRateLimitRetryDelayMs(headers, fallbackMs), signal);
    }
  }
  throw new Error("Groq request could not be completed.");
}

/**
 * Runs one Groq chat completion with retries, logs token usage and the remaining per-minute
 * rate-limit budget (no secrets), and fails loudly when the output was cut off by the token limit.
 */
export async function groqCompletion(
  ai: Groq,
  params: ChatCompletionCreateParamsNonStreaming,
  signal: AbortSignal,
  label: string,
) {
  const { data, response } = await withGroqRetry(
    () => ai.chat.completions.create({ ...groqReasoningOptions(String(params.model)), ...params }, { signal }).withResponse(),
    signal,
  );
  const reasoningTokens = (data.usage as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined)
    ?.completion_tokens_details?.reasoning_tokens;
  const headers = response.headers;
  console.info("Groq call completed.", {
    step: label,
    model: params.model,
    finish_reason: data.choices[0]?.finish_reason,
    prompt_tokens: data.usage?.prompt_tokens,
    completion_tokens: data.usage?.completion_tokens,
    reasoning_tokens: reasoningTokens,
    remaining_tokens: headers.get("x-ratelimit-remaining-tokens") ?? undefined,
    remaining_requests: headers.get("x-ratelimit-remaining-requests") ?? undefined,
    reset_tokens: headers.get("x-ratelimit-reset-tokens") ?? undefined,
  });
  if (data.choices[0]?.finish_reason === "length") {
    throw new GroqTruncationError(label, data.usage?.completion_tokens);
  }
  return data;
}
