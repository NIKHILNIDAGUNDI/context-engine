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
