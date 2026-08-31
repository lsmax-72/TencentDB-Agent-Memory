import { describe, expect, it } from "vitest";
import { redactEvidence } from "./evidence.js";
describe("trace display credential redaction", () => {
  it("removes common credentials while retaining evidence hashes", () => {
    const secret = 'Bearer abcdefghijklmnop api_key="hidden" sk-mem-abcdefghijklmnop';
    const result = redactEvidence(secret);
    expect(result.text).not.toContain("hidden"); expect(result.text).not.toContain("abcdefghijklmnop");
    expect(result.replacements).toBe(3); expect(result.original_sha256).toHaveLength(64);
  });
  it("leaves ordinary evidence intact and removes private key blocks", () => {
    expect(redactEvidence("read → apply → verify").text).toBe("read → apply → verify");
    expect(redactEvidence("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----").text).toBe("[REDACTED_CREDENTIAL]");
  });
});
