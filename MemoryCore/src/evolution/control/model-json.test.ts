import { describe, expect, it } from "vitest";
import { parseModelJson } from "./model-json.js";

describe("parseModelJson", () => {
  it("decodes a bare object", () => {
    expect(parseModelJson('{"route":"no_change"}', "X")).toEqual({ route: "no_change" });
  });

  it("decodes a fenced block", () => {
    // The reviewer returned exactly this shape on a live diagnosis, and the bare
    // JSON.parse turned it into a runner error.
    expect(parseModelJson('```json\n{"route":"memory_gap"}\n```', "X")).toEqual({ route: "memory_gap" });
  });

  it("decodes an object surrounded by prose", () => {
    expect(parseModelJson('Here is my verdict:\n{"route":"skill_defect"}\nHope that helps.', "X")).toEqual({ route: "skill_defect" });
  });

  it("reports an unusable answer with the text that caused it", () => {
    expect(() => parseModelJson("   ", "DIAGNOSIS_OUTPUT")).toThrowError(/DIAGNOSIS_OUTPUT_EMPTY/);
    expect(() => parseModelJson("no json here", "DIAGNOSIS_OUTPUT")).toThrowError(/DIAGNOSIS_OUTPUT_NOT_JSON/);
  });
});
