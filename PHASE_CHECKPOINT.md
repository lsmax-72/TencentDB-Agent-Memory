# Autonomous Evolution Checkpoint

- Branch: feat/evolution-candidate-refinement
- Current candidate: phase5b-candidate-v4 (sha256:28537763d10ace8648ef8631801dac68962a68a11e56890c60869b709f62a075)
- Held-out v2 is preserved but invalid due to the HO-07 unsupported tool enum. Valid held-out v3 suite hash: sha256:03510146cf5726a8b9e44aa02b3e4a64a942c323ac72950a86bc8bc54f8831d2.
- v3 main had 0 newly_fixed and 0 newly_broken; required probes show a stable HO-08 Candidate regression (0/3 vs Baseline 2/3 pass).
- Conclusion: promotion_evidence_v2 FAIL. Do not generate v5 or promote v4.
- Completed: held-out fixtures, freeze guards, real v2/v3 attempts and probes, evidence report. All raw evidence is in outputs/heldout-protocol-v2 and outputs/heldout-protocol-v3.
- Held-out work remains stopped; no v5 or protocol changes. User authorized a separate Phase 6 integration acceptance on 2026-08-30.

## Phase 6 integration acceptance (local backend complete)

- Starting HEAD: 73dd5abc109aed952fa541750eff46e9c40be694.
- Scope: storage CRUD/search/cleanup, real nanobot → MemoryProxy → MemoryCore, Hub visibility and evaluation isolation. No cloud TencentDB claim: running backend is standalone SQLite, embedding none.
- Production containers/ports 8420/8096/8125 are untouched. Existing user deployment edits must not be staged.
- Isolated test containers: phase6-core / phase6-proxy / phase6-hub; localhost ports 18420 / 18096 / 18125.
- Scripts: scripts/phase6/. No imports into default production startup; source-mounted Proxy includes existing Phase 4 guards.
- First setup retained at /Users/lsmax/Documents/Codex/2026-08-29/n/outputs/phase6-integration-20260830-r1. Docker bind startup remained Created; no model run. Renamed container phase6-core-incomplete-r1, retained its files.
- Valid attempt: /Users/lsmax/Coder/phase6-artifacts/outputs/phase6-integration-20260830-r5. Source hashes and nanobot revision are in source-freeze.json.
- Real normal smoke: PASS, 7755 tokens, 2 model calls, 1 tool call, Hub L0=3.
- Real evaluation smoke: PASS, 7999 tokens, 2 model calls, 1 tool call, actual Skill injection on both requests, Hub L0=0, Skill assets=0.
- Audit: Core files/WAL and service logs contain no evaluation canary; production Core 28 file hashes unchanged; wrong namespace/unbound requests/bridge writes rejected.
- Failures retained: r2 copy/whitespace loop timed out; r3 local TDZ implementation bug; r4 multiline injection evidence checker bug. r2–r4 containers stopped and renamed; r5 containers left running.
- Tests: integration helper 3 PASS; Proxy evaluation tests 4 PASS; syntax/diff PASS. Same-image typecheck baseline/current each 54 errors, normalized diagnostics identical (not a full build PASS).
- Hub API verified for Task, participation log, and actual L0 memory layer. UI login page verified; credential entry awaiting user approval/manual login. Test key is private/hub-user-key.txt in r5.
- Report: docs/phase6-integration-acceptance-report.md. Scope is local SQLite/FTS only, not cloud TencentDB or Skill efficacy.
- Next: human inspection of http://127.0.0.1:18125; decide subsequent secure deployment/Hub registration separately. Do not resume Candidate refinement.
- No push, PR, merge, Promotion, or production writes authorized.
