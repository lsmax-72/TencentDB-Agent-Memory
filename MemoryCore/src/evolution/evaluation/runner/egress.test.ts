import { describe, expect, it } from "vitest";
import type { ToolCallSummary } from "../contracts/types.js";
import { detectEvaluationEgress } from "./egress.js";

function call(sequence: number, name: string, excerpt: string): ToolCallSummary {
  return { sequence, name, outcome: "SUCCEEDED", event_ref: { kind: "tool_event", uri: `nanobot://run/tool/${sequence}`, excerpt } };
}

describe("detectEvaluationEgress", () => {
  it("catches the incident: the agent fetching the task statement from AtCoder", () => {
    const findings = detectEvaluationEgress([
      call(1, "exec", '{"arguments":{"command":"curl -sSk --max-time 30 \\"https://atcoder.jp/contests/abc388/tasks/abc388_b\\" -o abc388b.html"}}'),
      call(2, "exec", '{"arguments":{"command":"curl -sSk \\"https://www.google.com/search?q=%22Heavy+Snake%22+atcoder\\""}}'),
    ]);
    expect(findings.map((finding) => finding.indicator)).toEqual(["external-url", "external-url"]);
    expect(findings[0].detail).toContain("atcoder.jp");
    expect(findings[0].sequence).toBe(1);
  });

  it("allows the sanctioned skill fetch from the local proxy", () => {
    expect(detectEvaluationEgress([
      call(1, "exec", '{"arguments":{"command":"curl -sSk -X POST http://tdai-proxy:8096/skill-bridge/v3/skill/get-by-name -d {...}"}}'),
    ])).toEqual([]);
  });

  it("flags an unqualified downloader whose target the excerpt does not show", () => {
    expect(detectEvaluationEgress([
      call(1, "exec", '{"arguments":{"command":"curl -sSk --max-time 20 \\"$TARGET_URL\\" -o page.html"}}'),
    ]).map((finding) => finding.indicator)).toEqual(["downloader"]);
  });

  it("flags package installs, clones and network code", () => {
    const indicators = detectEvaluationEgress([
      call(1, "exec", '{"arguments":{"command":"pip install atcoder-tools"}}'),
      call(2, "exec", '{"arguments":{"command":"git clone https://github.com/x/y"}}'),
      call(3, "write_file", '{"arguments":{"content":"import urllib.request\\nurllib.request.urlopen(u)"}}'),
    ]).map((finding) => finding.indicator);
    expect(indicators).toContain("package-install");
    expect(indicators).toContain("repo-clone");
    expect(indicators).toContain("network-library");
    expect(indicators).toContain("external-url");
  });

  it("ignores tool calls that cannot execute anything", () => {
    expect(detectEvaluationEgress([
      call(1, "read_file", '{"arguments":{"path":"problem.md"},"result":"see https://example.com for details"}'),
      call(2, "list_dir", '{"arguments":{"path":"."},"result":"a.py b.py"}'),
    ])).toEqual([]);
  });

  it("stays clean for an ordinary solve", () => {
    expect(detectEvaluationEgress([
      call(1, "exec", '{"arguments":{"command":"cd workspace && python3 sol.py < in.txt"}}'),
      call(2, "write_file", '{"arguments":{"content":"import sys\\nprint(sum(map(int, sys.stdin)))"}}'),
    ])).toEqual([]);
  });
});
