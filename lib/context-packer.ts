import { getEncoding } from "js-tiktoken";

export type ContextSnippet = {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  heading_path?: string;
};

export type PackedSnippet = ContextSnippet & {
  status: "relevant" | "pruned";
  reason?: string;
  budget_truncated?: boolean;
};

export type PackedContext = {
  prompt: string;
  snippets: PackedSnippet[];
  token_count: number;
  relevant_count: number;
  pruned_count: number;
  budget_pruned_count: number;
};

const TOKEN_LIMIT = 4000;
const encoder = getEncoding("cl100k_base");

function render(snippet: ContextSnippet) {
  return `### ${snippet.file_path}:${snippet.start_line}-${snippet.end_line}${snippet.heading_path ? ` (${snippet.heading_path})` : ""}\n${snippet.content}`;
}

export function mergeContextSnippets(snippets: ContextSnippet[]): ContextSnippet[] {
  const sorted = [...snippets].sort((a, b) =>
    a.file_path.localeCompare(b.file_path) || a.start_line - b.start_line || a.end_line - b.end_line
  );
  const merged: ContextSnippet[] = [];
  for (const snippet of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.file_path !== snippet.file_path || snippet.start_line > previous.end_line + 1) {
      merged.push({ ...snippet });
      continue;
    }

    const firstLine = Math.min(previous.start_line, snippet.start_line);
    const lastLine = Math.max(previous.end_line, snippet.end_line);
    const lineMap = new Map<number, string>();
    previous.content.split("\n").forEach((line, index) => lineMap.set(previous.start_line + index, line));
    snippet.content.split("\n").forEach((line, index) => lineMap.set(snippet.start_line + index, line));
    previous.start_line = firstLine;
    previous.end_line = lastLine;
    previous.content = Array.from({ length: lastLine - firstLine + 1 }, (_, index) => lineMap.get(firstLine + index) ?? "").join("\n");
    previous.heading_path = [previous.heading_path, snippet.heading_path].filter(Boolean).join(" / ");
  }
  return merged;
}

function tokenCount(value: string) {
  return encoder.encode(value).length;
}

export function packContext(input: ContextSnippet[], maxTokens = TOKEN_LIMIT): PackedContext {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > TOKEN_LIMIT) {
    throw new RangeError(`Context token budget must be between 1 and ${TOKEN_LIMIT}.`);
  }
  const merged = mergeContextSnippets(input);
  const packed: PackedSnippet[] = [];
  const included: string[] = [];
  let usedTokens = 0;
  let budgetPrunedCount = 0;

  for (const snippet of merged) {
    const complete = render(snippet);
    const completeCost = tokenCount([...included, complete].join("\n\n"));
    if (completeCost <= maxTokens) {
      packed.push({ ...snippet, status: "relevant" });
      included.push(complete);
      usedTokens = completeCost;
      continue;
    }

    const lines = snippet.content.split("\n");
    let best: { text: string; start: number; end: number; cost: number } | undefined;
    for (let count = 1; count <= lines.length; count += 1) {
      const partial = { ...snippet, start_line: snippet.start_line, end_line: snippet.start_line + count - 1, content: lines.slice(0, count).join("\n") };
      const text = render(partial);
      const cost = tokenCount([...included, text].join("\n\n"));
      if (cost <= maxTokens) best = { text, start: partial.start_line, end: partial.end_line, cost };
      else break;
    }
    if (best) {
      packed.push({ ...snippet, start_line: best.start, end_line: best.end, content: lines.slice(0, best.end - snippet.start_line + 1).join("\n"), status: "relevant", budget_truncated: true });
      included.push(best.text);
      usedTokens = best.cost;
      budgetPrunedCount += 1;
    } else {
      packed.push({ ...snippet, status: "pruned", reason: "Exceeded the 4,000-token context budget." });
      budgetPrunedCount += 1;
    }
  }

  return {
    prompt: included.join("\n\n"),
    snippets: packed,
    token_count: usedTokens,
    relevant_count: packed.filter((snippet) => snippet.status === "relevant").length,
    pruned_count: packed.filter((snippet) => snippet.status === "pruned").length,
    budget_pruned_count: budgetPrunedCount,
  };
}

export const MAX_CONTEXT_TOKENS = TOKEN_LIMIT;
