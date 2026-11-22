import { describe, expect, it } from "vitest";
import { decideAnswer, getCitationPolicy } from "@/lib/answer-policy";

const base = { modelAbstained: false, answer: "An answer.", unresolvedCount: 0, usedIndicesValid: true, usedCount: 2, citationCount: 5, groundedCount: 3 };

describe("citation policy", () => {
  it("defaults to strict and reads lenient case-insensitively", () => {
    expect(getCitationPolicy(undefined)).toBe("strict");
    expect(getCitationPolicy("nonsense")).toBe("strict");
    expect(getCitationPolicy(" Lenient ")).toBe("lenient");
  });

  it("withholds the answer in strict mode when any citation is unverified", () => {
    expect(decideAnswer({ ...base, policy: "strict" })).toMatchObject({ abstained: true, reason: "citations_not_grounded" });
    expect(decideAnswer({ ...base, groundedCitations: 5, groundedCount: 5, policy: "strict" } as never)).toMatchObject({ abstained: false });
  });

  it("shows the answer in lenient mode when at least one citation is verified", () => {
    expect(decideAnswer({ ...base, policy: "lenient" })).toEqual({ abstained: false, reason: null, unverifiedCitations: 2 });
  });

  it("always withholds when nothing is verified, sub-questions are unresolved, or the model abstained", () => {
    expect(decideAnswer({ ...base, groundedCount: 0, policy: "lenient" })).toMatchObject({ abstained: true, reason: "citations_not_grounded" });
    expect(decideAnswer({ ...base, unresolvedCount: 1, policy: "lenient" })).toMatchObject({ abstained: true, reason: "unresolved_subquestions" });
    expect(decideAnswer({ ...base, modelAbstained: true, policy: "lenient" })).toMatchObject({ abstained: true, reason: "model_abstained" });
    expect(decideAnswer({ ...base, answer: "  ", policy: "lenient" })).toMatchObject({ abstained: true, reason: "empty_answer" });
  });
});
