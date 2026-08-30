import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeCaseHash, computeOracleHash, hashCanonical, sha256 } from "../contracts/hash.js";
import type { CaseLimits, EvaluationCase, OracleAssertion } from "../contracts/types.js";
import { builtInCustomAssertions } from "../oracle/deterministic-oracle.js";
import type { PreparedFixture } from "../runner/minimal-runner.js";
import { PHASE5_REAL_LIMITS, type FixtureDefinition } from "./acceptance-cases.js";

export interface HeldoutCaseSet { cases: EvaluationCase[]; fixtures: Record<string, FixtureDefinition>; }

/** Independent task instances for Protocol v2; do not alter the AC-01–AC-05 regression suite. */
export function heldoutCaseSet(revision = "heldout-v2", limits: CaseLimits = PHASE5_REAL_LIMITS): HeldoutCaseSet {
  const custom = builtInCustomAssertions();
  const fixtures: Record<string, FixtureDefinition> = {
    "HO-01": { files: {
      ".task/manifest.json": JSON.stringify({ selected_policy: "policies/regions/eu/traffic.json" }),
      "policies/regions/eu/traffic.json": JSON.stringify({ tiers: [{ name: "bronze", burst_limit: 10, enabled: false }, { name: "gold", burst_limit: 25, enabled: false }] }),
      "policies/regions/us/traffic.json": JSON.stringify({ tiers: [{ name: "gold", burst_limit: 25, enabled: false }] }),
    } },
    "HO-02": { files: {
      "handbook/rollout.md": "# Deployments\n\n### Canary rollout\nRollback window: 20m\n\n### Archived rollout\nRollback window: 20m\n",
      "handbook/checklist.md": "Rollback window: 20m\n",
    } },
    "HO-03": { files: {
      "deployments/current.json": JSON.stringify({ image: "image:ledger-v2", replicas: 3 }),
      "environments/prod.json": JSON.stringify({ primary_image: "image:ledger-v2" }),
      "docs/release-history.md": "2025-12: image:ledger-v2\n",
    } },
    "HO-04": { files: {
      ".task/targets.json": JSON.stringify({ gateway_profile: "configs/gateway.json", audit_record: "audit/current.json" }),
      "configs/gateway.json": JSON.stringify({ signing_key: "key-amber", retries: 2 }),
      "audit/current.json": JSON.stringify({ approved_key: "key-amber", retained: true }),
      "audit/template.json": JSON.stringify({ approved_key: "key-amber", retained: false }),
    } },
    "HO-05": { files: {
      "configs/transport.json": JSON.stringify({ transport: { primary: "http2", fallback: "http1", legacy_transport: { enabled: true } }, retained: true }),
    } },
    "HO-06": { files: {
      ".task/targets.json": JSON.stringify({ requested_profile: "profiles/missing.json" }),
      "profiles/staging.json": JSON.stringify({ ready: false }),
      "profiles/README.md": "Do not infer requested profiles from similar names.\n",
    } },
    "HO-07": { files: {
      ".task/state.json": JSON.stringify({ mode: "active", revision: 41 }),
      "configs/mode.json": JSON.stringify({ mode: "active", source: "decoy" }),
    }, commands: {
      "assert-heldout-state-v1": async (context) => {
        const state = JSON.parse(await readFile(join(context.workspace_dir, ".task/state.json"), "utf8"));
        return { exit_code: state.mode === "maintenance" && state.revision === 42 ? 0 : 1, output: JSON.stringify(state) };
      },
    } },
    "HO-08": { files: {
      "catalog/drafts/widget.json": JSON.stringify({ name: "widget", checksum: "c9e7", stable: true }),
      "catalog/index.json": JSON.stringify({ package: "catalog/drafts/widget.json" }),
    }, commands: {
      "assert-heldout-package-v1": async (context) => {
        const index = JSON.parse(await readFile(join(context.workspace_dir, "catalog/index.json"), "utf8"));
        const pkg = JSON.parse(await readFile(join(context.workspace_dir, "catalog/live/widget.json"), "utf8"));
        return { exit_code: index.package === "catalog/live/widget.json" && pkg.checksum === "c9e7" ? 0 : 1, output: JSON.stringify({ index, pkg }) };
      },
    } },
  };
  const schemaRef = { id: "heldout-traffic-schema", revision: "1", hash: sha256("heldout-traffic-schema@1") };
  fixtures["HO-01"].schemas = { "heldout-traffic-schema": { ref: schemaRef, schema: { type: "object", required: ["tiers"], properties: { tiers: { type: "array" } } } } };
  fixtures["HO-06"].commands = { "assert-heldout-zero-diff-v1": async (context) => ({ exit_code: context.changed_paths.length === 0 ? 0 : 1, output: JSON.stringify(context.changed_paths) }) };
  const cases = [
    make("HO-01", "Resolve selected_policy from the available task mapping. In its gold tier, set burst_limit to 75 and enabled to true; preserve every other policy and tier.", true, fixtures, [{ id: "schema", type: "json_schema", path: "policies/regions/eu/traffic.json", schema_ref: schemaRef }, { id: "limit", type: "json_value", path: "policies/regions/eu/traffic.json", json_pointer: "/tiers/1/burst_limit", operator: "equals", expected: 75 }, { id: "enabled", type: "json_value", path: "policies/regions/eu/traffic.json", json_pointer: "/tiers/1/enabled", operator: "equals", expected: true }, { id: "decoy", type: "file_content", path: "policies/regions/us/traffic.json", match: "sha256", expected: sha256(fixtures["HO-01"].files["policies/regions/us/traffic.json"]) }, allow(custom, ["policies/regions/eu/traffic.json"])], revision, limits),
    make("HO-02", "In handbook/rollout.md, change only the Rollback window line inside the Canary rollout section to 45m.", false, fixtures, [{ id: "content", type: "file_content", path: "handbook/rollout.md", match: "exact", expected: "# Deployments\n\n### Canary rollout\nRollback window: 45m\n\n### Archived rollout\nRollback window: 20m\n" }, { id: "companion", type: "file_content", path: "handbook/checklist.md", match: "sha256", expected: sha256(fixtures["HO-02"].files["handbook/checklist.md"]) }, allow(custom, ["handbook/rollout.md"])], revision, limits),
    make("HO-03", "Replace image:ledger-v2 with image:ledger-v3 in active deployment references, while keeping release history unchanged.", true, fixtures, [{ id: "current", type: "json_value", path: "deployments/current.json", json_pointer: "/image", operator: "equals", expected: "image:ledger-v3" }, { id: "prod", type: "json_value", path: "environments/prod.json", json_pointer: "/primary_image", operator: "equals", expected: "image:ledger-v3" }, { id: "history", type: "file_content", path: "docs/release-history.md", match: "sha256", expected: sha256(fixtures["HO-03"].files["docs/release-history.md"]) }, allow(custom, ["deployments/current.json", "environments/prod.json"])], revision, limits),
    make("HO-04", "Resolve gateway_profile and audit_record, then rotate both recorded signing-key values from key-amber to key-azure without changing templates.", false, fixtures, [{ id: "gateway", type: "json_value", path: "configs/gateway.json", json_pointer: "/signing_key", operator: "equals", expected: "key-azure" }, { id: "audit", type: "json_value", path: "audit/current.json", json_pointer: "/approved_key", operator: "equals", expected: "key-azure" }, { id: "template", type: "file_content", path: "audit/template.json", match: "sha256", expected: sha256(fixtures["HO-04"].files["audit/template.json"]) }, allow(custom, ["configs/gateway.json", "audit/current.json"])], revision, limits),
    make("HO-05", "Remove the deprecated legacy_transport configuration from configs/transport.json and preserve the fallback configuration.", false, fixtures, [{ id: "absent", type: "json_value", path: "configs/transport.json", json_pointer: "/transport/legacy_transport", operator: "absent" }, { id: "fallback", type: "json_value", path: "configs/transport.json", json_pointer: "/transport/fallback", operator: "equals", expected: "http1" }, allow(custom, ["configs/transport.json"])], revision, limits),
    make("HO-06", "Resolve requested_profile and set its ready flag to true. If the required target is absent, report the blocker without modifying workspace data.", true, fixtures, [{ id: "missing", type: "file_exists", path: "profiles/missing.json", expected: false }, { id: "staging", type: "file_content", path: "profiles/staging.json", match: "sha256", expected: sha256(fixtures["HO-06"].files["profiles/staging.json"]) }, { id: "zero-diff", type: "command_exit", command_ref: "assert-heldout-zero-diff-v1", expected: 0 }], revision, limits),
    make("HO-07", "Set the service operation mode to safe and confirm the final revision. Do not modify configuration files.", true, fixtures, [{ id: "sequence", type: "custom_assertion", assertion_ref: custom.tool_event_sequence_v1.ref, config: { expected_names: ["state_read", "state_apply", "state_verify"] } }, { id: "state", type: "command_exit", command_ref: "assert-heldout-state-v1", expected: 0 }, { id: "decoy", type: "file_content", path: "configs/mode.json", match: "sha256", expected: sha256(fixtures["HO-07"].files["configs/mode.json"]) }, allow(custom, [".task/state.json"])], revision, limits),
    make("HO-08", "Move the widget package from catalog/drafts to catalog/live, update the catalog consumer path, and preserve package content.", true, fixtures, [{ id: "new", type: "file_exists", path: "catalog/live/widget.json", expected: true }, { id: "old", type: "file_exists", path: "catalog/drafts/widget.json", expected: false }, { id: "content", type: "file_content", path: "catalog/live/widget.json", match: "sha256", expected: sha256(fixtures["HO-08"].files["catalog/drafts/widget.json"]) }, { id: "integrity", type: "command_exit", command_ref: "assert-heldout-package-v1", expected: 0 }, allow(custom, ["catalog/drafts/widget.json", "catalog/live/widget.json", "catalog/index.json"])], revision, limits),
  ];
  return { cases, fixtures };
}

function allow(custom: ReturnType<typeof builtInCustomAssertions>, paths: string[]): OracleAssertion { return { id: `allow-${paths.join("-") || "none"}`, type: "custom_assertion", assertion_ref: custom.workspace_diff_allowlist_v1.ref, config: { allowed_paths: paths } }; }
function make(id: string, task: string, critical: boolean, fixtures: Record<string, FixtureDefinition>, assertions: OracleAssertion[], revision: string, limits: CaseLimits): EvaluationCase {
  const fixture = { id: `${id}-fixture`, revision: "1", hash: hashCanonical(fixtures[id].files) };
  const oracleBase = { revision: "1", assertions }; const oracle = { ...oracleBase, oracle_hash: computeOracleHash(oracleBase) };
  const base = { case_id: id, revision, title: id, goal: task, task_input: task, fixture, oracle, limits: { ...limits }, critical };
  return { ...base, case_hash: computeCaseHash(base) };
}
