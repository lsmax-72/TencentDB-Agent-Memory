import { describe, expect, it } from "vitest";
import { currentSkillMetadataInstance, withSkillMetadataInstance } from "./skill-metadata-instance-context.js";

describe("standalone Skill metadata instance context", () => {
  it("isolates concurrent tenant requests and restores the fallback", async () => {
    const seen = await Promise.all(["instance-a", "instance-b"].map((instance, index) =>
      withSkillMetadataInstance(instance, async () => {
        await new Promise(resolve => setTimeout(resolve, index ? 1 : 5));
        return currentSkillMetadataInstance("default");
      })));
    expect(seen).toEqual(["instance-a", "instance-b"]);
    expect(currentSkillMetadataInstance("default")).toBe("default");
  });
});
