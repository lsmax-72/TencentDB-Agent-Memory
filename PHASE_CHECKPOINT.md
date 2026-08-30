# Autonomous Evolution Checkpoint

- Branch: feat/evolution-candidate-refinement
- Current candidate: phase5b-candidate-v4 (sha256:28537763d10ace8648ef8631801dac68962a68a11e56890c60869b709f62a075)
- Held-out v2 is preserved but invalid due to the HO-07 unsupported tool enum. Valid held-out v3 suite hash: sha256:03510146cf5726a8b9e44aa02b3e4a64a942c323ac72950a86bc8bc54f8831d2.
- v3 main had 0 newly_fixed and 0 newly_broken; required probes show a stable HO-08 Candidate regression (0/3 vs Baseline 2/3 pass).
- Conclusion: promotion_evidence_v2 FAIL. Do not generate v5 or promote v4.
- Completed: held-out fixtures, freeze guards, real v2/v3 attempts and probes, evidence report. All raw evidence is in outputs/heldout-protocol-v2 and outputs/heldout-protocol-v3.
- Next action: Critical Review before any protocol/scope change. No push, PR, merge, or official Skill write is authorized.
