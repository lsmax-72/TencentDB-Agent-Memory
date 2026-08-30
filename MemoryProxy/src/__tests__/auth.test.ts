import { afterEach, describe, expect, it, vi } from "vitest";
import { initAuth, verifyUserKey } from "../auth.js";
import { buildConfig } from "../config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => { initAuth({ enabled: false, url: "", timeoutMs: 0 }); vi.unstubAllGlobals(); });

describe("gateway-authenticated user verification", () => {
  it("loads the optional gateway credential through the YAML config contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "phase6-auth-test-"));
    try {
      const file = join(dir, "config.yaml");
      writeFileSync(file, "auth:\n  enabled: true\n  url: http://test-core\n  apiKey: service-secret\n");
      expect(buildConfig({ configFile: file }).auth.apiKey).toBe("service-secret");
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("sends the service Bearer separately from the user key", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 0, data: { valid: true, user: { user_id: "u" } } }));
    vi.stubGlobal("fetch", fetcher);
    initAuth({ enabled: true, url: "http://test-core/", apiKey: "service-secret", timeoutMs: 100 });
    expect(await verifyUserKey("user-secret", "test-space")).toEqual({ userId: "u", rejected: false });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://test-core/v3/meta/auth/verify");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer service-secret");
    expect(new Headers(options.headers).get("x-tdai-service-id")).toBe("test-space");
    expect(JSON.parse(String(options.body))).toEqual({ user_key: "user-secret" });
  });

  it("preserves optional gateway credentials without forwarding the caller key as Bearer", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    initAuth({ enabled: true, url: "http://test-core", timeoutMs: 100 });
    expect((await verifyUserKey("user-secret", "s")).rejected).toBe(true);
    const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });

  it("refuses enabled auth without a URL instead of silently disabling verification", () => {
    expect(() => initAuth({ enabled: true, url: "", timeoutMs: 100 })).toThrow(/url/i);
  });

  it("rejects invalid identity, malformed responses and unavailable auth services", async () => {
    initAuth({ enabled: true, url: "http://test-core", timeoutMs: 100 });
    for (const body of [{ code: 0, data: { valid: false } }, { code: 0, data: { valid: true } }, {}]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
      expect((await verifyUserKey("key", "s")).rejected).toBe(true);
    }
    const fetcher = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetcher);
    expect((await verifyUserKey("key", "s")).rejected).toBe(true);
    fetcher.mockClear();
    expect((await verifyUserKey("", "s")).rejected).toBe(true);
    expect((await verifyUserKey("key", "")).rejected).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
