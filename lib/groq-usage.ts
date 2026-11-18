export type GroqUsageTotals = {
  input_tokens: number;
  output_tokens: number;
};

export function emptyGroqUsage(): GroqUsageTotals {
  return { input_tokens: 0, output_tokens: 0 };
}

export function addGroqUsage(
  totals: GroqUsageTotals,
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null },
) {
  totals.input_tokens += usage?.prompt_tokens ?? 0;
  totals.output_tokens += usage?.completion_tokens ?? 0;
}
