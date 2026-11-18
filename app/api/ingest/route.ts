import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestFiles } from "@/lib/ingest";
import { parseDocument, type ParsedDocument } from "@/lib/file-parser";
import { requireApiSession } from "@/lib/auth";
import { PayloadTooLargeError, readBoundedBody } from "@/lib/bounded-body";
import { validateIndexedPath } from "@/lib/indexed-path";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getPublicIngestError } from "@/lib/ingest-errors";
import type { IngestProgress } from "@/lib/ingest";
import { getSupabaseErrorLogCode } from "@/lib/supabase-errors";

export const runtime = "nodejs";
const MAX_INGEST_BODY_BYTES = 22 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 20;

const requestSchema = z.object({
  files: z.array(z.object({
    file_path: z.string().min(1).max(500).refine((path) => {
      try { validateIndexedPath(path); return true; } catch { return false; }
    }, "file_path must be a safe relative indexed path."),
    raw_content: z.string().max(1_000_000),
  })).min(1).max(MAX_FILES_PER_REQUEST),
});

export async function POST(request: Request) {
  const authError = requireApiSession(request);
  if (authError) return authError;
  if (!consumeRateLimit(request, "ingest", 5, 60_000)) {
    return NextResponse.json({ error: "Too many ingestion requests. Try again shortly." }, { status: 429 });
  }
  try {
    const requestBody = await readBoundedBody(request, MAX_INGEST_BODY_BYTES);
    const contentType = request.headers.get("content-type") ?? "";
    if (/^multipart\/form-data(?:;|$)/i.test(contentType)) {
      const boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.from(requestBody) });
      let formData: FormData;
      try {
        formData = await boundedRequest.formData();
      } catch {
        return NextResponse.json({ error: "Multipart upload is malformed or missing its boundary." }, { status: 400 });
      }
      const uploaded = formData.getAll("files");
      if (!uploaded.length || uploaded.some((file) => typeof file === "string")) {
        return NextResponse.json({ error: "Select at least one supported file to upload." }, { status: 400 });
      }
      if (uploaded.length > MAX_FILES_PER_REQUEST) return NextResponse.json({ error: `Upload no more than ${MAX_FILES_PER_REQUEST} files at a time.` }, { status: 400 });
      const totalFileBytes = (uploaded as File[]).reduce((total, file) => total + file.size, 0);
      if (totalFileBytes > 20 * 1024 * 1024) return NextResponse.json({ error: "Combined file size exceeds the 20 MB per-request limit." }, { status: 413 });
      const parsed: ParsedDocument[] = [];
      for (const file of uploaded as File[]) {
        try {
          parsed.push(await parseDocument(file.name, new Uint8Array(await file.arrayBuffer()), file.type));
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : `Could not parse ${file.name}.` }, { status: 400 });
        }
      }
      const uniquePaths = new Set(parsed.map((file) => file.file_path));
      if (uniquePaths.size !== parsed.length) {
        return NextResponse.json({ error: "Uploaded filenames must be unique." }, { status: 400 });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          let phase: IngestProgress["phase"] | "starting" = "starting";
          void ingestFiles(parsed, (progress) => {
            phase = progress.phase;
            send({ type: "progress", ...progress });
          })
            .then((result) => send({ type: "complete", ...result }))
            .catch((error: unknown) => {
              const publicError = getPublicIngestError(error, phase);
              console.error("Document ingestion failed.", { phase, diagnostic: publicError, ...getSupabaseErrorLogCode(error) });
              send({ type: "error", error: publicError });
            })
            .finally(() => controller.close());
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
      });
    }

    const payload = requestSchema.parse(JSON.parse(new TextDecoder().decode(requestBody)));
    const uniquePaths = new Set(payload.files.map((file) => file.file_path));
    if (uniquePaths.size !== payload.files.length) {
      return NextResponse.json({ error: "file_path values must be unique within an ingestion request." }, { status: 400 });
    }
    const result = await ingestFiles(payload.files);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "Ingestion request exceeds the 20 MB per-request limit." }, { status: 413 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ingestion request must be valid JSON or multipart form data." }, { status: 400 });
    console.error("Document ingestion request failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Ingestion failed. Check server configuration and try again." }, { status: 500 });
  }
}
