# EvoAgentBench-compatible Algorithmic Reasoning

This integration pins the official EvoAgentBench and LiveCodeBench revisions and keeps benchmark execution outside MemoryCore. The official verifier remains the source of task reward; the local adapter only normalizes evidence for the existing Evolution UI and research reports.

The three arms are `vanilla`, `memory`, and `skill`. Only official train tasks may produce Memory or Skill candidates. Official test traces are observation-only. Candidate assets are evaluation-only and must never be promoted by this runner.

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

Each official task gets a fresh Hub Task, nanobot workspace, session and loopback identity bridge. The bridge permits only OpenAI-compatible chat completions to the existing MemoryProxy and stores usage/model hashes without retaining request or response bodies.

After all three arms of a frozen phase exist, build and ingest one immutable comparison:

```bash
python3 -m scripts.evoagentbench.report --root /Users/lsmax/Coder/evoagentbench-artifacts/code-v1 \
  --phase development --attempt-id pilot-r1 --candidate /path/to/frozen/SKILL.md --ingest
```
