import { getSupabase } from "@/lib/supabase";
import { chunkFile } from "@/lib/chunker";
import { embedTexts } from "@/lib/embeddings";

const MAX_FILES_PER_INGEST = 20;
const MAX_CHUNKS_PER_INGEST = 256;

export type InputFile = { file_path: string; raw_content: string };
export type IngestProgress = {
  file_path: string;
  phase: "chunking" | "embedding" | "storing" | "indexed";
  chunks?: number;
};

export async function ingestFiles(files: InputFile[], onProgress?: (progress: IngestProgress) => void) {
  if (files.length < 1 || files.length > MAX_FILES_PER_INGEST) {
    throw new Error(`An ingestion request must contain 1-${MAX_FILES_PER_INGEST} files.`);
  }
  const supabase = getSupabase();
  const chunksByFile = new Map(files.map((file) => [file.file_path, chunkFile(file.file_path, file.raw_content)]));
  files.forEach((file) => onProgress?.({ file_path: file.file_path, phase: "chunking", chunks: chunksByFile.get(file.file_path)?.length ?? 0 }));
  const chunks = [...chunksByFile.values()].flat();
  if (chunks.length > MAX_CHUNKS_PER_INGEST) {
    throw new Error(`Ingestion request exceeds the ${MAX_CHUNKS_PER_INGEST}-chunk indexing limit.`);
  }
  const signal = AbortSignal.timeout(90_000);
  const embedded: Array<(typeof chunks)[number] & { embedding: number[] }> = [];

  files.forEach((file) => onProgress?.({ file_path: file.file_path, phase: "embedding" }));
  for (let offset = 0; offset < chunks.length; offset += 64) {
    const batch = chunks.slice(offset, offset + 64);
    const vectors = await embedTexts(batch.map((chunk) => chunk.content.slice(0, 12000)), signal);
    batch.forEach((chunk, index) => {
      const embedding = vectors[index];
      if (chunk.content.trim() && !embedding) throw new Error("Gemini did not return an embedding for a non-empty document chunk.");
      if (embedding) embedded.push({ ...chunk, embedding });
    });
  }

  files.forEach((file) => onProgress?.({ file_path: file.file_path, phase: "storing" }));
  const sourceRows = files.map(({ file_path, raw_content }) => ({
    file_path,
    raw_content,
    line_count: raw_content.replace(/\r\n/g, "\n").split("\n").length,
  }));
  const { error: sourceError } = await supabase.from("source_files").upsert(sourceRows, { onConflict: "file_path" });
  if (sourceError) throw new Error(`Could not store source files: ${sourceError.message}`);

  const paths = files.map((file) => file.file_path);
  const { error: deleteError } = await supabase.from("doc_chunks").delete().in("file_path", paths);
  if (deleteError) throw new Error(`Could not replace old chunks: ${deleteError.message}`);

  for (let offset = 0; offset < embedded.length; offset += 64) {
    const batch = embedded.slice(offset, offset + 64);
    const { error } = await supabase.from("doc_chunks").insert(batch);
    if (error) throw new Error(`Could not store document chunks: ${error.message}`);
  }
  files.forEach((file) => onProgress?.({ file_path: file.file_path, phase: "indexed", chunks: chunksByFile.get(file.file_path)?.length ?? 0 }));
  return { files: files.length, chunks: chunks.length };
}
