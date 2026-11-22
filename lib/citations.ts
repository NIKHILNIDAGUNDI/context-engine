import type { ContextSnippet } from "@/lib/context-packer";

export type QuotedCitation = {
  file_path: string;
  start_line: number;
  end_line: number;
  quote: string;
};

export function citationQuoteIsGrounded(citation: QuotedCitation, snippets: ContextSnippet[]) {
  if (!citation.quote.trim() || citation.start_line > citation.end_line) return false;
  return snippets.some((snippet) => {
    if (
      snippet.file_path !== citation.file_path ||
      citation.start_line < snippet.start_line ||
      citation.end_line > snippet.end_line
    ) return false;
    const citedLines = snippet.content.split("\n").slice(
      citation.start_line - snippet.start_line,
      citation.end_line - snippet.start_line + 1,
    );
    return citedLines.join("\n").includes(citation.quote);
  });
}

// PDF/DOCX extraction breaks words and lines arbitrarily ("O\nur future"), swaps symbols such as the
// rupee sign, and models quote with clean punctuation and case. Matching therefore compares only
// letters and digits, case-insensitively, and the line range is computed from where the quote is
// actually found rather than trusting line numbers the model guessed.
const MIN_QUOTE_CHARS = 8;

function letters(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function resolveCitationLines(quote: string, snippet: ContextSnippet): { start_line: number; end_line: number } | null {
  const fragments = quote.split(/\.{3}|\u2026/).map(letters).filter((fragment) => fragment.length >= MIN_QUOTE_CHARS);
  if (!fragments.length) return null;

  let haystack = "";
  const lineOf: number[] = [];
  snippet.content.split("\n").forEach((line, index) => {
    for (const char of letters(line)) {
      haystack += char;
      lineOf.push(index);
    }
  });

  let cursor = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (const fragment of fragments) {
    const found = haystack.indexOf(fragment, cursor);
    if (found < 0) return null;
    if (firstIndex < 0) firstIndex = found;
    lastIndex = found + fragment.length - 1;
    cursor = lastIndex + 1;
  }
  return {
    start_line: snippet.start_line + lineOf[firstIndex],
    end_line: snippet.start_line + lineOf[lastIndex],
  };
}
