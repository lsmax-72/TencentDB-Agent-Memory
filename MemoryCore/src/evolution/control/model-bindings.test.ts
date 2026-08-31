import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileReviewBindings } from "./model-bindings.js";
import type { EvolutionProfile } from "./types.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const profile = { team_id: "team", agent_id: "agent", review_model_id: "review" } as EvolutionProfile;
const config = { provider: "openai-compatible", model: "offline-review", base_url: "http://unused.invalid/v1", api_key: "do-not-store", max_output_tokens: 100, token_ceiling: 2000, temperature: 0, fallback: false, timeout_ms: 1000 };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "evolution-binding-")); dirs.push(dir); const file = join(dir, "models.json");
  writeFileSync(file, JSON.stringify([{ id: "review", instance_id: "instance", team_id: "team", agent_id: "agent", config }]), { mode: 0o600 });
  return file;
}
describe("operator-owned independent reviewer configuration", () => {
  it("never inherits a task model and enforces instance/team/agent binding", () => {
    const file = fixture(); const request = vi.fn(); const resolve = fileReviewBindings(file, "instance", request);
    const binding = resolve(profile)!;
    expect(binding.model.modelId).toBe("offline-review"); expect(JSON.stringify(binding)).not.toContain("do-not-store");
    expect(resolve({ ...profile, team_id: "other" })).toBeNull(); expect(resolve({ ...profile, agent_id: "other" })).toBeNull();
    expect(fileReviewBindings(file, "other-instance")(profile)).toBeNull();
    expect(resolve({ ...profile, review_model_id: null })).toBeNull(); expect(request).not.toHaveBeenCalled();
  });
  it("rejects readable secrets, malformed bindings and non-private files without exposing their content", () => {
    const file = fixture(); chmodSync(file, 0o644);
    expect(() => fileReviewBindings(file, "instance")(profile)).toThrow("REVIEW_BINDING_INVALID");
    chmodSync(file, 0o600); writeFileSync(file, "do-not-store invalid json");
    expect(() => fileReviewBindings(file, "instance")(profile)).toThrow("REVIEW_BINDING_INVALID");
    expect(fileReviewBindings(undefined, "instance")(profile)).toBeNull();
  });
});
