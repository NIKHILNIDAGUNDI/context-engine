import { describe, expect, it } from "vitest";
import { normalizeEmbeddingInputs } from "@/lib/embedding-utils";
import { getRateLimitRetryDelayMs } from "@/lib/retry-delay";
import { addGroqUsage, emptyGroqUsage } from "@/lib/groq-usage";

describe("AI provider helpers", () => {
  it("preserves embedding input positions while skipping blank text", () => {
    expect(normalizeEmbeddingInputs(["first passage", "", "  \n", "last passage"])).toEqual([
      "first passage",
      null,
      null,
      "last passage",
    ]);
  });

  it("aggregates Groq prompt and completion tokens across agent calls", () => {
    const usage = emptyGroqUsage();
    addGroqUsage(usage, { prompt_tokens: 120, completion_tokens: 40 });
    addGroqUsage(usage, { prompt_tokens: 75, completion_tokens: 18 });

    expect(usage).toEqual({ input_tokens: 195, output_tokens: 58 });
  });

  it("respects Groq retry-after and rate-limit reset headers", () => {
    expect(getRateLimitRetryDelayMs(new Headers({
      "retry-after": "2",
      "x-ratelimit-reset-tokens": "3s",
    }), 200)).toBe(3000);
    expect(getRateLimitRetryDelayMs(new Headers({ "retry-after-ms": "1500" }), 200)).toBe(1500);
    expect(getRateLimitRetryDelayMs(new Headers({ "retry-after": "90" }), 200)).toBe(60_000);
    expect(getRateLimitRetryDelayMs(new Headers(), 250)).toBe(250);
  });
});
