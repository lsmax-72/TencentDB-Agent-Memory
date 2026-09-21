#!/usr/bin/env npx tsx

import { parseArgs } from "node:util";
import { defaultStatePath, runManifestFile } from "./closed-loop.js";

function usage(): string {
  return `Usage: npx tsx scripts/evolution-closed-loop/index.ts <manifest.json> [options]

Options:
  --manifest <path>          Manifest path instead of the positional argument
  --state <path>             Resume state (default: <manifest>.closed-loop-state.json)
  --timeout-minutes <number> Per-case timeout (default: 45)
  --poll-ms <number>         Job polling interval (default: 1000)
  --service-id <id>          x-tdai-service-id (default: MEMORY_CORE_SERVICE_ID or default)
  -h, --help                 Show this help

Authentication is read from MEMORY_CORE_API_KEY and MEMORY_CORE_USER_KEY.`;
}

function positiveNumber(value: string | undefined, fallback: number, name: string, allowZero = false): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  return parsed;
}

try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: "string" },
      state: { type: "string" },
      "timeout-minutes": { type: "string" },
      "poll-ms": { type: "string" },
      "service-id": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const manifestPath = values.manifest ?? positionals[0];
    if (!manifestPath || (values.manifest && positionals.length > 0) || positionals.length > 1) throw new Error(usage());
    const apiKey = process.env.MEMORY_CORE_API_KEY;
    const userKey = process.env.MEMORY_CORE_USER_KEY;
    if (!apiKey || !userKey) throw new Error("MEMORY_CORE_API_KEY and MEMORY_CORE_USER_KEY are required");
    const statePath = values.state ?? defaultStatePath(manifestPath);
    const completed = await runManifestFile(manifestPath, statePath, {
      apiKey,
      userKey,
      serviceId: values["service-id"] ?? process.env.MEMORY_CORE_SERVICE_ID ?? "default",
      timeoutMinutes: positiveNumber(values["timeout-minutes"], 45, "--timeout-minutes"),
      pollIntervalMs: positiveNumber(values["poll-ms"], 1_000, "--poll-ms", true),
      onCase: result => { process.stdout.write(`${JSON.stringify(result)}\n`); },
    });
    process.stdout.write(`${JSON.stringify({ summary: completed.summary })}\n`);
  }
} catch (error) {
  process.stderr.write(`[evolution-closed-loop] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
