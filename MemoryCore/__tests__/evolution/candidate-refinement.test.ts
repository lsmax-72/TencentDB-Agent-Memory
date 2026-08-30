import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertHistoricalControls, buildExperiment, CANDIDATE_ID, selectProbeCase, type FreezeOptions, type HistoricalEvidence } from "../../scripts/evolution/refinement/experiment.js";
import { acceptanceCaseSet, makeAcceptanceArtifact, PHASE5_REAL_LIMITS } from "../../src/evolution/evaluation/fixtures/acceptance-cases.js";

const content = readFileSync(new URL("../../scripts/evolution/refinement/candidate-v2/SKILL.md", import.meta.url), "utf8");
const v3Content = readFileSync(new URL("../../scripts/evolution/refinement/candidate-v3/SKILL.md", import.meta.url), "utf8");
const v4Content = readFileSync(new URL("../../scripts/evolution/refinement/candidate-v4/SKILL.md", import.meta.url), "utf8");
const artifact = makeAcceptanceArtifact("CANDIDATE", CANDIDATE_ID, content);
const fingerprints = [
  "4702a83f0e178e486bc9eb8a852269e0f9a7cf65dc2193e129c4cc84247db4e3",
  "0db5363b4b7761cb9858e1cee1154a6f8c135735507a799d38d5d495acf80edb",
  "6085480dd8474ddc3f4e6216288126bddef895b35e866948854d01e50298469a",
  "863916c3a95d05eebcb9baac7ca794879b2a75ba705dae5f8cc0dcdd5ce8c9e5",
  "bf07a7429215c545a95362649c727f2511df7df938dbf42af4ad1d9d7fd4404f",
];

// Historical control hashes, not model outcomes: changes to the exam must fail closed.
const source = {
  environment: { nanobot_repo: "/nanobot", nanobot_revision: "415df576b46464445121fe1bc68d24cd5b649635", python: "/python", provider: "vllm", model_id: "qwen3.8-27b", model_preset: "qwen3.8-27b", temperature: 0, fallback: "DISABLED" },
  attempt: {
    baseline_artifact_hash: "sha256:93e4511b1fdb1d738ab9c0bc1202898ec007fdc42a15d8aeeb3ae3128574a5a8",
    candidate_artifact_hash: "sha256:a881c4a17b834685c3889d3a8dc976d8622176524e0f0eea50983c4bbd0436d2",
    suite_ref: { hash: "sha256:f2a73ac7739489e88f037fd4fc3e1419e0eac8c1cd8ef1b718eca401c1e20fdb" },
    result: { gate: { policy_hash: "sha256:4be8d8a7c105a7981058398fafc23e958dd129351bb7ffcc198884423028b575" } },
    paired_results: acceptanceCaseSet("phase5-real-1", PHASE5_REAL_LIMITS).cases.map((item, index) => ({
      case_ref: { hash: item.case_hash },
      baseline: { run_spec_fingerprints: { execution_fingerprint: `sha256:${fingerprints[index]}` } },
      candidate: { run_spec_fingerprints: { execution_fingerprint: `sha256:${fingerprints[index]}` } },
    })),
  },
} as unknown as HistoricalEvidence;

describe("Phase 5B experiment controls", () => {
  it("uses the historical suite, baseline and all five execution fingerprints with v2", () => {
    const experiment = buildExperiment(source, artifact);
    expect(experiment.suite.suite_hash).toBe(source.attempt.suite_ref.hash);
    expect(experiment.candidate.artifact_hash).not.toBe(experiment.parent.artifact_hash);
  });

  it("keeps v2 generic and records its diagnosis lineage", () => {
    expect(content).not.toMatch(/AC-\d\d|case_id|3000|STATUS_READY|\bsafe\b|old-name|new-name/);
    expect(content).toContain("only for an unresolved logical file alias");
    expect(content).toContain("Stop after the change");
    const diagnosis = JSON.parse(readFileSync(new URL("../../scripts/evolution/refinement/diagnosis.json", import.meta.url), "utf8"));
    expect(diagnosis.source_evaluation_attempt).toBe("f22eb499-3654-448e-ab33-bff096523967");
    expect(diagnosis.cases).toHaveLength(5);
  });

  it("selects a frozen AC-05 case for a separately labelled diagnostic probe", () => {
    const experiment = buildExperiment(source, artifact);
    const probeCase = selectProbeCase(experiment, "AC-05");
    expect(probeCase.case_id).toBe("AC-05");
    expect(probeCase.case_hash).toBe(source.attempt.paired_results[4].case_ref.hash);
    expect(() => selectProbeCase(experiment, "AC-99")).toThrow("Unknown diagnostic probe case");
  });

  it("keeps refinement-freeze options explicit rather than mutating a frozen candidate", () => {
    const options: FreezeOptions = {
      candidate_id: "phase5b-candidate-v3",
      candidate_file: "candidate-v3/SKILL.md",
      parent_candidate: CANDIDATE_ID,
      created_from_evaluation_attempt: "9f6d88f0-e3fe-402b-b9a0-7ee44426aeeb",
    };
    expect(options.candidate_id).not.toBe(CANDIDATE_ID);
    expect(options.candidate_file).not.toContain("candidate-v2");
  });

  it("keeps v3 generic while expressing the trace-backed cross-file hypothesis", () => {
    expect(v3Content).not.toMatch(/AC-\d\d|case_id|3000|STATUS_READY|\bsafe\b|old-name|new-name/);
    expect(v3Content).toContain("identifier replacement");
    expect(v3Content).toContain("repeat reference search");
  });

  it("keeps v4 generic while making resource-resolution precedence explicit", () => {
    expect(v4Content).not.toMatch(/AC-\d\d|case_id|3000|STATUS_READY|\bsafe\b|old-name|new-name/);
    expect(v4Content).toContain("literal identifier");
    expect(v4Content).toContain("neither a usable path nor a searchable literal");
  });

  it.each(["task", "fixture", "oracle", "gate", "budget", "model", "tools"])("rejects %s drift", (kind) => {
    const experiment = buildExperiment(source, artifact);
    if (kind === "task") experiment.caseSet.cases[0].task_input += " easier";
    if (kind === "fixture") experiment.caseSet.fixtures["AC-01"].files["objects/a91.json"] = "{}";
    if (kind === "oracle") experiment.caseSet.cases[0].oracle.assertions = [];
    if (kind === "gate") experiment.suite.gate_policy = { ...experiment.suite.gate_policy, min_newly_fixed: 0 };
    if (kind === "budget") experiment.runSpecs[0].candidate.budget.max_total_tokens += 1;
    if (kind === "model") experiment.runSpecs[0].candidate.model.temperature = 0.1;
    if (kind === "tools") experiment.runSpecs[0].candidate.tools.toolset_id = "different-tools";
    expect(() => assertHistoricalControls(experiment, source)).toThrow();
  });
});
