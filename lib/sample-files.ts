import type { InputFile } from "@/lib/ingest";

export const SAMPLE_FILES: InputFile[] = [
  {
    file_path: "auth.md",
    raw_content: `# Authentication

## API credentials

Send an API token in the \`Authorization: Bearer <token>\` header.
Tokens identify a project and are subject to that project's request quota.
Requests without a valid token return \`401\` and do not consume quota.`,
  },
  {
    file_path: "rate-limits.ts",
    raw_content: `export const API_LIMITS = {
  windowSeconds: 60,
  requestsPerWindow: 120,
  retryAfterHeader: "Retry-After",
} as const;

export function rateLimitResponse(resetSeconds: number) {
  return {
    status: 429,
    headers: { "Retry-After": String(resetSeconds) },
    body: { error: "rate_limit_exceeded" },
  };
}

export function isRateLimited(requestsInWindow: number) {
  return requestsInWindow >= API_LIMITS.requestsPerWindow;
}`,
  },
  {
    file_path: "webhooks.md",
    raw_content: `# Webhook delivery

## Retrying failed deliveries

Webhook deliveries are retried when the receiver returns \`429\`, \`500\`, \`502\`, \`503\`, or \`504\`.
The retry delay is exponential: 1 minute, 2 minutes, 4 minutes, 8 minutes, then 16 minutes.
After the fifth retry, the delivery is marked failed and no further automatic retry is made.

## Rate-limit interaction

Webhook delivery retries use the webhook schedule above and do not consume the project's API request quota.
API requests made by the receiver are independently subject to the 120-request per 60-second project limit.
When an API request is rate-limited, the API responds with \`429\` and a \`Retry-After\` header; this does not change the webhook delivery schedule.`,
  },
  {
    file_path: "error-codes.json",
    raw_content: `{
  "401": { "name": "unauthorized", "retryable": false },
  "429": { "name": "rate_limit_exceeded", "retryable": true, "header": "Retry-After" },
  "503": { "name": "service_unavailable", "retryable": true },
  "504": { "name": "gateway_timeout", "retryable": true }
}`,
  },
];

export const SAMPLE_QUESTION = "When webhook delivery gets a 503, what exponential-backoff schedule applies, and how does that interact with API rate limits?";
