export type DocChunk = {
  file_path: string;
  heading_path: string;
  start_line: number;
  end_line: number;
  content: string;
};

// Chunks above MAX_CHUNK_CHARS are split so that retrieval returns focused passages
// and the whole chunk fits inside the embedding input and the 4,000-token evidence budget.
export const TARGET_CHUNK_CHARS = 1800;
export const MAX_CHUNK_CHARS = 2400;

function isMarkdown(filePath: string) {
  return /\.(md|mdx)$/i.test(filePath);
}

// Extensions the declaration-based chunker understands. Everything else (PDF/DOCX/TXT text,
// JSON, CSV, YAML, HTML, SQL, ...) is chunked as prose by size, paragraph and page.
function isCode(filePath: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|java|go|rs|py)$/i.test(filePath);
}

function textChunks(filePath: string, lines: string[]): DocChunk[] {
  const chunks: DocChunk[] = [];
  let startIndex = 0;
  let size = 0;
  let page: number | null = null;
  let chunkPage: number | null = null;

  const flush = (endExclusive: number) => {
    if (endExclusive <= startIndex) return;
    const content = lines.slice(startIndex, endExclusive).join("\n");
    if (content.trim()) {
      chunks.push({
        file_path: filePath,
        heading_path: chunkPage ? `Page ${chunkPage}` : `Document · lines ${startIndex + 1}-${endExclusive}`,
        start_line: startIndex + 1,
        end_line: endExclusive,
        content,
      });
    }
    startIndex = endExclusive;
    size = 0;
    chunkPage = page;
  };

  lines.forEach((line, index) => {
    const marker = line.match(/^--- Page (\d+) ---$/);
    if (marker) {
      flush(index);
      page = Number(marker[1]);
      chunkPage = page;
    }
    const cost = line.length + 1;
    if (size > 0 && size + cost > MAX_CHUNK_CHARS) flush(index);
    size += cost;
    if (size >= TARGET_CHUNK_CHARS && !line.trim()) flush(index + 1);
  });
  flush(lines.length);
  return chunks;
}

function splitOversized(chunk: DocChunk): DocChunk[] {
  if (chunk.content.length <= MAX_CHUNK_CHARS) return [chunk];
  const parts = textChunks(chunk.file_path, chunk.content.split("\n"));
  return parts.map((part, index) => ({
    ...part,
    heading_path: `${chunk.heading_path} · part ${index + 1}/${parts.length}`,
    start_line: chunk.start_line + part.start_line - 1,
    end_line: chunk.start_line + part.end_line - 1,
  }));
}

function markdownChunks(filePath: string, lines: string[]): DocChunk[] {
  const sections: Array<{ line: number; level: number; title: string }> = [];
  let inFence = false;
  let fenceMarker = "";
  let fenceLength = 0;

  lines.forEach((line, index) => {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1][0] === fenceMarker && fence[1].length >= fenceLength) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;
    const header = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (header) sections.push({ line: index + 1, level: header[1].length, title: header[2] });
  });

  const starts = [1, ...sections.map((section) => section.line)];
  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  return uniqueStarts.flatMap((start, index) => {
    const end = (uniqueStarts[index + 1] ?? lines.length + 1) - 1;
    const content = lines.slice(start - 1, end).join("\n");
    if (!content.trim()) return [];
    const active = sections.filter((section) => section.line <= start);
    const stack: string[] = [];
    active.forEach((section) => {
      stack.length = section.level - 1;
      stack.push(section.title);
    });
    return [{
      file_path: filePath,
      heading_path: stack.join(" > ") || "Document",
      start_line: start,
      end_line: end,
      content,
    }];
  });
}

function codeChunks(filePath: string, lines: string[]): DocChunk[] {
  const starts: number[] = [];
  let braceDepth = 0;
  let inBlockComment = false;
  let quote = "";
  let escaped = false;
  const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:function\b|class\b|interface\b|type\b|enum\b|namespace\b|def\b|fn\b|func\b|struct\b|impl\b|trait\b|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|(?:public|private|protected|static|abstract|async\s+)*[\w$]+\s*\([^;]*\)\s*\{)/;

  lines.forEach((line, index) => {
    if (braceDepth === 0 && !inBlockComment && quote !== "`" && declaration.test(line) && line.trim()) {
      starts.push(index + 1);
    }

    for (let cursor = 0; cursor < line.length; cursor += 1) {
      const char = line[cursor];
      const next = line[cursor + 1];
      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          cursor += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) {
          quote = "";
        }
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        cursor += 1;
      } else if (char === "/" && next === "/") {
        break;
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
    if (quote !== "`") {
      quote = "";
      escaped = false;
    }
  });

  if (!starts.length || starts[0] !== 1) starts.unshift(1);
  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  return uniqueStarts.flatMap((start, index) => {
    const end = (uniqueStarts[index + 1] ?? lines.length + 1) - 1;
    const content = lines.slice(start - 1, end).join("\n");
    return content.trim() ? [{
      file_path: filePath,
      heading_path: `Code · ${content.split("\n")[0].trim().slice(0, 100)}`,
      start_line: start,
      end_line: end,
      content,
    }] : [];
  });
}

export function chunkFile(filePath: string, rawContent: string): DocChunk[] {
  const lines = rawContent.replace(/\r\n/g, "\n").split("\n");
  const chunks = isMarkdown(filePath)
    ? markdownChunks(filePath, lines)
    : isCode(filePath) ? codeChunks(filePath, lines) : textChunks(filePath, lines);
  return chunks.flatMap(splitOversized);
}
