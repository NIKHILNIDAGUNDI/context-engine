type AgentErrorLike = {
  name?: string;
  status?: number;
  code?: string | number;
  message?: string;
  error?: unknown;
  headers?: unknown;
};

type AgentErrorDetails = {
  name?: string;
  status?: number;
  code?: string | number;
  type?: string;
  message?: string;
  requestId?: string;
  retryAfter?: string;
  remainingRequests?: string;
  remainingTokens?: string;
  resetRequests?: string;
  resetTokens?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function getHeader(headers: unknown, name: string) {
  if (typeof headers !== "object" || headers === null || !("get" in headers) || typeof headers.get !== "function") {
    return undefined;
  }
  const value = headers.get(name);
  return typeof value === "string" ? value.slice(0, 100) : undefined;
}

function errorDetails(error: unknown): AgentErrorDetails {
  if (typeof error !== "object" || error === null) {
    return { message: typeof error === "string" ? error : undefined };
  }
  const value = error as AgentErrorLike;
  const response = asRecord(value.error);
  const nested = asRecord(response?.error) ?? response;
  const headers = value.headers;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    status: typeof value.status === "number" ? value.status : undefined,
    code: typeof value.code === "string" || typeof value.code === "number"
      ? value.code
      : typeof nested?.code === "string" || typeof nested?.code === "number" ? nested.code : undefined,
    type: typeof nested?.type === "string" ? nested.type.slice(0, 80) : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    requestId: getHeader(headers, "x-request-id"),
    retryAfter: getHeader(headers, "retry-after"),
    remainingRequests: getHeader(headers, "x-ratelimit-remaining-requests"),
    remainingTokens: getHeader(headers, "x-ratelimit-remaining-tokens"),
    resetRequests: getHeader(headers, "x-ratelimit-reset-requests"),
    resetTokens: getHeader(headers, "x-ratelimit-reset-tokens"),
  };
}

export function getAgentFailureDiagnostic(error: unknown) {
  const {
    name,
    status,
    code,
    type,
    message,
    retryAfter,
    remainingRequests,
    remainingTokens,
    resetRequests,
    resetTokens,
  } = errorDetails(error);
  const text = `${code ?? ""} ${type ?? ""} ${message ?? ""}`.toLowerCase();

  if (text.includes("groq_api_key")) {
    return "Set GROQ_API_KEY in .env.local to a key from the Groq Console, then restart the app.";
  }
  if (status === 429) {
    const details = [
      code ? `code: ${code}` : undefined,
      type ? `type: ${type}` : undefined,
      remainingRequests ? `requests remaining: ${remainingRequests}` : undefined,
      remainingTokens ? `tokens remaining: ${remainingTokens}` : undefined,
      retryAfter ? `retry after: ${retryAfter}` : undefined,
      resetRequests ? `request reset: ${resetRequests}` : undefined,
      resetTokens ? `token reset: ${resetTokens}` : undefined,
    ].filter(Boolean);
    return `Groq returned HTTP 429${details.length ? ` (${details.join("; ")})` : ""}. This is a provider throttle or usage response, not the app's local request limit.`;
  }
  if (text.includes("resource_exhausted") || text.includes("quota")) {
    return "Groq reported a project quota or usage-cap error. Check the server log for its error type and response details.";
  }
  if (text.includes("invalid_api_key") || text.includes("api_key_invalid") || text.includes("invalid api key") || text.includes("authentication")) {
    return "Groq rejected GROQ_API_KEY. Verify it is valid in the Groq console.";
  }
  if (status === 401 || status === 403 || text.includes("permission_denied")) {
    return "Groq denied this request. Verify the key and model access in the Groq console.";
  }
  if (text.includes("model") && (status === 404 || text.includes("not found") || text.includes("not supported"))) {
    return "The configured Groq model is unavailable. Check GROQ_MODEL against the models enabled for this account.";
  }
  if (text.includes("tool_use_failed")) {
    return "Groq's model produced a malformed tool call (tool_use_failed). This is usually transient; retry the question.";
  }
  if (name === "GroqTruncationError") {
    return "The model ran out of output tokens before finishing a step (reasoning tokens count toward the limit). Retry, or raise GROQ_MAX_TOKENS in lib/groq-config.ts.";
  }
  if (text.includes("json_validate_failed")) {
    return "Groq rejected the generated JSON response, often because the output was cut off or the model does not support strict JSON Schema. Check the server log for the step's finish_reason and confirm GROQ_MODEL supports structured outputs.";
  }
  if (name === "TimeoutError" || name === "AbortError" || text.includes("timed out") || text.includes("timeout")) {
    return "The Groq request timed out. Retry with a shorter question or check network connectivity.";
  }
  if (text.includes("invalid_argument") || status === 400) {
    return "Groq rejected the agent request configuration. Check the server terminal for the safe error code.";
  }
  return "The agent request failed unexpectedly. Check the server terminal for its error name and status.";
}

export function getAgentFailureLogDetails(error: unknown) {
  const {
    name,
    status,
    code,
    type,
    requestId,
    retryAfter,
    remainingRequests,
    remainingTokens,
    resetRequests,
    resetTokens,
  } = errorDetails(error);
  return {
    name: name?.slice(0, 80) ?? "UnknownError",
    status,
    code: typeof code === "string" ? code.slice(0, 80) : code,
    type,
    request_id: requestId,
    retry_after: retryAfter,
    rate_limit_remaining_requests: remainingRequests,
    rate_limit_remaining_tokens: remainingTokens,
    rate_limit_reset_requests: resetRequests,
    rate_limit_reset_tokens: resetTokens,
  };
}
