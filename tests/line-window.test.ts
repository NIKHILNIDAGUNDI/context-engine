import { describe, expect, it } from "vitest";
import { readLineWindow } from "@/lib/line-window";

describe("readLineWindow", () => {
  it("clamps the inclusive end line at EOF", () => {
    expect(readLineWindow("a.ts", "one\r\ntwo", 2, 20)).toEqual({
      snippet: { file_path: "a.ts", start_line: 2, end_line: 2, content: "two" },
    });
  });

  it("returns an explicit range error without an invalid snippet past EOF", () => {
    const result = readLineWindow("a.ts", "one\ntwo", 4, 8);
    expect(result).toEqual({ error: "Requested line range 4-8 is out of range; the file has 2 line(s).", file_path: "a.ts", line_count: 2 });
    expect("snippet" in result).toBe(false);
  });

  it("rejects traversal paths and reversed ranges without producing citations", () => {
    expect(readLineWindow("../secrets.ts", "safe", 1, 1)).toMatchObject({ error: "File path is not a safe relative indexed path." });
    expect(readLineWindow("a.ts", "one\ntwo", 2, 1)).toMatchObject({ error: "Requested line range 2-1 is out of range; the file has 2 line(s)." });
  });
});
