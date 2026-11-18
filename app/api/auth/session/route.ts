import { NextResponse } from "next/server";
import { hasValidSession, isAccessKeyConfigured } from "@/lib/auth";

export async function GET(request: Request) {
  return NextResponse.json(
    { configured: isAccessKeyConfigured(), authenticated: hasValidSession(request) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
