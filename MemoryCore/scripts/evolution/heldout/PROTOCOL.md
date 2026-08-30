# Held-out / Discriminative Evaluation Protocol v3

## Purpose

This is a new research-evidence suite for Candidate v4. It does not modify or replace the frozen AC-01–AC-05 Regression Suite, its GatePolicy, or any historical result.

`heldout-v2` is preserved as an invalid implementation revision: HO-07 requested `maintenance`, although the frozen state tool schema only accepts `safe`. Its full main attempt and all triggered probes remain immutable evidence, but cannot be used as a capability conclusion. `heldout-v3` makes the smallest possible repair: HO-07 requests the already-supported `safe` mode. No other Case, fixture, Oracle, limit, critical flag, model, toolset, or policy changes.

The suite is **task-instance held-out**, not researcher-blind: its author knows the existing suite and Candidate v4. Its tasks, fixtures, expected values, paths, and critical labels were selected before any Candidate v4 run on this suite, not from Candidate v4 outputs.

## Frozen main-suite design

| ID | Capability | Task structure | Deterministic evidence | Critical |
|---|---|---|---|---|
| HO-01 | indirect structured edit | Resolve a selected policy through a nonstandard task manifest; update two fields of one object in an array while preserving another region's decoy policy. | schema, two JSON values, protected decoy hash, allowlist | yes |
| HO-02 | textual scope | Update one line under a named Markdown section; identical wording elsewhere must remain unchanged. | exact target file, protected companion hash, allowlist | no |
| HO-03 | active-reference consistency | Migrate an active artifact identifier in two JSON consumers while retaining a historical mention. | two JSON values, history hash, allowlist | yes |
| HO-04 | two-target batch | Resolve two logical targets and rotate matching values in two separate JSON files without changing a template. | two JSON values, template hash, allowlist | no |
| HO-05 | structured deletion | Remove a deprecated subtree while retaining sibling fallbacks. | JSON absence/value, allowlist | no |
| HO-06 | safe missing-target failure | A logical target maps to a missing resource while a similar decoy exists; make no task-data change. | zero-diff command, all fixture hashes, missing-path check | yes |
| HO-07 | revisioned state operation | Change the supported safe mode using deterministic state tools while ignoring a same-shaped file decoy. | exact state-tool sequence, mode/revision command, decoy hash | yes |
| HO-08 | path migration | Move a package definition to a new directory, update a consumer path, and preserve the package content checksum. | old/new existence, content hash, consumer value, integrity command, allowlist | yes |

All Case prompts use new task wording and new fixtures. No prompt, fixture, Oracle, path, value, or expected output embeds Candidate-specific text, Candidate IDs, old Case IDs, or values from a Candidate v4 run.

## Controls to freeze before execution

- suite ID `nanobot-heldout-discriminative-suite`, revision `heldout-v2` and suite hash;
- all prompt bytes, Case hashes, fixture hashes, deterministic Oracle hashes and command implementation hashes;
- limits, critical flags, provider/model/temperature/fallback, tool schema and adapter/runner source hashes;
- official Baseline artifact and frozen Candidate v4 artifact hashes;
- `promotion_evidence_v2` policy and stability-probe policy;
- main run order and fresh workspace/session isolation rules.

The primary attempt is immutable. Any implementation correction produces a new revision and preserves the old attempt; no Case/Oracle/Gate/budget change is treated as a retry.

## Research evidence layer (not the production Gate)

`promotion_evidence_v2` is an evidence-only calculation. It does not modify `gate-v1` or authorize promotion.

1. Regression evidence cites the frozen v4 Regression Suite main attempt and all three AC-05 probes; it must not hide the one Candidate budget failure.
2. Held-out improvement requires at least one main-attempt `newly_fixed`, zero main-attempt `newly_broken`, all critical Candidate runs passing, total-token increase at most 25%, tool increase at most 5, and model-call increase at most 2.
3. Each main-attempt `newly_fixed` or `newly_broken`, and every Candidate run at or above 90% of any budget, receives exactly three independent paired probes. A claimed improvement requires Candidate PASS in at least 2/3 and Baseline PASS in at most 1/3. A regression is disqualifying when Candidate fails more often than Baseline in its probe set.
4. Probes are labelled evidence-only and never replace a main attempt. All infra/fairness failures are reported.

If this evidence is satisfied, stop for the Promotion Critical Review; do not write official Skill data.
