import { describe, expect, it } from "vitest";
import { heldoutCaseSet } from "./heldout-cases.js";

describe("heldoutCaseSet", () => {
  it("creates eight independent, hash-complete held-out task instances", () => {
    const set = heldoutCaseSet();
    expect(set.cases.map((item) => item.case_id)).toEqual(["HO-01", "HO-02", "HO-03", "HO-04", "HO-05", "HO-06", "HO-07", "HO-08"]);
    expect(new Set(set.cases.map((item) => item.case_hash)).size).toBe(8);
    expect(set.cases.every((item) => item.revision === "heldout-v2" && item.oracle.assertions.length > 0)).toBe(true);
    expect(set.cases.find((item) => item.case_id === "HO-07")?.critical).toBe(true);
  });

  it("keeps missing-target and protected-data behavior deterministic", () => {
    const set = heldoutCaseSet();
    expect(set.fixtures["HO-06"].files["profiles/staging.json"]).toContain("ready");
    expect(set.cases.find((item) => item.case_id === "HO-06")?.oracle.assertions.some((item) => item.id === "zero-diff")).toBe(true);
    expect(set.cases.find((item) => item.case_id === "HO-03")?.task_input).not.toContain("old-name");
  });
});
