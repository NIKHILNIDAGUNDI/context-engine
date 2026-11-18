import { describe, expect, it } from "vitest";
import { getEncoding } from "js-tiktoken";
import { MAX_CONTEXT_TOKENS, packContext } from "@/lib/context-packer";

describe("packContext", () => {
  it("merges adjacent ranges from the same file", () => {
    const result = packContext([
      { file_path: "a.ts", start_line: 1, end_line: 2, content: "const a = 1;\nconst b = 2;" },
      { file_path: "a.ts", start_line: 3, end_line: 4, content: "const c = 3;\nconst d = 4;" },
    ]);

    expect(result.relevant_count).toBe(1);
    expect(result.snippets[0]).toMatchObject({ start_line: 1, end_line: 4, status: "relevant" });
    expect(result.snippets[0].content).toContain("const d = 4;");
  });

  it("enforces the strict token cap and marks omitted evidence as pruned", () => {
    const result = packContext([
      { file_path: "small.md", start_line: 1, end_line: 1, content: "Useful evidence." },
      { file_path: "large.md", start_line: 1, end_line: 500, content: Array.from({ length: 500 }, (_, i) => `Line ${i + 1} contains additional documentation words.`).join("\n") },
      { file_path: "z.md", start_line: 1, end_line: 1, content: "This additional snippet must be pruned." },
    ], 100);

    expect(result.token_count).toBeLessThanOrEqual(100);
    expect(result.token_count).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    expect(result.token_count).toBe(getEncoding("cl100k_base").encode(result.prompt).length);
    expect(result.snippets.some((snippet) => snippet.status === "pruned")).toBe(true);
    expect(result.snippets.some((snippet) => snippet.budget_truncated)).toBe(true);
    expect(result.budget_pruned_count).toBeGreaterThan(0);
    expect(result.prompt).not.toContain("status: pruned");
  });

  it("rejects budgets above the system limit", () => {
    expect(() => packContext([], MAX_CONTEXT_TOKENS + 1)).toThrow(RangeError);
  });
});
