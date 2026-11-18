import { describe, expect, it } from "vitest";
import { chunkFile } from "@/lib/chunker";

describe("chunkFile", () => {
  it("splits Markdown at headings without treating fenced headings as boundaries", () => {
    const source = "# First\nalpha\n```md\n`\n## not a heading\n```\n## Second\nbeta";
    const chunks = chunkFile("guide.md", source);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading_path: "First", start_line: 1, end_line: 6 });
    expect(chunks[0].content).toContain("## not a heading");
    expect(chunks[1]).toMatchObject({ heading_path: "First > Second", start_line: 7, end_line: 8 });
  });

  it("splits code at top-level declarations with inclusive 1-indexed bounds", () => {
    const source = "export function outer() {\n  function inner() {}\n}\n\nclass Example {}\n";
    const chunks = chunkFile("module.ts", source);

    expect(chunks).toHaveLength(2);
    expect(chunks.map(({ start_line, end_line }) => [start_line, end_line])).toEqual([[1, 4], [5, 6]]);
    expect(chunks[0].content).toContain("function inner");
  });

  it("does not treat braces in a multiline template literal as top-level structure", () => {
    const source = "const message = `\n}\n`;\nexport function next() {\n  return true;\n}";
    const chunks = chunkFile("module.ts", source);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start_line).toBe(1);
    expect(chunks[1].start_line).toBe(4);
  });
});
