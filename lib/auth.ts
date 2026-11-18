import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "context_engine_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function accessKey() {
  const key = process.env.CONTEXT_ENGINE_ACCESS_KEY;
  return key && key.length >= 32 && !key.startsWith("replace-with-") ? key : null;
}

function signature(expiresAt: number, key: string) {
  return createHmac("sha256", key).update(`context-engine-session:v1:${expiresAt}`).digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function isAccessKeyConfigured() {
  return accessKey() !== null;
}

export function verifyAccessKey(candidate: string) {
  const key = accessKey();
  return !!key && candidate.length <= 512 && constantTimeEqual(candidate, key);
}

export function createSessionToken(now = Date.now()) {
  const key = accessKey();
  if (!key) throw new Error("Access authentication is not configured.");
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${signature(expiresAt, key)}`;
}

export function hasValidSession(request: Request, now = Date.now()) {
  const key = accessKey();
  if (!key) return false;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;
  const value = cookie.slice(SESSION_COOKIE.length + 1);
  const [expiresText, receivedSignature, ...extra] = value.split(".");
  if (extra.length || !/^\d{1,12}$/.test(expiresText) || !receivedSignature) return false;
  const expiresAt = Number(expiresText);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + SESSION_TTL_SECONDS + 60) return false;
  return constantTimeEqual(receivedSignature, signature(expiresAt, key));
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function consumeLoginAttempt(request: Request, now = Date.now()) {
  const identifier = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (loginAttempts.size > 5000) {
    for (const [key, value] of loginAttempts) {
      if (value.resetAt <= now) loginAttempts.delete(key);
    }
  }
  const current = loginAttempts.get(identifier);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(identifier, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

export function requireApiSession(request: Request) {
  if (!isAccessKeyConfigured()) {
    return NextResponse.json({ error: "Server access is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasValidSession(request)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "GET" && !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
