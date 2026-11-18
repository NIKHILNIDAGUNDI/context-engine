import type { IngestProgress } from "@/lib/ingest";

type IngestPhase = IngestProgress["phase"] | "starting";

export function getPublicIngestError(error: unknown, phase: IngestPhase) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid api key") || normalized.includes("invalid jwt")) {
    return "Supabase rejected SUPABASE_SERVICE_ROLE_KEY as invalid. Copy the service_role (secret) key from this project, update .env.local, and restart the Next.js server.";
  }
  if (
    normalized.includes("could not store source files") ||
    normalized.includes("could not replace old chunks") ||
    normalized.includes("could not store document chunks") ||
    normalized.includes("relation") && normalized.includes("does not exist") ||
    normalized.includes("function") && normalized.includes("does not exist")
  ) {
    return "Supabase could not save the upload. Check that supabase/schema.sql has been run and that SUPABASE_SERVICE_ROLE_KEY is the project's service-role key.";
  }

  if (phase === "embedding" || normalized.includes("gemini") || normalized.includes("api_key_invalid") || normalized.includes("resource_exhausted")) {
    return "Gemini could not generate embeddings. Check that GEMINI_API_KEY is valid, has access to gemini-embedding-001, and has available quota.";
  }

  if (phase === "storing") {
    return "Supabase could not save the upload. Check that supabase/schema.sql has been run and that SUPABASE_SERVICE_ROLE_KEY is the project's service-role key.";
  }

  return "The upload could not be indexed. Check the server terminal for the failure details, then verify the Supabase schema and Gemini API key.";
}
