import { describe, expect, it } from "vitest";
import { getAgentFailureDiagnostic, getAgentFailureLogDetails } from "@/lib/agent-errors";

describe("agent failure diagnostics", () => {
  it("maps Groq quota failures to actionable, secret-safe guidance", () => {
    const error = { name: "ApiError", status: 429, message: "RESOURCE_EXHAUSTED sensitive response text" };
    expect(getAgentFailureDiagnostic(error)).toContain("HTTP 429");
    expect(JSON.stringify(getAgentFailureLogDetails(error))).not.toContain("sensitive");
  });

  it("logs provider rate-limit metadata without logging response messages", () => {
    const error = {
      name: "RateLimitError",
      status: 429,
      message: "sensitive provider message",
      error: { error: { code: "rate_limit_exceeded", type: "tokens" } },
      headers: new Headers({
        "x-request-id": "request-123",
        "retry-after": "2",
        "x-ratelimit-remaining-requests": "998",
        "x-ratelimit-remaining-tokens": "240000",
      }),
    };
    const details = getAgentFailureLogDetails(error);
    expect(details).toMatchObject({
      code: "rate_limit_exceeded",
      type: "tokens",
      request_id: "request-123",
      retry_after: "2",
      rate_limit_remaining_requests: "998",
      rate_limit_remaining_tokens: "240000",
    });
    expect(JSON.stringify(details)).not.toContain("sensitive");
  });

  it("includes safe provider details in the visible 429 diagnostic", () => {
    const error = {
      status: 429,
      error: { code: "rate_limit_exceeded", type: "tokens" },
      headers: new Headers({
        "retry-after": "2",
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "2s",
      }),
    };
    const diagnostic = getAgentFailureDiagnostic(error);
    expect(diagnostic).toContain("rate_limit_exceeded");
    expect(diagnostic).toContain("tokens remaining: 0");
    expect(diagnostic).toContain("token reset: 2s");
  });

  it("distinguishes invalid Groq credentials and unavailable models", () => {
    expect(getAgentFailureDiagnostic({ message: "invalid_api_key" })).toContain("GROQ_API_KEY");
    expect(getAgentFailureDiagnostic({ status: 404, message: "model not found" })).toContain("GROQ_MODEL");
  });

  it("identifies Groq JSON validation failures", () => {
    expect(getAgentFailureDiagnostic({
      status: 400,
      error: { code: "json_validate_failed", type: "invalid_request_error" },
    })).toContain("generated JSON response");
  });

  it("explains when a Groq key is not configured", () => {
    expect(getAgentFailureDiagnostic(new Error("Set GROQ_API_KEY before using agent chat.")))
      .toContain("Groq Console");
  });

  it("provides a safe fallback for other failures", () => {
    expect(getAgentFailureDiagnostic(new Error("internal details"))).toContain("server terminal");
  });
});
