import { describe, expect, it } from "vitest";
import { GROQ_MAX_TOKENS, groqReasoningOptions, isToolUseFailed } from "@/lib/groq-config";
import { getAgentFailureDiagnostic } from "@/lib/agent-errors";

describe("Groq reasoning options", () => {
  it("uses low reasoning effort for gpt-oss models only", () => {
    expect(groqReasoningOptions("openai/gpt-oss-120b")).toEqual({ reasoning_effort: "low" });
    expect(groqReasoningOptions("openai/gpt-oss-20b")).toEqual({ reasoning_effort: "low" });
    expect(groqReasoningOptions("llama-3.3-70b-versatile")).toEqual({});
  });

  it("leaves room for reasoning tokens in every step", () => {
    expect(GROQ_MAX_TOKENS.grade).toBeGreaterThanOrEqual(800);
    expect(GROQ_MAX_TOKENS.tools).toBeGreaterThanOrEqual(1500);
    expect(GROQ_MAX_TOKENS.synthesis).toBeGreaterThanOrEqual(2500);
  });

  it("explains token truncation distinctly from quota errors", () => {
    expect(getAgentFailureDiagnostic({ name: "GroqTruncationError", message: "x" })).toContain("output tokens");
  });

  it("recognises Groq tool_use_failed errors in every SDK error shape", () => {
    expect(isToolUseFailed({ status: 400, code: "tool_use_failed" })).toBe(true);
    expect(isToolUseFailed({ status: 400, error: { error: { code: "tool_use_failed" } } })).toBe(true);
    expect(isToolUseFailed({ status: 400, error: { code: "tool_use_failed" } })).toBe(true);
    expect(isToolUseFailed({ status: 400, code: "json_validate_failed" })).toBe(false);
    expect(isToolUseFailed(new Error("boom"))).toBe(false);
    expect(isToolUseFailed(null)).toBe(false);
  });
  it("describes tool_use_failed as transient", () => {
    expect(getAgentFailureDiagnostic({ status: 400, code: "tool_use_failed" })).toContain("malformed tool call");
  });
});
