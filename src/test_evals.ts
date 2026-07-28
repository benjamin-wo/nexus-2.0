// @ts-nocheck
import { Orchestrator } from "./core/Orchestrator";
import { StorageService } from "./database/Storage";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

declare var process: any;

console.log("=========================================");
console.log("     Nexus E2E Capability Evaluations    ");
console.log("=========================================");

async function testCronScheduling() {
  console.log("\n🧪 Running Eval: Cron Scheduling Capability...");
  const orchestrator = new Orchestrator();
  const storage = new StorageService();
  await storage.initialize();

  const testChatId = `eval_chat_cron_${Date.now()}`;
  const query = "schedule a reminder to back up database every weekday at 11:45 PM";

  console.log(`Sending user query: "${query}"`);
  const response = await orchestrator.processMessage(testChatId, query);
  console.log(`Response received: \n${response}\n`);

  // Assert database reminder entry has been added with valid cron
  const reminders = await storage.getUserReminders(testChatId);
  if (reminders.length === 0) {
    throw new Error("FAIL: No reminder was registered in the database.");
  }

  const reminder = reminders[0];
  console.log(`✅ Found reminder in DB:`);
  console.log(`   - Message: "${reminder.message}"`);
  console.log(`   - Cron expression: "${reminder.cronExpression}"`);
  console.log(`   - Due at: ${reminder.dueAt}`);

  if (!reminder.cronExpression) {
    throw new Error("FAIL: Reminder cronExpression is empty or null.");
  }

  console.log("✅ Cron Scheduling Eval: PASSED!");
  await storage.close();
}

async function testHtmlHosting() {
  console.log("\n🧪 Running Eval: HTML Page Design & Hosting...");
  const orchestrator = new Orchestrator();
  const testChatId = `eval_chat_html_${Date.now()}`;
  
  const query = "host a premium dashboard page named 'eval-sales.html' with dark mode colors showing sales charts";

  console.log(`Sending user query: "${query}"`);
  const response = await orchestrator.processMessage(testChatId, query);
  console.log(`Response received: \n${response}\n`);

  // Assert file has been created on disk
  const pagesDir = join(process.cwd(), "src", "public", "pages");
  const filePath = join(pagesDir, "eval-sales.html");

  if (!existsSync(filePath)) {
    throw new Error("FAIL: Hosted HTML page 'eval-sales.html' not found on disk.");
  }

  const html = await readFile(filePath, "utf-8");
  console.log("✅ Hosted HTML file verified on disk.");

  // Assert basic HTML structure
  const hasDoctype = html.toLowerCase().includes("<!doctype html>");
  const hasHtml = html.toLowerCase().includes("<html");
  const hasHead = html.toLowerCase().includes("<head");
  const hasBody = html.toLowerCase().includes("<body");
  const hasStyle = html.toLowerCase().includes("<style") || html.toLowerCase().includes("style=");

  if (!hasDoctype || !hasHtml || !hasHead || !hasBody) {
    throw new Error("FAIL: Generated HTML does not contain complete/standard HTML structure.");
  }

  if (!hasStyle) {
    throw new Error("FAIL: Generated HTML does not contain CSS styles or premium dark mode color styles.");
  }

  console.log("✅ HTML structure assertions passed:");
  console.log(`   - DOCTYPE: Present`);
  console.log(`   - html/head/body: Present`);
  console.log(`   - CSS styling: Present`);

  // Clean up
  await unlink(filePath);
  console.log("🧹 Cleaned up hosted test file.");
  console.log("✅ HTML Hosting Eval: PASSED!");
}

async function runAllEvals() {
  // Ensure we have API keys configured
  const provider = process.env.LLM_PROVIDER || "gemini";
  const apiKey =
    provider === "gemini"
      ? process.env.GEMINI_API_KEY
      : provider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey.startsWith("your_")) {
    console.log(`\n❌ Error: LLM Provider API Key not configured. Evaluations require a valid API key to run ReAct loops.`);
    process.exit(1);
  }

  try {
    await testCronScheduling();
    await testHtmlHosting();
    console.log("\n=========================================");
    console.log("      ALL CAPABILITY EVALUATIONS PASSED  ");
    console.log("=========================================");
  } catch (err: any) {
    console.error("\n❌ Evaluation failed:", err.message);
    process.exit(1);
  }
}

runAllEvals().catch(console.error);
