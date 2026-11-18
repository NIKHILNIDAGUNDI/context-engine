type SupabaseErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
};

function details(error: unknown): SupabaseErrorLike {
  if (typeof error !== "object" || error === null) return {};
  return error as SupabaseErrorLike;
}

export function getSupabaseErrorLogCode(error: unknown) {
  const { code, status } = details(error);
  return {
    code: typeof code === "string" ? code.slice(0, 40) : undefined,
    status: typeof status === "number" ? status : undefined,
  };
}

export function getPublicSupabaseError(error: unknown) {
  const { code, status, message } = details(error);
  const text = (message ?? "").toLowerCase();

  if (text.includes("invalid api key") || text.includes("invalid jwt")) {
    return "Supabase rejected SUPABASE_SERVICE_ROLE_KEY as invalid. Copy the service_role (secret) key from this exact Supabase project and restart the Next.js server.";
  }
  if (code === "42P01" || code === "PGRST205" || text.includes("does not exist")) {
    return "Supabase tables are missing. Run the complete supabase/schema.sql in the SQL Editor for the same project URL configured in .env.local.";
  }
  if (code === "42501" || status === 401 || status === 403) {
    return "Supabase rejected database access. Verify SUPABASE_SERVICE_ROLE_KEY belongs to the project in NEXT_PUBLIC_SUPABASE_URL.";
  }
  return "Could not load indexed files from Supabase. Verify the project URL and service-role key, then check the server terminal for the Supabase error code.";
}
