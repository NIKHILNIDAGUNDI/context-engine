export type CitationPolicy = "strict" | "lenient";

// strict (default): every citation must be verified or the whole answer is withheld.
// lenient: the answer is shown when at least one citation is verified; unverified citations are
// dropped and the answer carries a visible warning.
export function getCitationPolicy(value = process.env.CITATION_POLICY): CitationPolicy {
  return value?.trim().toLowerCase() === "lenient" ? "lenient" : "strict";
}

export type AnswerDecisionInput = {
  modelAbstained: boolean;
  answer: string;
  unresolvedCount: number;
  usedIndicesValid: boolean;
  usedCount: number;
  citationCount: number;
  groundedCount: number;
  policy: CitationPolicy;
};

export function decideAnswer(input: AnswerDecisionInput) {
  const unverifiedCitations = Math.max(0, input.citationCount - input.groundedCount);
  const reason =
    input.modelAbstained ? "model_abstained"
    : input.unresolvedCount > 0 ? "unresolved_subquestions"
    : !input.usedIndicesValid || input.usedCount === 0 ? "invalid_evidence_indices"
    : !input.answer.trim() ? "empty_answer"
    : input.groundedCount === 0 ? "citations_not_grounded"
    : input.policy === "strict" && unverifiedCitations > 0 ? "citations_not_grounded"
    : null;
  return { abstained: reason !== null, reason, unverifiedCitations };
}

export function unverifiedCitationNote(unverified: number, total: number) {
  return `\n\n> **Check the sources:** ${unverified} of ${total} cited passages could not be matched word for word to the indexed text, so some statements above may paraphrase it. Only the citations listed below were verified.`;
}
