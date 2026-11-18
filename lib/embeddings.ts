import { getGemini, withGeminiRetry } from "@/lib/gemini";
import { normalizeEmbeddingInputs } from "@/lib/embedding-utils";

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 1536;
const MAX_EMBEDDING_BATCH_SIZE = 64;

export async function embedTexts(texts: string[], signal: AbortSignal): Promise<Array<number[] | null>> {
  const normalized = normalizeEmbeddingInputs(texts);
  const results: Array<number[] | null> = Array.from({ length: texts.length }, () => null);
  const batchIndexes = normalized.flatMap((text, index) => text === null ? [] : [index]);
  if (!batchIndexes.length) return results;
  const ai = getGemini();

  for (let offset = 0; offset < batchIndexes.length; offset += MAX_EMBEDDING_BATCH_SIZE) {
    const indexes = batchIndexes.slice(offset, offset + MAX_EMBEDDING_BATCH_SIZE);
    const batch = indexes.map((index) => normalized[index]).filter((text): text is string => text !== null);
    const response = await withGeminiRetry(() => ai.models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || GEMINI_EMBEDDING_MODEL,
      contents: batch,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: EMBEDDING_DIMENSIONS,
        abortSignal: signal,
      },
    }), signal);

    if (!response.embeddings || response.embeddings.length !== indexes.length) {
      throw new Error("Gemini returned an incomplete embedding batch.");
    }
    response.embeddings.forEach((embedding, index) => {
      if (!embedding.values || embedding.values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error("Gemini returned an embedding with an unexpected dimension.");
      }
      results[indexes[index]] = embedding.values;
    });
  }
  return results;
}

export async function embedQuery(text: string, signal: AbortSignal) {
  const normalized = text.trim();
  if (!normalized) throw new Error("Search query cannot be empty.");
  const ai = getGemini();
  const response = await withGeminiRetry(() => ai.models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || GEMINI_EMBEDDING_MODEL,
    contents: normalized,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSIONS,
      abortSignal: signal,
    },
  }), signal);
  const embedding = response.embeddings?.[0]?.values;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Gemini returned a query embedding with an unexpected dimension.");
  }
  return embedding;
}
