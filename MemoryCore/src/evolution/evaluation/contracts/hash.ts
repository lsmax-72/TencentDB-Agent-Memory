import { createHash } from "node:crypto";
import type {
  EvaluationCase,
  EvaluationSkillArtifact,
  EvaluationSuite,
  GatePolicy,
  OracleSpec,
  RunSpec,
  RunSpecFingerprints,
  Sha256,
} from "./types.js";

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

export function sha256(value: string | Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value: unknown): Sha256 {
  return sha256(canonicalJson(value));
}

export function computeOracleHash(oracle: Omit<OracleSpec, "oracle_hash"> | OracleSpec): Sha256 {
  const { oracle_hash: _ignored, ...payload } = oracle as OracleSpec;
  return hashCanonical(payload);
}

export function computeCaseHash(evaluationCase: Omit<EvaluationCase, "case_hash"> | EvaluationCase): Sha256 {
  const { case_hash: _hash, source_trace_ref: _trace, ...payload } = evaluationCase as EvaluationCase;
  return hashCanonical(payload);
}

export function computeArtifactHashes(
  artifact: Omit<EvaluationSkillArtifact, "content_hash" | "artifact_hash">,
): Pick<EvaluationSkillArtifact, "content_hash" | "artifact_hash"> {
  const content_hash = sha256(artifact.content);
  const artifact_hash = hashCanonical({
    skill_id: artifact.skill_id,
    base_version: artifact.base_version,
    format: artifact.format,
    content_hash,
    injection_contract_revision: artifact.injection_contract_revision,
  });
  return { content_hash, artifact_hash };
}

export function computeGatePolicyHash(policy: GatePolicy): Sha256 {
  return hashCanonical(policy);
}

export function computeSuiteHash(suite: Omit<EvaluationSuite, "suite_hash"> | EvaluationSuite): Sha256 {
  return hashCanonical({ cases: suite.cases, gate_policy: suite.gate_policy });
}

export function computeRunSpecFingerprints(runSpec: RunSpec): RunSpecFingerprints {
  const artifact = runSpec.skill_artifact;
  const executionPayload = {
    contract_revision: runSpec.contract_revision,
    case_ref: runSpec.case_ref,
    agent: runSpec.agent,
    model: runSpec.model,
    tools: runSpec.tools,
    environment: runSpec.environment,
    context: runSpec.context,
    budget: runSpec.budget,
    retry_policy: runSpec.retry_policy,
    skill: {
      skill_id: artifact.skill_id,
      base_version: artifact.base_version,
      format: artifact.format,
      injection_contract_revision: artifact.injection_contract_revision,
    },
  };
  return {
    execution_fingerprint: hashCanonical(executionPayload),
    full_run_fingerprint: hashCanonical({
      execution: executionPayload,
      artifact_hash: artifact.artifact_hash,
    }),
  };
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => {
      const item = record[key];
      if (item === undefined) throw new TypeError(`canonical JSON does not support undefined at '${key}'`);
      return `${JSON.stringify(key)}:${serialize(item)}`;
    }).join(",")}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}
