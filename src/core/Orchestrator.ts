import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { StorageService, Message, MediaAttachment } from "../database/Storage";
import { LlmService } from "./LlmService";
import { WorkerAgent } from "./WorkerAgent";
import { TaskRegistry } from "./TaskRegistry";
import { GeminiEmptyResponseError, GeminiApiError } from "./errors";
import { Logger } from "./Logger";

export class Orchestrator {
  private llmService: LlmService;

  constructor() {
    this.llmService = new LlmService();
  }

  async processMessage(chatId: string, userText: string, media?: MediaAttachment[], threadId?: number): Promise<string> {
    const storage = new StorageService();
    await storage.initialize();

    const startTime = Date.now();
    let isError = false;
    let logMsg = "";
    let finalResponse = "";

    try {
      // 1. Intercept Task Commands
      const statusMatch = userText.match(/^\/status|^what's running|^status/i);
      if (statusMatch) {
        const active = await storage.getActiveTasks(chatId);
        if (active.length === 0) {
          return "ℹ️ There are no active background tasks running for this chat.";
        }
        return "⏳ **Active Background Tasks:**\n" + active
          .map((t) => `- \`${t.taskId}\`: ${t.description} (Started ${t.createdAt.toLocaleTimeString()})`)
          .join("\n");
      }

      const cancelMatch = userText.match(/^(?:\/cancel|\/stop|cancel|stop)\s+(task_[a-z0-9]+)/i);
      if (cancelMatch) {
        const taskId = cancelMatch[1];
        const success = await TaskRegistry.getInstance().cancelTask(taskId);
        if (success) {
          return `🛑 Task \`${taskId}\` has been cancelled successfully.`;
        }
        return `⚠️ Task \`${taskId}\` was not found or is not running.`;
      }

      const generalStopMatch = userText.match(/^(?:\/cancel|\/stop|cancel|stop)(?:\s+(?:tracking|bus\s+tracking|bus|polling|it|the\s+bus|all))?$/i);
      if (generalStopMatch) {
        const cancelledIds = await TaskRegistry.getInstance().cancelTasksForChat(chatId);
        if (cancelledIds.length > 0) {
          return `🛑 Successfully stopped tracking! Cancelled task(s): ${cancelledIds.map((id) => `\`${id}\``).join(", ")}.`;
        } else {
          return `ℹ️ No active tracking or background tasks found to stop.`;
        }
      }

      // 2. Fetch Chat History and personality/user context
      const history = await storage.getHistory(chatId, 15);
      
      const soulPath = join(process.cwd(), ".agent", "soul.md");
      const userPath = join(process.cwd(), ".agent", "user.md");
      const rulesPath = join(process.cwd(), ".agents", "AGENTS.md");
      let soulPrompt = "";
      let userMemory = "";
      let agentRules = "";

      if (existsSync(soulPath)) {
        soulPrompt = `\n\n# Your Personality & Tone (Soul)\n${await readFile(soulPath, "utf-8")}`;
      }
      if (existsSync(userPath)) {
        userMemory = `\n\n# User Memory & Preferences\n${await readFile(userPath, "utf-8")}`;
      }
      if (existsSync(rulesPath)) {
        agentRules = `\n\n# Formatting Rules & Core Constraints\n${await readFile(rulesPath, "utf-8")}`;
      }

      // Add current message to temporary history for classification
      const tempHistory: Message[] = [
        ...history,
        { role: "user", content: userText, media },
      ];

      // 3. Evaluate Thread Context Routing Matrix
      let workerName: string | null = null;
      if (threadId) {
        workerName = await storage.getThreadAssignment(threadId);
      }

      if (workerName) {
        console.log(`[Orchestrator] Bypassing classification, routing to assigned worker: ${workerName}`);
      } else {
        // Fallback to LLM Classification Master Router
        const routerPath = join(process.cwd(), ".agent", "orchestrator.md");
        if (!existsSync(routerPath)) {
          throw new Error("Orchestrator instruction profile (.agent/orchestrator.md) is missing.");
        }
        const routerInstructions = await readFile(routerPath, "utf-8");
        const routerInstructionsWithContext = `${routerInstructions}${soulPrompt}${userMemory}${agentRules}`;

        const classificationMessages: Message[] = [
          { role: "system", content: routerInstructionsWithContext },
          ...tempHistory,
        ];

        console.log("[Orchestrator] Routing user request...");
        const routeResponse = await this.llmService.generateResponse(classificationMessages);
        const spawnMatch = routeResponse.match(/<spawn>([a-zA-Z0-9]+)<\/spawn>/i);

        if (spawnMatch) {
          workerName = spawnMatch[1];
        } else {
          finalResponse = routeResponse.replace(/<spawn>.*?<\/spawn>/gi, "").trim();
        }
      }

      if (workerName) {
        console.log(`[Orchestrator] Spawning worker: ${workerName}`);

        // 4. Load Worker Profile and allowed skills
        const workerPath = join(process.cwd(), ".agent", "agents", `${workerName}.md`);
        if (!existsSync(workerPath)) {
          throw new Error(`Worker profile '${workerName}' (.agent/agents/${workerName}.md) is missing.`);
        }
        const workerMd = await readFile(workerPath, "utf-8");

        const skillsSection = workerMd.match(/## Available Skills\r?\n([\s\S]*?)(?:\r?\n##|$)/i);
        const allowedSkills: string[] = [];
        if (skillsSection) {
          const lines = skillsSection[1].split("\n");
          for (const line of lines) {
            const skillMatch = line.match(/^[-*]\s+`?([a-zA-Z0-9_]+)`?/);
            if (skillMatch) {
              allowedSkills.push(skillMatch[1].trim());
            }
          }
        }

        Logger.info(`[Orchestrator] Allowed skills parsed for ${workerName}:`, allowedSkills);

        const workerInstructionsWithContext = `${workerMd}${soulPrompt}${userMemory}${agentRules}`;

        const worker = new WorkerAgent(workerName, workerInstructionsWithContext, allowedSkills);
        finalResponse = await worker.execute(history.concat({ role: "user", content: userText, media }), chatId);
      }

      // 5. Commit conversations to history
      await storage.saveMessage(chatId, { role: "user", content: userText });
      await storage.saveMessage(chatId, { role: "assistant", content: finalResponse });

      logMsg = `Successfully processed request in ${Date.now() - startTime}ms`;
      return finalResponse;
    } catch (error: any) {
      isError = true;
      logMsg = `Orchestration error: ${error.message}`;
      Logger.error("[Orchestrator Error]", error);
      
      if (error instanceof GeminiEmptyResponseError || error instanceof GeminiApiError) {
        return "⚠️ I'm sorry, I couldn't process that request due to a temporary AI provider issue. Please try again in a few moments.";
      }
      
      return `❌ An internal agent error occurred: ${error.message}`;
    } finally {
      // Telemetry log tracking
      await storage.logEvent({
        category: "orchestrator",
        message: logMsg,
        durationMs: Date.now() - startTime,
        isError,
      });
      await storage.close();
    }
  }
}
