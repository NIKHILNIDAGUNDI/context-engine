import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, normalizeExtractedText, parseDocument } from "@/lib/file-parser";

describe("file parser", () => {
  it("normalizes line endings without shifting leading line indexes", () => {
    expect(normalizeExtractedText("\r\nfirst\r\nsecond\r\n")).toBe("\nfirst\nsecond\n");
  });

  it("preserves plain text source lines", async () => {
    const parsed = await parseDocument("notes.md", new TextEncoder().encode("\n# Heading\r\nBody\n"), "text/markdown");
    expect(parsed).toMatchObject({ file_path: "notes.md", file_type: "MD", raw_content: "\n# Heading\nBody\n" });
  });

  it("returns clear errors for unsupported and empty inputs", async () => {
    await expect(parseDocument("archive.zip", new Uint8Array([1]))).rejects.toThrow("Unsupported file format");
    await expect(parseDocument("empty.txt", new Uint8Array())).rejects.toThrow("is empty");
  });

  it("rejects traversal filenames, mismatched MIME types, invalid signatures, and oversized uploads", async () => {
    const text = new TextEncoder().encode("safe");
    await expect(parseDocument("../notes.md", text, "text/markdown")).rejects.toThrow("safe relative filename");
    await expect(parseDocument("notes.md", text, "image/png")).rejects.toThrow("matching supported MIME");
    await expect(parseDocument("fake.pdf", text, "application/pdf")).rejects.toThrow("PDF signature");
    await expect(parseDocument("large.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1), "text/plain")).rejects.toThrow("10 MB");
  });
});
