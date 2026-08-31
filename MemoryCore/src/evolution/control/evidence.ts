import { createHash } from "node:crypto";

/** Defense in depth for trace display. Source ACLs are still required; this is not a DLP guarantee. */
export function redactEvidence(text: string): { text: string; replacements: number; original_sha256: string } {
  let replacements = 0;
  const replace = (_match: string) => { replacements++; return "[REDACTED_CREDENTIAL]"; };
  const cleaned = text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi, replace)
    .replace(/\b(?:sk-mem-|sk-proj-|sk-)[A-Za-z0-9_-]{12,}/g, replace)
    .replace(/(?:["']?(?:api[_-]?key|password|secret[_-]?key|access[_-]?token|authorization)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, replace);
  return { text: cleaned, replacements, original_sha256: createHash("sha256").update(text).digest("hex") };
}
