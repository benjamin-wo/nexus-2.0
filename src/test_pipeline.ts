import { SkillRegistry } from "./core/SkillRegistry";
import { StorageService } from "./database/Storage";
import { TaskRegistry } from "./core/TaskRegistry";
import { Orchestrator } from "./core/Orchestrator";
import { join } from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";

async function runTests() {
  console.log("=========================================");
  console.log("    Automated Verification Pipeline      ");
  console.log("=========================================\n");

  const storage = new StorageService();
  
  try {
    // 1. Test Database Initialization
    console.log("1. Testing Database Adapter...");
    await storage.initialize();
    console.log("✅ Database initialized successfully (SQLite).");

    // Write a test log entry
    await storage.logEvent({
      category: "test_suite",
      message: "Automated verification run",
      isError: false,
    });
    console.log("✅ Database write/logEvent verified.");

    // 2. Test Skill Registry Dynamic Scaffolding
    console.log("\n2. Testing Dynamic Skill Registry...");
    const registry = SkillRegistry.getInstance();
    await registry.initialize();
    
    const skills = registry.getSkills();
    console.log(`✅ Loaded ${skills.length} skills dynamically from disk:`);
    skills.forEach((s) => {
      console.log(`   - [${s.name}]: ${s.description.substring(0, 50)}...`);
    });

    const expectedSkills = ["calculator", "fileOps", "weather", "webScraper", "reminder", "createSkill"];
    for (const exp of expectedSkills) {
      if (!registry.getSkill(exp)) {
        throw new Error(`Critical skill '${exp}' failed to load into registry.`);
      }
    }
    console.log("✅ All required core skills are successfully loaded.");

    const frontendDesignSkill = registry.getSkill("frontend-design");
    if (!frontendDesignSkill || !frontendDesignSkill.instructions || frontendDesignSkill.instructions.length === 0) {
      throw new Error("'frontend-design' skill loaded with empty instructions - the SKILL.md guidance pipeline is broken.");
    }
    console.log(`✅ Skill instructions pipeline verified: 'frontend-design' carries ${frontendDesignSkill.instructions.length} chars of guidance.`);

    // 3. Test Skill Handlers directly
    console.log("\n3. Testing Local Skill Execution...");
    
    // Test Calculator
    const calcResult = await registry.executeSkill("calculator", { expression: "(150 + 50) / 4" });
    if (calcResult.result !== 50) {
      throw new Error(`Calculator test failed: expected 50, got ${calcResult.result}`);
    }
    console.log("✅ Calculator skill verified: (150 + 50) / 4 = 50");

    // Test screenshotPage - the riskiest new dependency (headless Chromium actually
    // launching in this environment), tested deterministically with no LLM call.
    console.log("   Testing screenshotPage (headless Chromium render)...");
    const screenshotResult = await registry.executeSkill("screenshotPage", {
      htmlContent: "<!DOCTYPE html><html><body><h1>Verification</h1></body></html>",
    });
    const pngBytes = Buffer.from(screenshotResult.media?.[0]?.data || "", "base64");
    if (pngBytes.length < 8 || pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50 || pngBytes[2] !== 0x4e || pngBytes[3] !== 0x47) {
      throw new Error("screenshotPage did not return a valid PNG.");
    }
    console.log(`✅ screenshotPage verified: rendered a valid ${pngBytes.length}-byte PNG.`);

    // Test FileOps
    console.log("   Testing FileOps write/read...");
    const testFile = "temp_test_verification.txt";
    await registry.executeSkill("fileOps", {
      operation: "write",
      path: testFile,
      content: "Hermes Assistant Verification Token: OK",
    });
    
    const readResult = await registry.executeSkill("fileOps", {
      operation: "read",
      path: testFile,
    });
    
    if (!readResult.content.includes("Verification Token: OK")) {
      throw new Error("FileOps write/read validation failed.");
    }
    console.log("   ✅ FileOps write and read validated.");

    // Clean up test file
    const absoluteTestFile = join(process.cwd(), testFile);
    if (existsSync(absoluteTestFile)) {
      await unlink(absoluteTestFile);
      console.log("   ✅ Temp test files cleaned.");
    }

    // 4. Test Self-Evolution / Dynamic Skill Creation
    console.log("\n4. Testing Self-Evolution (Dynamic Skill Creation)...");
    const dynamicCode = `
export async function execute(args: { multiplier: number; val: number }) {
  return { result: args.val * args.multiplier };
}
`;
    console.log("   Creating and compiling dynamic skill 'quickMultiply'...");
    await registry.executeSkill("createSkill", {
      name: "quickMultiply",
      description: "Multiplies two numbers dynamically",
      parameters: {
        type: "object",
        properties: {
          multiplier: { type: "number" },
          val: { type: "number" },
        },
        required: ["multiplier", "val"],
      },
      instructions: "Use this tool to perform multiplications.",
      codeContent: dynamicCode,
    });

    // Check if re-registered
    const newSkill = registry.getSkill("quickMultiply");
    if (!newSkill) {
      throw new Error("Dynamic skill was not loaded into registry on reload.");
    }
    console.log("   ✅ Dynamic skill successfully compiled and hot-loaded.");

    // Run dynamic skill
    const runNewSkill = await registry.executeSkill("quickMultiply", { multiplier: 6, val: 7 });
    if (runNewSkill.result !== 42) {
      throw new Error(`Dynamic skill run failed. Expected 42, got ${runNewSkill.result}`);
    }
    console.log("   ✅ Dynamic skill run verified: 6 * 7 = 42");

    // Clean up created dynamic skill folder
    console.log("   Cleaning up dynamic skill folder...");
    const dynamicDir = join(process.cwd(), ".agent", "skills", "quickMultiply");
    if (existsSync(join(dynamicDir, "handler.ts"))) await unlink(join(dynamicDir, "handler.ts"));
    if (existsSync(join(dynamicDir, "SKILL.md"))) await unlink(join(dynamicDir, "SKILL.md"));
    // Re-initialize registry to remove quickMultiply
    await registry.initialize();

    // 5. Test Background Task Scheduler/Hooks
    console.log("\n5. Testing Async Task Registry...");
    const taskId = await TaskRegistry.getInstance().startTask(
      "test_chat",
      "Dynamic verification sleep task",
      async (signal) => {
        return new Promise((resolve) => setTimeout(() => resolve("Async OK"), 100));
      }
    );
    console.log(`   ✅ Async task ${taskId} registered and launched in background.`);

    console.log("\n=========================================");
    console.log("      ALL MECHANICAL CHECKS GREEN        ");
    console.log("=========================================");
    
    // Check if API keys are present for LLM tests
    const provider = process.env.LLM_PROVIDER || "gemini";
    const apiKey =
      provider === "gemini"
        ? process.env.GEMINI_API_KEY
        : provider === "deepseek"
        ? process.env.DEEPSEEK_API_KEY
        : process.env.OPENROUTER_API_KEY;

    if (apiKey && apiKey.trim() !== "" && !apiKey.startsWith("your_")) {
      console.log(`\nDetected ${provider} API Key. Running integration test routing query...`);
      const orchestrator = new Orchestrator();
      const testResponse = await orchestrator.processMessage(
        "verification_test_chat",
        "Hello assistant! Tell me what's the weather in Paris, France right now."
      );
      console.log("\nRouter response output:");
      console.log(`Assistant > ${testResponse}`);
      console.log("\n✅ Integration routing test completed successfully!");
    } else {
      console.log(`\n[Info] LLM provider API key not configured. Skipping active routing test. Configure key in .env to run.`);
    }
  } catch (err: any) {
    console.error("\n❌ Verification failed:", err.message);
    process.exit(1);
  } finally {
    await storage.close();
  }
}

runTests();
