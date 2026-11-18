import type { ContextSnippet } from "@/lib/context-packer";
import { isSafeIndexedPath } from "@/lib/indexed-path";

export function readLineWindow(filePath: string, rawContent: string, startLine: number, endLine: number) {
  const lines = rawContent.replace(/\r\n/g, "\n").split("\n");
  if (!isSafeIndexedPath(filePath)) {
    return { error: "File path is not a safe relative indexed path.", file_path: filePath, line_count: lines.length };
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || startLine > lines.length) {
    return {
      error: `Requested line range ${startLine}-${endLine} is out of range; the file has ${lines.length} line(s).`,
      file_path: filePath,
      line_count: lines.length,
    };
  }
  const boundedEnd = Math.min(endLine, lines.length);
  const snippet: ContextSnippet = {
    file_path: filePath,
    start_line: startLine,
    end_line: boundedEnd,
    content: lines.slice(startLine - 1, boundedEnd).join("\n"),
  };
  return { snippet };
}
