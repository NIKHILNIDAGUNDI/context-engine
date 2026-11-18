import { NextResponse } from "next/server";
import { ingestFiles } from "@/lib/ingest";
import { SAMPLE_FILES, SAMPLE_QUESTION } from "@/lib/sample-files";
import { requireApiSession } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const authError = requireApiSession(request);
  if (authError) return authError;
  if (!consumeRateLimit(request, "seed", 5, 60_000)) {
    return NextResponse.json({ error: "Too many seed requests. Try again shortly." }, { status: 429 });
  }
  try {
    const result = await ingestFiles(SAMPLE_FILES);
    return NextResponse.json(
      { ok: true, ...result, files: SAMPLE_FILES.map((file) => file.file_path), sample_question: SAMPLE_QUESTION },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Sample repository ingestion failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Could not seed sample repository." }, { status: 500 });
  }
}
