export type GrepSource = { file_path: string; raw_content: string };
export type GrepMatch = { file_path: string; line_number: number; line: string };

export function findExactMatches(files: GrepSource[], exactTerm: string, maxMatches = 30, maxBytes = 20 * 1024 * 1024) {
  const matches: GrepMatch[] = [];
  let scannedBytes = 0;
  let truncated = false;
  for (const file of files) {
    const bytes = Buffer.byteLength(file.raw_content, "utf8");
    if (scannedBytes + bytes > maxBytes) {
      truncated = true;
      break;
    }
    scannedBytes += bytes;
    const lines = file.raw_content.replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(exactTerm)) {
        matches.push({ file_path: file.file_path, line_number: index + 1, line: lines[index].slice(0, 1000) });
        if (matches.length >= maxMatches) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated) break;
  }
  return { matches, truncated, scanned_bytes: scannedBytes };
}
