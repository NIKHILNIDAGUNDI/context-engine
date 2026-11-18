import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, hasValidSession, isSameOriginRequest, verifyAccessKey } from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as session } from "@/app/api/auth/session/route";

const originalKey = process.env.CONTEXT_ENGINE_ACCESS_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CONTEXT_ENGINE_ACCESS_KEY;
  else process.env.CONTEXT_ENGINE_ACCESS_KEY = originalKey;
});

describe("single-tenant session auth", () => {
  it("uses a signed, expiring, HttpOnly cookie token and compares access keys safely", () => {
    process.env.CONTEXT_ENGINE_ACCESS_KEY = "a".repeat(40);
    expect(verifyAccessKey("a".repeat(40))).toBe(true);
    expect(verifyAccessKey("wrong")).toBe(false);
    const now = 1_800_000_000_000;
    const token = createSessionToken(now);
    const request = new Request("https://context.test/api/files", {
      headers: { cookie: `context_engine_session=${token}` },
    });
    expect(hasValidSession(request, now)).toBe(true);
    expect(hasValidSession(request, now + 13 * 60 * 60 * 1000)).toBe(false);
    expect(hasValidSession(new Request("https://context.test/api/files", { headers: { cookie: `context_engine_session=${token}x` } }), now)).toBe(false);
  });

  it("rejects weak or missing server access keys and cross-origin mutations", () => {
    process.env.CONTEXT_ENGINE_ACCESS_KEY = "too-short";
    expect(verifyAccessKey("too-short")).toBe(false);
    expect(hasValidSession(new Request("https://context.test/api/files"))).toBe(false);
    process.env.CONTEXT_ENGINE_ACCESS_KEY = "replace-with-a-random-32-character-or-longer-secret";
    expect(verifyAccessKey("replace-with-a-random-32-character-or-longer-secret")).toBe(false);
    expect(isSameOriginRequest(new Request("https://context.test/api/ingest", { method: "POST", headers: { origin: "https://evil.test" } }))).toBe(false);
    expect(isSameOriginRequest(new Request("https://context.test/api/ingest", { method: "POST", headers: { origin: "https://context.test" } }))).toBe(true);
  });

  it("sets a protected session cookie on valid same-origin login", async () => {
    const secret = "valid-workspace-key-12345678901234567890";
    process.env.CONTEXT_ENGINE_ACCESS_KEY = secret;
    const response = await login(new Request("https://context.test/api/auth/login", {
      method: "POST",
      headers: { origin: "https://context.test", "content-type": "application/json", "x-real-ip": "198.51.100.40" },
      body: JSON.stringify({ access_key: secret }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie).toContain("Secure");
    const token = cookie.split(";")[0];
    const status = await session(new Request("https://context.test/api/auth/session", { headers: { cookie: token } }));
    expect(await status.json()).toEqual({ configured: true, authenticated: true });
  });
});
