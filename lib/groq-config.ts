// gpt-oss is a reasoning model and its reasoning tokens count toward max_completion_tokens.
// Limits are generous enough that low-effort reasoning cannot truncate the visible JSON.
export const GROQ_MAX_TOKENS = { tools: 1500, grade: 800, synthesis: 2500 } as const;

export class GroqTruncationError extends Error {
  constructor(label: string, readonly completionTokens?: number) {
    super(`Groq stopped the "${label}" step because it reached the output token limit.`);
    this.name = "GroqTruncationError";
  }
}

export function groqReasoningOptions(model: string) {
  return model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low" as const } : {};
}

// Groq answers HTTP 400 `tool_use_failed` when gpt-oss writes a malformed tool call.
// It is a transient model error, not a bad request configuration.
export function isToolUseFailed(error: unknown): boolean {
  const record = (value: unknown) => (typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined);
  const top = record(error);
  const body = record(top?.error);
  const nested = record(body?.error) ?? body;
  return [top?.code, nested?.code].includes("tool_use_failed");
}
