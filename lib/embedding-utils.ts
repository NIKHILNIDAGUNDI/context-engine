export function normalizeEmbeddingInputs(texts: string[]) {
  return texts.map((text) => text.trim() ? text : null);
}
