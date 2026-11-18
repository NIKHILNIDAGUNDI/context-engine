import "server-only";
import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

export function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Set GEMINI_API_KEY before generating document or query embeddings.");
  if (!client) client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta", timeout: 30_000 } });
  return client;
}

function isRetryable(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; code?: unknown };
  const status = details.status ?? details.code;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    status === "RESOURCE_EXHAUSTED" || status === "UNAVAILABLE" || status === "INTERNAL";
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

export async function withGeminiRetry<T>(operation: () => Promise<T>, signal: AbortSignal, attempts = 4): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (signal.aborted || attempt === attempts - 1 || !isRetryable(error)) throw error;
      await waitForRetry(250 * 2 ** attempt + Math.floor(Math.random() * 100), signal);
    }
  }
  throw new Error("Gemini request could not be completed.");
}
