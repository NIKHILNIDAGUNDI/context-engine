import "server-only";
import Groq from "groq-sdk";
import { getRateLimitRetryDelayMs } from "@/lib/retry-delay";

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
