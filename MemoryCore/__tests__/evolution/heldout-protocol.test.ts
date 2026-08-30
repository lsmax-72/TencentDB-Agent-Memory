import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeRunSpecFingerprints } from "../../src/evolution/evaluation/contracts/hash.js";
import { makeAcceptanceArtifact } from "../../src/evolution/evaluation/fixtures/acceptance-cases.js";
import { heldoutCaseSet } from "../../src/evolution/evaluation/fixtures/heldout-cases.js";
import {
  EXPECTED_V4_ARTIFACT,
  buildHeldoutExperiment,
  evaluatePromotionEvidenceV2,
  requiredProbeCaseIds,
  type HeldoutEnvironment,
} from "../../scripts/evolution/heldout/experiment.js";

const environment: HeldoutEnvironment = {
  nanobot_repo: "/nanobot", nanobot_revision: "abc", python: "/python", provider: "vllm",
  model_id: "qwen3.8-27b", model_preset: "qwen3.8-27b", temperature: 0, fallback: "DISABLED",
};
const v4 = makeAcceptanceArtifact("CANDIDATE", "phase5b-candidate-v4", readFileSync(
  new URL("../../scripts/evolution/refinement/candidate-v4/SKILL.md", import.meta.url), "utf8",
));

describe("Held-out Protocol v2", () => {
  it("defines eight distinct held-out cases without old case/candidate answers", () => {
    const { cases, fixtures } = heldoutCaseSet();
    expect(cases.map((item) => item.case_id)).toEqual(["HO-01", "HO-02", "HO-03", "HO-04", "HO-05", "HO-06", "HO-07", "HO-08"]);
    expect(cases.every((item) => item.revision === "heldout-v2" && item.case_hash.startsWith("sha256:"))).toBe(true);
    expect(JSON.stringify({ cases, fixtures })).not.toMatch(/AC-0[1-5]|phase5b-candidate-v4/);
  });

  it("keeps Baseline/Candidate execution controls equal and enables state tools only for HO-07", () => {
    expect(v4.artifact_hash).toBe(EXPECTED_V4_ARTIFACT);
    const experiment = buildHeldoutExperiment(environment, v4);
    for (const pair of experiment.runSpecs) {
      expect(computeRunSpecFingerprints(pair.baseline).execution_fingerprint)
        .toBe(computeRunSpecFingerprints(pair.candidate).execution_fingerprint);
    }
    expect(experiment.runSpecs.find((pair) => pair.baseline.case_ref.id === "HO-07")?.baseline.tools.toolset_id)
      .toBe("nanobot-workspace-plus-state-v1");
    expect(experiment.runSpecs.find((pair) => pair.baseline.case_ref.id === "HO-01")?.baseline.tools.toolset_id)
      .toBe("nanobot-workspace-v1");
  });

  it("pre-registers every newly fixed/broken and near-budget candidate case for probes", () => {
    const { cases } = heldoutCaseSet();
    const fake = {
      paired_results: [
        { case_ref: { id: "HO-01" }, classification: "newly_fixed", candidate: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 1, model_call_count: 1, tool_call_count: 1 } } },
        { case_ref: { id: "HO-02" }, classification: "unchanged_success", candidate: { usage: { input_tokens: 36_000, output_tokens: 1, total_tokens: 1, model_call_count: 1, tool_call_count: 1 } } },
      ],
    } as never;
    expect(requiredProbeCaseIds(fake, cases)).toEqual(["HO-01", "HO-02"]);
  });

  it("does not treat a standard Gate result as promotion evidence", () => {
    const evidence = evaluatePromotionEvidenceV2({ outcome: "PASS", result: {
      comparison_summary: { newly_fixed: [], newly_broken: [], unchanged_success: [], unchanged_failure: [], uncomparable: [] },
      critical_candidate_failures: [], cost_summary: { token_increase_ratio: 0, tool_call_increase: 0, model_call_increase: 0 },
    } } as never);
    expect(evidence.status).toBe("FAIL");
    expect(evidence.reasons).toContain("newly_fixed");
  });
});
