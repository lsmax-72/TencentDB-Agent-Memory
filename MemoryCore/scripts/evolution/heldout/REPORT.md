# Held-out / Discriminative Evaluation Protocol v2 Report

## Conclusion

Candidate v4 has **not** demonstrated stable task-instance-held-out improvement. The valid `heldout-v3` main attempt had no `newly_fixed`; its probes also contained Candidate regressions. Promotion is not justified.

## Freeze and revisions

- `heldout-v2`, suite `nanobot-heldout-discriminative-suite`, hash `sha256:6b9286f260f12df0c0ae52addade6e9f6021caf7f4615ddfacacada7f06123fb`, is preserved as historical invalid-implementation evidence. HO-07 requested `maintenance`, but the frozen state-tool schema permits only `safe`.
- `heldout-v3` is the minimal versioned repair: only HO-07's requested mode changed to the supported `safe`; all eight cases, deterministic Oracles, limits, artifacts, model/tool controls and research policy were re-frozen before its runs.
- v3 suite hash: `sha256:03510146cf5726a8b9e44aa02b3e4a64a942c323ac72950a86bc8bc54f8831d2`.
- Baseline artifact: `sha256:93e4511b1fdb1d738ab9c0bc1202898ec007fdc42a15d8aeeb3ae3128574a5a8`; v4: `sha256:28537763d10ace8648ef8631801dac68962a68a11e56890c60869b709f62a075`.
- v3 froze vLLM / `qwen3.8-27b`, temperature 0, fallback disabled, fresh session/workspace per arm, and source/config hashes.

## v3 main results

| Case | Baseline | v4 | Classification | Baseline tokens | v4 tokens | Baseline tools | v4 tools |
|---|---|---|---|---:|---:|---:|---:|
| HO-01 | FAIL | FAIL | unchanged_failure | 46,871 | 49,485 | 8 | 9 |
| HO-02 | PASS | PASS | unchanged_success | 24,547 | 25,117 | 3 | 3 |
| HO-03 | PASS | PASS | unchanged_success | 31,859 | 32,679 | 6 | 6 |
| HO-04 | PASS | PASS | unchanged_success | 34,484 | 34,901 | 8 | 8 |
| HO-05 | PASS | PASS | unchanged_success | 24,427 | 25,233 | 3 | 4 |
| HO-06 | PASS | PASS | unchanged_success | 26,220 | 37,888 | 6 | 5 |
| HO-07 | FAIL | FAIL | unchanged_failure | 26,113 | 25,569 | 3 | 3 |
| HO-08 | FAIL | FAIL | unchanged_failure | 46,370 | 49,203 | 8 | 10 |

Main counts: `newly_fixed=0`, `newly_broken=0`, unchanged success 5, unchanged failure 3. Aggregate v4 cost was +8.24% tokens, +5 tools and +2 model calls.

## Required probes

The frozen 90%-budget trigger selected HO-01, HO-06 and HO-08. Each received exactly three paired probes.

- HO-01: Candidate pass 1/3; Baseline pass 1/3. No stable improvement; failure counts are tied at 2/3, although probe 3 is a Candidate-only regression.
- HO-06: both arms pass 3/3. No improvement evidence.
- HO-08: Candidate pass 0/3; Baseline pass 2/3. Stable regression evidence: Candidate fails more often.

## Regression evidence

The old AC-01–05 Regression Suite remains unchanged: v4 main attempt `f5855171-9e8b-4526-b1e1-0e1087420fb1` was all unchanged-success and production Gate `FAIL (NO_NEW_FIX)`. Its AC-05 probes were Candidate PASS/PASS/FAIL while Baseline PASS/PASS/PASS; the final Candidate failure was `BUDGET_EXHAUSTED`. This adverse evidence is retained.

## promotion_evidence_v2

- Stable held-out improvement: **FAIL** — no main newly-fixed case and no qualified stable improvement.
- No stable regression: **FAIL** — HO-08 Candidate failure rate 3/3 exceeds Baseline 1/3.
- Critical Candidate pass: **FAIL** — HO-01, HO-07 and HO-08 fail in the main attempt.
- Cost ceilings: **PASS** — +8.24% tokens (<=25%), +5 tools (<=5), +2 model calls (<=2).
- Overall: **FAIL**. This evidence layer does not modify production `gate-v1` and does not authorize Promotion.

## Audit, tests, and next action

Every v3 main pair had matching execution fingerprints and observed-condition hashes; config/source checks stayed valid. Raw request/response, tool-event, workspace-before/after and usage sidecars are in `/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/heldout-protocol-v3`.

Tests: `npm test -- --run __tests__/evolution/heldout-protocol.test.ts src/evolution/evaluation/fixtures/heldout-cases.test.ts src/evolution/evaluation/adapters/nanobot-agent-adapter.test.ts` — 10 passed.

Next action: stop Candidate refinement. The evidence does not support v4 promotion or a v5 wording iteration; any new protocol or research direction requires Critical Review.
