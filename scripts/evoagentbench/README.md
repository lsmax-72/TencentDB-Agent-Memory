# EvoAgentBench-compatible Algorithmic Reasoning

This integration pins the official EvoAgentBench and LiveCodeBench revisions and keeps benchmark execution outside MemoryCore. The official verifier remains the source of task reward; the local adapter only normalizes evidence for the existing Evolution UI and research reports.

The original protocols use `vanilla`, `memory`, and `skill`. Protocol v5 adds a fourth `memory_skill` arm. It reuses each standalone selector and injects Skill before Memory; it does not cherry-pick different combined assets. Only official train tasks may produce Memory or Skill candidates. Official test traces are observation-only. Candidate assets are evaluation-only and must never be promoted by this runner.

The frozen protocol is `protocol-code-v1.json`. Regenerate it only when intentionally creating a new protocol revision:

```bash
python3 -m scripts.evoagentbench.protocol \
  --split /Users/lsmax/Coder/EvoAgentBench/benchmark/data/splits/code_implementation.json \
  --output scripts/evoagentbench/protocol-code-v1.json
```

Run offline contract tests with:

```bash
python3 -m unittest scripts.evoagentbench.test_protocol
```

Create the dedicated 8125 Team and immutable artifact root, then run one pinned trial:

```bash
python3 -m scripts.evoagentbench.driver setup
python3 -m scripts.evoagentbench.driver connectivity
python3 -m scripts.evoagentbench.driver run --phase smoke --arm vanilla --task abc301_a
```

After both frozen smoke tasks pass, collect the remaining experience tasks with a resumable sequential runner. Valid smoke results are reused for the two overlapping train IDs; infrastructure failures stop the batch and require an explicitly numbered retry:

```bash
python3 -m scripts.evoagentbench.batch experience
```

Freeze one train-only Memory/Skill revision after all 24 experience outcomes exist:

```bash
python3 -m scripts.evoagentbench.refine --revision 1 --attempt 1
```

Infrastructure or response-format retries increment `--attempt` without consuming the two semantic Skill revision slots. A frozen semantic revision is immutable.
Validated per-case checkpoints from a failed attempt may be reused explicitly with `--resume-from-attempt`; the frozen manifest retains both attempt numbers and the original generation usage.
When only the Skill synthesis is revised from train evidence, `--reuse-memories-from-revision` carries forward the frozen Memory content and provenance without another model call.

The original protocol still records a two-revision refinement ceiling. If both
revisions are rejected because one item in the batch is invalid, do not edit or
regenerate either artifact. The separately hashed refinement policy v2 permits
one mechanical repair revision: remove only Skill IDs explicitly named by the
source review, revalidate every retained Skill against its grounded train
quotes, and make zero model calls.

```bash
python3 -m scripts.evoagentbench.repair_candidate \
  --source-revision 2 --target-revision 3
```

This changes candidate refinement provenance only. It does not change the task
selection, model, budget, development gate, official test gate, or promotion
rules. The repair receipt can authorize development evaluation, never test
access or production adoption.

Each official task gets a fresh Hub Task, nanobot workspace, session and loopback identity bridge. The bridge permits only OpenAI-compatible chat completions to the existing MemoryProxy and stores usage/model hashes without retaining request or response bodies.

After all three arms of a frozen phase exist, build and ingest one immutable comparison:

```bash
python3 -m scripts.evoagentbench.report --root /Users/lsmax/Coder/evoagentbench-artifacts/code-v1 \
  --phase development --attempt-id pilot-r1 --candidate-revision 1 \
  --candidate /path/to/frozen/SKILL.md --ingest
```

Development and test runs must name the frozen revision for `memory` and `skill`
arms with `--candidate-revision`. The driver verifies the complete candidate
artifact hash before creating a Hub task. A Skill arm is fail-closed unless that
revision has an `APPROVED_FOR_DEVELOPMENT` review receipt. Retrieval is the
deterministic `lexical-idf-v1` algorithm, injects at most two assets through the
same nanobot message path, and records the exact asset IDs and hashes in a
per-run immutable receipt.

New protocol revisions may opt into `lexical-idf-applicability-v6` for the Skill
arm. It requires a frozen `applicability_profile`, records every selection or
rejection reason, handles common numeric-bound formats, and requires matching
task-family plus objective/entity signals. It may inject zero Skills. Existing
frozen protocols continue to default to `lexical-idf-v1`; intermediate offline
diagnostic revisions remain artifacts rather than supported runtime algorithms.

Protocol v5 is a separate candidate-blind pilot over previously unused official
train tasks. It freezes 24 experience and 12 held-out development tasks across
three title-only capability families before generating any Candidate:

```bash
export TDAI_EVO_PROTOCOL_FILE=$PWD/scripts/evoagentbench/protocol-code-v5.json
python3 -m scripts.evoagentbench.driver setup --root /path/to/code-v5-factorial
python3 -m scripts.evoagentbench.subset_cache --root /path/to/code-v5-factorial --phase experience
python3 -m scripts.evoagentbench.subset_cache --root /path/to/code-v5-factorial --phase development
```

After train-only Memory and Skill artifacts are frozen, run the mandatory
retrieval preflight. Development execution is blocked unless at least one
held-out task receives a Skill and the Candidate contains no held-out ID:

```bash
python3 -m scripts.evoagentbench.factorial_preflight \
  --root /path/to/code-v5-factorial --candidate-revision 2
python3 -m scripts.evoagentbench.batch development \
  --root /path/to/code-v5-factorial --candidate-revision 2
```

The report includes all evolved-vs-Vanilla comparisons, combined-vs-single-arm
increments, and a secondary factorial interaction estimate. Combined context
cost is reported as a real treatment cost, not normalized away.

The same stages can be resumed without overwriting a completed run. A failed
model or infrastructure attempt still stops for an explicitly versioned retry:

```bash
python3 -m scripts.evoagentbench.factorial_pipeline \
  --root /path/to/code-v5-factorial --ingest
```

Before spending model tokens, replay previously frozen vanilla prompts through
both selectors. This is a retrieval diagnostic only and must not be reported as
an evaluation result:

```bash
python3 -m scripts.evoagentbench.applicability_audit \
  --runs /path/to/frozen/runs \
  --source-skills /path/to/source/skills.json \
  --projected-skills /path/to/projected/skills.json \
  --phase development --algorithm lexical-idf-applicability-v6 \
  --output /path/to/new/audit.json
```

The next candidate-generation path uses one train-only local patch per trace
before any cross-task Skill synthesis. Failed traces can contribute warnings,
not successful strategies; every patch must quote its frozen source memory.
Exact mechanism clusters require two independent tasks and a shared task-family
signal. A completed patch artifact is still not a Candidate and cannot be
evaluated or promoted:

```bash
python3 -m scripts.evoagentbench.trace_patch_runner \
  --root /Users/lsmax/Coder/evoagentbench-artifacts/code-v1 \
  --source-revision 3 --attempt-id trace2skill-r1-a1
```

If infrastructure fails after some calls, keep that attempt and reuse only its
validated checkpoints in a new immutable attempt with
`--reuse-from-attempt trace2skill-r1-a1`.

After the patch artifact is frozen, synthesize one independent Skill per
eligible mechanism cluster. The output remains train-only and is approved only
for a future development evaluation; `effect_proven=false` and promotion stays
forbidden:

```bash
python3 -m scripts.evoagentbench.trace_skill_runner \
  --root /path/to/new-protocol-root \
  --patch-artifact /path/to/frozen/trace-patches-r1 \
  --source-revision 1 --target-revision 2 \
  --attempt-id trace2skill-candidate-r2-a1
```

If a frozen absolute similarity threshold yields no cluster on a new train
sample, keep that artifact unchanged. A generation-only revision may propose
mutual-nearest pairs inside capability families frozen before execution, then
use a temperature-zero reviewer to admit only pairs sharing one concrete
procedure. The reviewer sees train patches only, and its decisions are frozen
before any held-out run.
