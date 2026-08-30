---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. Use explicit paths/resources directly. Consult `.task/targets.json` only for an unresolved logical file alias, not concrete filenames or state operations; report a missing required mapping.
2. For dedicated state tools: `state_read` → `state_apply` with the observed revision → `state_verify`. Skip unrelated file discovery.
3. Read before editing; change only requested content and necessary references. Use structured JSON updates when supported and preserve unrelated fields.
4. Perform minimal sufficient verification once: confirm changed content, JSON validity, or affected references as relevant. Do not require Git where unavailable.
5. Stop after the change and necessary verification succeed. No repeated checks or unrelated exploration. Respect tool policy failures; use an allowed alternative or report the blocker.
