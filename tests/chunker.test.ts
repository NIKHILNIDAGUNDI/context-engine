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

describe("chunkFile prose and oversized content", () => {
  it("chunks PDF text by page marker instead of collapsing it into one chunk", () => {
    const page = (n: number) => `--- Page ${n} ---\n${Array.from({ length: 30 }, (_, i) => `Page ${n} sentence number ${i} with some filler text.`).join("\n")}`;
    const chunks = chunkFile("report.pdf", [page(1), page(2), page(3)].join("\n\n"));

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].heading_path).toBe("Page 1");
    expect(chunks.some((chunk) => chunk.heading_path === "Page 3")).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= 2400 + 200)).toBe(true);
  });

  it("keeps contiguous, inclusive line bounds that cover the whole file", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i + 1} ${"x".repeat(40)}`).join("\n");
    const chunks = chunkFile("notes.txt", text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start_line).toBe(1);
    expect(chunks[chunks.length - 1].end_line).toBe(200);
    chunks.slice(1).forEach((chunk, index) => expect(chunk.start_line).toBe(chunks[index].end_line + 1));
    chunks.forEach((chunk) => expect(chunk.content.split("\n")).toHaveLength(chunk.end_line - chunk.start_line + 1));
  });

  it("splits an oversized code declaration into parts with correct absolute line numbers", () => {
    const body = Array.from({ length: 120 }, (_, i) => `  const value${i} = ${i}; // ${"y".repeat(30)}`).join("\n");
    const chunks = chunkFile("big.ts", `export function big() {\n${body}\n}\n`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].heading_path).toMatch(/part 1\//);
    expect(chunks[0].start_line).toBe(1);
    chunks.forEach((chunk) => expect(chunk.content.split("\n")).toHaveLength(chunk.end_line - chunk.start_line + 1));
  });

  it("splits Python at def and class boundaries", () => {
    const chunks = chunkFile("app.py", "class A:\n    def one(self):\n        return 1\n\n    def two(self):\n        return 2\n");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});
