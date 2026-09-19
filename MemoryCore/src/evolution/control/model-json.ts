import { EvolutionError } from "./types.js";

/**
 * Decode a model's JSON answer.
 *
 * Reviewers are asked for JSON and mostly comply, but "mostly" is not a
 * contract: the same model that returned a bare object one minute returned a
 * ```json fenced block the next, and a bare `JSON.parse` turned that into
 * `DIAGNOSIS_RUNNER_ERROR` -- a code that reads like a defect in this codebase
 * and hides the only useful fact, that the answer was merely wrapped. Chat
 * models also like a sentence before the object, so the first balanced-looking
 * `{...}` span is tried as a fallback. Anything still unparsable is reported
 * with the offending text, never as a runner error.
 */
export function parseModelJson(text: string, code: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new EvolutionError(503, `${code}_EMPTY`);
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  throw new EvolutionError(503, `${code}_NOT_JSON: ${trimmed.slice(0, 200)}`);
}
