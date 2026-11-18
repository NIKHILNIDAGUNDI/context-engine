import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeLoginAttempt, createSessionToken, isAccessKeyConfigured, isSameOriginRequest, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyAccessKey } from "@/lib/auth";
import { PayloadTooLargeError, readBoundedBody } from "@/lib/bounded-body";

const loginSchema = z.object({ access_key: z.string().min(1).max(512) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  if (!isAccessKeyConfigured()) {
    return NextResponse.json({ error: "Server access is not configured." }, { status: 503 });
  }
  if (!consumeLoginAttempt(request)) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again in ten minutes." }, { status: 429 });
  }

  try {
    const bytes = await readBoundedBody(request, 2048);
    const payload = loginSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!verifyAccessKey(payload.access_key)) {
      return NextResponse.json({ error: "Invalid access key." }, { status: 401 });
    }
    const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "Sign-in request is too large." }, { status: 413 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Provide a valid access key." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
