import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireApiSession } from "@/lib/auth";
import { validateIndexedPath } from "@/lib/indexed-path";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getPublicSupabaseError, getSupabaseErrorLogCode } from "@/lib/supabase-errors";

export async function GET(request: Request) {
  const authError = requireApiSession(request);
  if (authError) return authError;
  try {
    const supabase = getSupabase();
    const [{ data, error }, { data: chunks, error: chunkError }] = await Promise.all([
      supabase.from("source_files").select("file_path,raw_content,line_count").order("file_path"),
      supabase.from("doc_chunks").select("file_path"),
    ]);
    if (error || chunkError) {
      const sourceError = error ?? chunkError;
      console.error("Indexed file query failed.", getSupabaseErrorLogCode(sourceError));
      return NextResponse.json({ error: getPublicSupabaseError(sourceError) }, { status: 500 });
    }
    const chunkCounts = new Map<string, number>();
    for (const chunk of chunks ?? []) chunkCounts.set(chunk.file_path, (chunkCounts.get(chunk.file_path) ?? 0) + 1);
    return NextResponse.json(
      { files: (data ?? []).map((file) => ({ ...file, chunk_count: chunkCounts.get(file.file_path) ?? 0 })) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Indexed file listing failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: getPublicSupabaseError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authError = requireApiSession(request);
  if (authError) return authError;
  if (!consumeRateLimit(request, "file-delete", 30, 60_000)) {
    return NextResponse.json({ error: "Too many file operations. Try again shortly." }, { status: 429 });
  }
  try {
    const rawPath = new URL(request.url).searchParams.get("file_path");
    const filePath = rawPath ? validateIndexedPath(rawPath) : null;
    if (!filePath) return NextResponse.json({ error: "file_path is required." }, { status: 400 });
    const { error } = await getSupabase().from("source_files").delete().eq("file_path", filePath);
    if (error) throw new Error("Could not delete indexed file.");
    return NextResponse.json({ ok: true, file_path: filePath }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("file_path")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Indexed file deletion failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Could not delete indexed file." }, { status: 500 });
  }
}
