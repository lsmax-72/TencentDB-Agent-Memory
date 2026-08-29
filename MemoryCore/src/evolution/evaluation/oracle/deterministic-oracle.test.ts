import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeOracleHash, sha256 } from "../contracts/hash.js";
import type { OracleSpec } from "../contracts/types.js";
import { builtInCustomAssertions, runOracle } from "./deterministic-oracle.js";

describe("runOracle", () => {
  it("executes all v1 assertion kinds deterministically", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "evolution-oracle-"));
    await mkdir(join(workspace, "data"));
    await writeFile(join(workspace, "data/config.json"), JSON.stringify({ runtime: { timeout_ms: 3000 } }));
    await writeFile(join(workspace, "notes.txt"), "STATUS_READY\n");
    const custom = builtInCustomAssertions();
    const schemaRef = { id: "config-schema", revision: "1", hash: sha256("config-schema@1") };
    const withoutHash = {
      revision: "1",
      assertions: [
        { id: "command", type: "command_exit" as const, command_ref: "check", expected: 0 },
        { id: "exists", type: "file_exists" as const, path: "notes.txt", expected: true },
        { id: "content", type: "file_content" as const, path: "notes.txt", match: "contains" as const, expected: "READY" },
        { id: "schema", type: "json_schema" as const, path: "data/config.json", schema_ref: schemaRef },
        { id: "value", type: "json_value" as const, path: "data/config.json", json_pointer: "/runtime/timeout_ms", operator: "equals" as const, expected: 3000 },
        {
          id: "diff",
          type: "custom_assertion" as const,
          assertion_ref: custom.workspace_diff_allowlist_v1.ref,
          config: { allowed_paths: ["notes.txt"] },
        },
      ],
    };
    const spec: OracleSpec = { ...withoutHash, oracle_hash: computeOracleHash(withoutHash) };
    const results = await runOracle(spec, {
      workspace_dir: workspace,
      changed_paths: ["notes.txt"],
      tool_calls: [],
      commands: { check: () => ({ exit_code: 0, output: "ok" }) },
      schemas: {
        "config-schema": {
          ref: schemaRef,
          schema: {
            type: "object",
            required: ["runtime"],
            properties: {
              runtime: {
                type: "object",
                required: ["timeout_ms"],
                properties: { timeout_ms: { type: "integer" } },
              },
            },
          },
        },
      },
    });

    expect(results).toHaveLength(6);
    expect(results.every((result) => result.status === "PASS")).toBe(true);
  });

  it("separates task assertion failure from oracle infrastructure error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "evolution-oracle-error-"));
    const withoutHash = {
      revision: "1",
      assertions: [
        { id: "missing-output", type: "file_content" as const, path: "missing.txt", match: "exact" as const, expected: "x" },
        { id: "missing-command", type: "command_exit" as const, command_ref: "unregistered", expected: 0 },
      ],
    };
    const results = await runOracle(
      { ...withoutHash, oracle_hash: computeOracleHash(withoutHash) },
      { workspace_dir: workspace, changed_paths: [], tool_calls: [], commands: {}, schemas: {} },
    );

    expect(results.map((result) => result.status)).toEqual(["FAIL", "ERROR"]);
    expect(results[1].error_code).toBe("ORACLE_EXECUTION_ERROR");
  });
});
