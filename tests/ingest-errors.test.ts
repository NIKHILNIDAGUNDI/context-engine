import { describe, expect, it } from "vitest";
import { getPublicIngestError } from "@/lib/ingest-errors";

describe("ingestion error guidance", () => {
  it("points database write failures to schema and service-role configuration", () => {
    expect(getPublicIngestError(new Error("Could not store source files: relation does not exist"), "storing"))
      .toContain("supabase/schema.sql");
  });

  it("points embedding failures to Gemini key, model access, and quota without exposing raw errors", () => {
    const raw = "Gemini request failed: API key secret-value";
    const message = getPublicIngestError(new Error(raw), "embedding");
    expect(message).toContain("GEMINI_API_KEY");
    expect(message).not.toContain("secret-value");
  });

  it("distinguishes an invalid Supabase key from Gemini embedding failures", () => {
    const message = getPublicIngestError(new Error("Invalid API key"), "storing");
    expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(message).not.toContain("GEMINI_API_KEY");
  });

  it("gives a neutral diagnostic when the failing stage is not known", () => {
    expect(getPublicIngestError(new Error("Unexpected backend failure"), "starting"))
      .toContain("server terminal");
  });
});
