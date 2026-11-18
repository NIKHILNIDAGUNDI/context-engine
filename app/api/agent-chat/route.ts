import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent";
import { requireApiSession } from "@/lib/auth";
import { PayloadTooLargeError, readBoundedBody } from "@/lib/bounded-body";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getAgentFailureDiagnostic, getAgentFailureLogDetails } from "@/lib/agent-errors";

const requestSchema = z.object({ question: z.string().trim().min(1).max(4000) });

export async function POST(request: Request) {
  const authError = requireApiSession(request);
  if (authError) return authError;
  if (!consumeRateLimit(request, "agent-chat", 20, 60_000)) {
    return NextResponse.json({ error: "Too many research requests. Try again shortly." }, { status: 429 });
  }
  try {
    const bytes = await readBoundedBody(request, 16 * 1024);
    const { question } = requestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    return NextResponse.json(await runAgent(question), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "Question request is too large." }, { status: 413 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid question." }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Question request must be valid JSON." }, { status: 400 });
    const diagnostic = getAgentFailureDiagnostic(error);
    console.error("Agent request failed.", { diagnostic, ...getAgentFailureLogDetails(error) });
    return NextResponse.json({ error: diagnostic }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
