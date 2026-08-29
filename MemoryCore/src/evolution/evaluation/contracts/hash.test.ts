import { describe, expect, it } from "vitest";
import { canonicalJson, computeArtifactHashes, computeRunSpecFingerprints, hashCanonical } from "./hash.js";
import type { EvaluationSkillArtifact, RunSpec } from "./types.js";

const H = hashCanonical("fixture");

function artifact(source: "OFFICIAL" | "CANDIDATE", content: string): EvaluationSkillArtifact {
  const base = {
    artifact_id: `${source.toLowerCase()}-artifact`,
    source,
    source_ref: source === "OFFICIAL" ? "skl-a@v3" : "candidate-1",
    skill_id: "skl-a",
    base_version: 3,
    format: "SKILL_MD_V1" as const,
    content,
    injection_contract_revision: "evaluation-skill-override-v1",
    read_only: true as const,
  };
  return { ...base, ...computeArtifactHashes(base) };
}

function runSpec(arm: RunSpec["arm"], skill: EvaluationSkillArtifact): RunSpec {
  return {
    contract_revision: "run-spec-v1",
    arm,
    case_ref: { id: "ac-01", revision: "1", hash: H },
    agent: { adapter_id: "test", code_revision: "1", system_prompt_hash: H, harness_config_hash: H },
    model: { provider: "test", model_id: "deterministic-v1", temperature: 0, top_p: 1, seed: 1, fallback: "DISABLED" },
    tools: { toolset_id: "workspace-v1", schema_hash: H, implementation_revision: "1", permission_policy_hash: H },
    environment: {
      fixture_ref: { id: "fixture", revision: "1", hash: H },
      workspace_image_hash: H,
      isolation: "FRESH_COPY_PER_ARM",
      reset_revision: "1",
      sandbox_policy_hash: H,
      network_policy_hash: H,
    },
    context: {
      policy_revision: "1",
      non_target_context_hash: H,
      memory_mode: "DISABLED",
      normal_skill_injection: "DISABLED",
      automatic_skill_extraction: "DISABLED",
    },
    budget: { max_model_calls: 1, max_tool_calls: 8, max_input_tokens: 100, max_output_tokens: 100, max_total_tokens: 200, timeout_ms: 1000 },
    retry_policy: { mode: "NONE" },
    skill_artifact: skill,
  };
}

describe("canonical hashes", () => {
  it("sorts object keys while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: [2, 1] })).toBe('{"a":[2,1],"b":2}');
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it("keeps execution fingerprints equal while artifact fingerprints differ", () => {
    const baseline = runSpec("BASELINE", artifact("OFFICIAL", "baseline"));
    const candidate = runSpec("CANDIDATE", artifact("CANDIDATE", "candidate"));
    const baselinePrints = computeRunSpecFingerprints(baseline);
    const candidatePrints = computeRunSpecFingerprints(candidate);

    expect(baselinePrints.execution_fingerprint).toBe(candidatePrints.execution_fingerprint);
    expect(baseline.skill_artifact.artifact_hash).not.toBe(candidate.skill_artifact.artifact_hash);
    expect(baselinePrints.full_run_fingerprint).not.toBe(candidatePrints.full_run_fingerprint);
    expect(baselinePrints.execution_fingerprint).toMatch(/^sha256:/);
  });
});
