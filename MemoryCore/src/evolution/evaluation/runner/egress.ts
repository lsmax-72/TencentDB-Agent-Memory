import type { ToolCallSummary } from "../contracts/types.js";

/**
 * Detect outbound network use by the agent under test.
 *
 * This exists because of a specific incident: on 2026-09-19 the only positive
 * result the project had ever produced turned out to be the agent reading
 * `problem.md`, finding no statement, and running
 * `curl https://atcoder.jp/contests/abc388/tasks/abc388_b` to fetch the task
 * from the internet. It then solved all 42 hidden tests. The skill under test
 * did not make the agent better; the skill's "fetch the skill with curl" step
 * taught it to reach the network, and the network handed it the problem.
 *
 * A task is not a holdout if the agent can look it up. Until the sandbox has no
 * egress, this is the guard: any indicator of outbound access makes the arm an
 * INFRA_ERROR, which the gate treats as uncomparable, so a contaminated run can
 * never be read as an effect. It is a detector, not a sandbox -- it only sees
 * what the tool calls record, so it must never be the only defence.
 *
 * The local proxy is allowed: fetching the evaluation skill from
 * `tdai-proxy`/`memory-proxy` is the intended injection path, not egress.
 */

const ALLOWED_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0|tdai-proxy|memory-proxy)(?::\d+)?(?:[/?#]|$)/i;

/** Tool calls that can carry a command or code the agent will execute. */
const EXECUTABLE_TOOLS = new Set(["exec", "write_file", "edit_file", "apply_patch"]);

const COMMAND_INDICATORS: Array<{ id: string; pattern: RegExp }> = [
  { id: "package-install", pattern: /\b(?:pip3?|pipx)\s+install\b|\b(?:apt-get|apt|yum|apk)\s+(?:install|update)\b|\bnpm\s+(?:i|install)\b/i },
  { id: "repo-clone", pattern: /\bgit\s+clone\b|\bgit\s+fetch\b|\bgit\s+pull\b/i },
  { id: "remote-shell", pattern: /(?:^|[\s;&|])(?:ssh|scp|sftp|telnet|ftp|ncat|nc)\s/i },
  { id: "network-library", pattern: /\burllib\b|\brequests\.(?:get|post|head)\b|\bhttpx\b|\bhttp\.client\b|\bsocket\.socket\b|\burlopen\b/i },
  { id: "downloader", pattern: /\b(?:wget|curl)\b/i },
];

//: Named to avoid shadowing the global `URL` constructor, which `hostOf` needs.
const URL_PATTERN = /\bhttps?:\/\/[^\s"'`)\\<>]+/gi;

export interface EgressFinding {
  sequence: number;
  tool: string;
  indicator: string;
  detail: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host + new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Every reason this arm must not be scored, or an empty list when it is clean. */
export function detectEvaluationEgress(toolCalls: ToolCallSummary[]): EgressFinding[] {
  const findings: EgressFinding[] = [];
  for (const call of toolCalls) {
    if (!EXECUTABLE_TOOLS.has(call.name)) continue;
    const text = call.event_ref.excerpt ?? "";
    let sawExternalUrl = false;
    let sawAllowedUrl = false;
    for (const url of text.match(URL_PATTERN) ?? []) {
      const target = hostOf(url);
      if (!target) continue;
      if (ALLOWED_HOST.test(target)) sawAllowedUrl = true;
      else {
        sawExternalUrl = true;
        findings.push({ sequence: call.sequence, tool: call.name, indicator: "external-url", detail: url.slice(0, 200) });
      }
    }
    for (const { id, pattern } of COMMAND_INDICATORS) {
      const match = pattern.exec(text);
      if (!match) continue;
      // A downloader aimed at the local proxy is the sanctioned skill fetch. Only
      // an unqualified one -- a target the excerpt does not show, or one that is
      // not the proxy -- is a finding, and an external URL is already reported.
      if (id === "downloader" && (sawAllowedUrl || sawExternalUrl)) continue;
      findings.push({ sequence: call.sequence, tool: call.name, indicator: id, detail: match[0].trim().slice(0, 200) });
    }
  }
  return findings;
}
