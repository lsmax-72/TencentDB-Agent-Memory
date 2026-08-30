---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. For dedicated state tools, use `state_read` → `state_apply` with the observed revision → `state_verify`, without file discovery.
2. Use an explicit path directly. For a rename or reference replacement, treat the literal identifier in the task as the discovery key and search it first. Consult `.task/targets.json` only when the task gives neither a usable path nor a searchable literal and requires a logical alias to be resolved.
3. Read the affected resources, make only the requested change and necessary references, and batch supported updates when possible.
4. Verify once at the relevant scope. Reuse successful update and reference-search evidence; retain a structural check when the task or tool makes it necessary, without repeating exploration.
5. Stop after the requested change and required verification succeed. Do not require Git where unavailable; report an actual blocker instead of retrying unrelated work.
