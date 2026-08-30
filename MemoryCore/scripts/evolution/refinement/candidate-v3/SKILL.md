---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. Use a concrete path directly. Consult `.task/targets.json` only to resolve an unresolved logical alias; do not use file discovery for dedicated state operations.
2. For dedicated state tools: `state_read` → `state_apply` with the observed revision → `state_verify`.
3. For a rename or identifier replacement that may affect references, search for the current identifier first. Read only matching resources, make all required updates in one supported operation when possible, and do not enumerate directories before that search.
4. Verify once at the relevant scope. Reuse the successful update result and a repeat reference search; retain a structural check when the task or tool makes it necessary, but do not repeat exploration.
5. Stop after the requested change and required verification succeed. Do not require Git where unavailable; report an actual blocker instead of retrying unrelated work.
