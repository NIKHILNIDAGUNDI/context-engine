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

function fold(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Models often number their quoted lists ("1. Cryptography ... 2. Intelligence") although the
// extracted PDF text has no such digits. Only standalone list markers are removed, never figures.
function stripListMarkers(quote: string) {
  return quote.replace(/(^|\s)\d{1,2}[.)]\s+/g, "$1");
}

function buildHaystack(snippet: ContextSnippet) {
  let haystack = "";
  const lineOf: number[] = [];
  snippet.content.split("\n").forEach((line, index) => {
    for (const char of fold(line)) {
      haystack += char;
      lineOf.push(index);
    }
  });
  return { haystack, lineOf };
}

function splitQuote(quote: string) {
  return quote.split(/\.{3}|\u2026/).map((original) => ({ original: original.trim(), folded: fold(original) }));
}

// A quote is exact when every fragment is found in order. When a long fragment only matches at
// its start (models condense list items into one quote), a partial match is accepted if the
// matched start is at least MIN_ANCHOR_CHARS long and every number in the unmatched remainder
// also occurs in the evidence, so an invented figure cannot ride along with a real opening.
const MIN_ANCHOR_CHARS = 24;

function locate(quote: string, snippet: ContextSnippet, allowPartial = false) {
  const fragments = splitQuote(quote).map((fragment) => fragment.folded).filter((fragment) => fragment.length >= MIN_QUOTE_CHARS);
  if (!fragments.length) return null;
  const { haystack, lineOf } = buildHaystack(snippet);

  let cursor = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (const fragment of fragments) {
    let found = haystack.indexOf(fragment, cursor);
    let matchedLength = fragment.length;
    if (found < 0 && allowPartial) {
      for (let length = fragment.length - 1; length >= MIN_ANCHOR_CHARS; length -= 1) {
        const position = haystack.indexOf(fragment.slice(0, length), cursor);
        if (position < 0) continue;
        const remainderNumbers = fragment.slice(length).match(/\d{2,}/g) ?? [];
        if (remainderNumbers.every((number) => haystack.includes(number))) {
          found = position;
          matchedLength = length;
        }
        break;
      }
    }
    if (found < 0) return null;
    if (firstIndex < 0) firstIndex = found;
    lastIndex = found + matchedLength - 1;
    cursor = lastIndex + 1;
  }
  return {
    start_line: snippet.start_line + lineOf[firstIndex],
    end_line: snippet.start_line + lineOf[lastIndex],
  };
}

export function resolveCitationLines(quote: string, snippet: ContextSnippet): { start_line: number; end_line: number; partial: boolean } | null {
  const exact = locate(quote, snippet) ?? locate(stripListMarkers(quote), snippet);
  if (exact) return { ...exact, partial: false };
  const partial = locate(stripListMarkers(quote), snippet, true);
  return partial ? { ...partial, partial: true } : null;
}

// For server logs: says which quote fragments are missing from the evidence entirely (as opposed
// to present but out of order), so a failed citation can be traced to its cause.
export function diagnoseCitation(quote: string, snippet: ContextSnippet) {
  const { haystack } = buildHaystack(snippet);
  return splitQuote(stripListMarkers(quote)).map((fragment) => ({
    fragment: fragment.original.slice(0, 80),
    letters_and_digits: fragment.folded.length,
    counted: fragment.folded.length >= MIN_QUOTE_CHARS,
    in_evidence: fragment.folded.length >= MIN_QUOTE_CHARS ? haystack.includes(fragment.folded) : null,
  }));
}
