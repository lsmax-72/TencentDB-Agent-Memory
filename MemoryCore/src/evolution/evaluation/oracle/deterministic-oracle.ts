import { access, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve, sep } from "node:path";
import { computeOracleHash, sha256 } from "../contracts/hash.js";
import type {
  EvidenceRef,
  FrozenRef,
  OracleAssertion,
  OracleAssertionResult,
  OracleSpec,
  ToolCallSummary,
} from "../contracts/types.js";

export interface CommandResult {
  exit_code: number;
  output: string;
}

export interface OracleContext {
  workspace_dir: string;
  changed_paths: string[];
  tool_calls: ToolCallSummary[];
  commands: Record<string, (context: OracleContext) => Promise<CommandResult> | CommandResult>;
  schemas: Record<string, { ref: FrozenRef; schema: Record<string, unknown> }>;
  custom_assertions?: Record<string, RegisteredCustomAssertion>;
}

export interface CustomAssertionResult {
  status: "PASS" | "FAIL" | "ERROR";
  evidence_refs: EvidenceRef[];
}

export interface RegisteredCustomAssertion {
  ref: FrozenRef;
  execute(
    config: Record<string, unknown>,
    context: OracleContext,
  ): Promise<CustomAssertionResult> | CustomAssertionResult;
}

export async function runOracle(
  spec: OracleSpec,
  context: OracleContext,
): Promise<OracleAssertionResult[]> {
  if (spec.assertions.length === 0 || computeOracleHash(spec) !== spec.oracle_hash) {
    return [infraResult("__oracle_contract__")];
  }
  return Promise.all(spec.assertions.map((assertion) => runAssertion(assertion, context)));
}

export function builtInCustomAssertions(): Record<string, RegisteredCustomAssertion> {
  return {
    workspace_diff_allowlist_v1: {
      ref: {
        id: "workspace_diff_allowlist_v1",
        revision: "1",
        hash: sha256("workspace_diff_allowlist_v1@1"),
      },
      execute(config, context) {
        const allowed = stringArray(config.allowed_paths);
        if (!allowed) return customError("workspace allowlist requires allowed_paths:string[]");
        const unexpected = context.changed_paths.filter((path) => !allowed.includes(path));
        const status = unexpected.length === 0 ? "PASS" : "FAIL";
        return {
          status,
          evidence_refs: [{
            kind: "oracle_report",
            uri: "oracle://workspace_diff_allowlist_v1",
            excerpt: JSON.stringify({ changed_paths: context.changed_paths, unexpected }),
          }],
        };
      },
    },
    tool_event_sequence_v1: {
      ref: {
        id: "tool_event_sequence_v1",
        revision: "1",
        hash: sha256("tool_event_sequence_v1@1"),
      },
      execute(config, context) {
        const expected = stringArray(config.expected_names);
        if (!expected) return customError("tool sequence requires expected_names:string[]");
        const requireSuccess = config.require_success !== false;
        const actual = context.tool_calls.map((event) => event.name);
        const namesMatch = isDeepStrictEqual(actual, expected);
        const outcomesMatch = !requireSuccess
          || context.tool_calls.every((event) => event.outcome === "SUCCEEDED");
        return {
          status: namesMatch && outcomesMatch ? "PASS" : "FAIL",
          evidence_refs: context.tool_calls.length > 0
            ? context.tool_calls.map((event) => event.event_ref)
            : [{ kind: "oracle_report", uri: "oracle://tool_event_sequence_v1", excerpt: "no tool events" }],
        };
      },
    },
  };
}

async function runAssertion(
  assertion: OracleAssertion,
  context: OracleContext,
): Promise<OracleAssertionResult> {
  try {
    switch (assertion.type) {
      case "command_exit": {
        const command = context.commands[assertion.command_ref];
        if (!command) return infraResult(assertion.id);
        const result = await command(context);
        return resultOf(assertion.id, result.exit_code === assertion.expected, [{
          kind: "command_output",
          uri: `command://${assertion.command_ref}`,
          excerpt: result.output.slice(0, 512),
        }]);
      }
      case "file_exists": {
        const path = workspacePath(context.workspace_dir, assertion.path);
        const exists = await pathExists(path);
        return resultOf(assertion.id, exists === assertion.expected, [{
          kind: "oracle_report",
          uri: `oracle://file_exists/${encodeURIComponent(assertion.path)}`,
          excerpt: JSON.stringify({ expected: assertion.expected, actual: exists }),
        }]);
      }
      case "file_content": {
        const path = workspacePath(context.workspace_dir, assertion.path);
        let content: string;
        try {
          content = await readFile(path, "utf8");
        } catch {
          return resultOf(assertion.id, false, [missingFileEvidence(assertion.path)]);
        }
        const actual = assertion.match === "sha256" ? sha256(content) : content;
        const pass = assertion.match === "contains"
          ? content.includes(assertion.expected)
          : actual === assertion.expected;
        return resultOf(assertion.id, pass, [fileEvidence(path, content)]);
      }
      case "json_schema": {
        const registered = context.schemas[assertion.schema_ref.id];
        if (!registered || !isDeepStrictEqual(registered.ref, assertion.schema_ref)) {
          return infraResult(assertion.id);
        }
        const parsed = await readJsonForTask(context.workspace_dir, assertion.path);
        if (!parsed.ok) return resultOf(assertion.id, false, [parsed.evidence]);
        const errors = validateSchema(parsed.value, registered.schema, "$");
        return resultOf(assertion.id, errors.length === 0, [{
          kind: "oracle_report",
          uri: `oracle://json_schema/${encodeURIComponent(assertion.path)}`,
          excerpt: JSON.stringify(errors).slice(0, 512),
        }]);
      }
      case "json_value": {
        const parsed = await readJsonForTask(context.workspace_dir, assertion.path);
        if (!parsed.ok) return resultOf(assertion.id, false, [parsed.evidence]);
        const pointer = resolveJsonPointer(parsed.value, assertion.json_pointer);
        const pass = assertion.operator === "absent"
          ? !pointer.found
          : pointer.found && isDeepStrictEqual(pointer.value, assertion.expected);
        return resultOf(assertion.id, pass, [{
          kind: "oracle_report",
          uri: `oracle://json_value/${encodeURIComponent(assertion.path)}`,
          excerpt: JSON.stringify({ pointer: assertion.json_pointer, found: pointer.found, value: pointer.value }),
        }]);
      }
      case "custom_assertion": {
        const registry = { ...builtInCustomAssertions(), ...(context.custom_assertions ?? {}) };
        const registered = registry[assertion.assertion_ref.id];
        if (!registered || !isDeepStrictEqual(registered.ref, assertion.assertion_ref)) {
          return infraResult(assertion.id);
        }
        const result = await registered.execute(assertion.config, context);
        return {
          assertion_id: assertion.id,
          status: result.status,
          evidence_refs: result.evidence_refs,
          ...(result.status === "ERROR" ? { error_code: "ORACLE_EXECUTION_ERROR" as const } : {}),
        };
      }
    }
  } catch {
    return infraResult(assertion.id);
  }
}

function resultOf(id: string, pass: boolean, evidence_refs: EvidenceRef[]): OracleAssertionResult {
  return { assertion_id: id, status: pass ? "PASS" : "FAIL", evidence_refs };
}

function infraResult(id: string): OracleAssertionResult {
  return {
    assertion_id: id,
    status: "ERROR",
    error_code: "ORACLE_EXECUTION_ERROR",
    evidence_refs: [{ kind: "oracle_report", uri: `oracle://error/${encodeURIComponent(id)}` }],
  };
}

function customError(message: string): CustomAssertionResult {
  return {
    status: "ERROR",
    evidence_refs: [{ kind: "oracle_report", uri: "oracle://custom/error", excerpt: message }],
  };
}

async function readJsonForTask(
  workspaceDir: string,
  relativePath: string,
): Promise<{ ok: true; value: unknown } | { ok: false; evidence: EvidenceRef }> {
  const path = workspacePath(workspaceDir, relativePath);
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      evidence: {
        kind: "oracle_report",
        uri: `oracle://invalid_json/${encodeURIComponent(relativePath)}`,
        excerpt: (error as Error).message.slice(0, 512),
      },
    };
  }
}

function workspacePath(workspaceDir: string, relativePath: string): string {
  const root = resolve(workspaceDir);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes workspace: ${relativePath}`);
  }
  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function fileEvidence(path: string, content: string): EvidenceRef {
  return { kind: "workspace_file", uri: path, sha256: sha256(content), excerpt: content.slice(0, 512) };
}

function missingFileEvidence(path: string): EvidenceRef {
  return { kind: "oracle_report", uri: `oracle://missing_file/${encodeURIComponent(path)}` };
}

function resolveJsonPointer(root: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value: root };
  if (!pointer.startsWith("/")) return { found: false };
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof current !== "object" || current === null || !(key in current)) return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

function validateSchema(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) {
    return [`${path}: expected ${type}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => isDeepStrictEqual(item, value))) {
    errors.push(`${path}: not in enum`);
  }
  if (type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = stringArray(schema.required) ?? [];
    for (const key of required) if (!(key in record)) errors.push(`${path}.${key}: required`);
    const properties = schema.properties;
    if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        if (key in record && typeof child === "object" && child !== null && !Array.isArray(child)) {
          errors.push(...validateSchema(record[key], child as Record<string, unknown>, `${path}.${key}`));
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) if (!(key in properties)) errors.push(`${path}.${key}: additional property`);
      }
    }
  }
  if (type === "array" && Array.isArray(value) && typeof schema.items === "object" && schema.items !== null) {
    value.forEach((item, index) => {
      errors.push(...validateSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
    });
  }
  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}
