import { expect, test, describe, beforeAll } from "bun:test";
import { SkillRegistry } from "../src/core/SkillRegistry";

describe("SkillRegistry multi-file skill loading", () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    registry = SkillRegistry.getInstance();
    await registry.initialize();
  });

  test("webPage skill loads despite sibling helper imports", () => {
    const skill = registry.getSkill("webPage");
    expect(skill).toBeDefined();
    expect(skill!.instructions.length).toBeGreaterThan(0);
  });

  test("webPage template action executes through sibling helper module", async () => {
    const result = await registry.executeSkill("webPage", {
      action: "template",
      layoutType: "magazine",
    });
    expect(result.success).toBe(true);
    expect(result.boilerplate.length).toBeGreaterThan(100);
  });

  test("webPage host action executes through sibling helper module", async () => {
    const result = await registry.executeSkill("webPage", {
      action: "host",
      fileName: "test_host_check.html",
      htmlContent: "<!DOCTYPE html><html><body><h1>OK</h1></body></html>",
    });
    expect(result.success).toBe(true);
  });
});
