import { describe, expect, it } from "vitest";
import { getPublicSupabaseError, getSupabaseErrorLogCode } from "@/lib/supabase-errors";

describe("Supabase error diagnostics", () => {
  it("directs missing relation errors to the SQL schema setup", () => {
    expect(getPublicSupabaseError({ code: "42P01", message: "relation does not exist" }))
      .toContain("supabase/schema.sql");
  });

  it("identifies denied access without returning raw server details", () => {
    const raw = { code: "42501", message: "private token data" };
    expect(getPublicSupabaseError(raw)).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(getPublicSupabaseError(raw)).not.toContain("private token data");
    expect(getSupabaseErrorLogCode(raw)).toEqual({ code: "42501", status: undefined });
  });

  it("explains invalid Supabase keys without revealing the rejected key", () => {
    const raw = { message: "Invalid API key: sensitive-value" };
    expect(getPublicSupabaseError(raw)).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(getPublicSupabaseError(raw)).not.toContain("sensitive-value");
  });
});
