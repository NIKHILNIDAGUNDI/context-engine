function getHeader(headers: unknown, name: string) {
  if (typeof headers !== "object" || headers === null || !("get" in headers) || typeof headers.get !== "function") {
    return undefined;
  }
  const value = headers.get(name);
  return typeof value === "string" ? value.trim() : undefined;
}

function parseDuration(value: string | undefined, defaultUnit: "ms" | "seconds") {
  if (!value) return undefined;
  const duration = value.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2]?.toLowerCase() ?? defaultUnit;
    return amount * (unit === "ms" ? 1 : unit === "m" ? 60_000 : 1000);
  }
  if (defaultUnit === "seconds") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
  }
  return undefined;
}

export function getRateLimitRetryDelayMs(headers: unknown, fallbackMs: number) {
  const retryAfterMs = parseDuration(getHeader(headers, "retry-after-ms"), "ms");
  const retryAfter = parseDuration(getHeader(headers, "retry-after"), "seconds");
  const requestReset = parseDuration(getHeader(headers, "x-ratelimit-reset-requests"), "seconds");
  const tokenReset = parseDuration(getHeader(headers, "x-ratelimit-reset-tokens"), "seconds");
  const providerDelays = [retryAfterMs, retryAfter, requestReset, tokenReset]
    .filter((delay): delay is number => delay !== undefined && Number.isFinite(delay) && delay >= 0);

  return Math.min(60_000, providerDelays.length ? Math.max(...providerDelays) : fallbackMs);
}
