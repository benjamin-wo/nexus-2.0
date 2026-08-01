import { StorageService, LogEntry } from "../database/Storage";
import { Orchestrator } from "../core/Orchestrator";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly checkInterval = 60 * 1000; // 1 minute
  private onReminderTrigger: ((chatId: string, message: string) => Promise<void>) | null = null;

  constructor() {}

  start(onReminderTrigger: (chatId: string, message: string) => Promise<void>) {
    this.onReminderTrigger = onReminderTrigger;
    if (this.timer) return;
    this.timer = setInterval(() => this.runMaintenance(), this.checkInterval);
    console.log("[Scheduler] Background scheduler started.");
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async triggerAutoRepair(chatId: string, threadId: number | undefined, workerName: string, bot: any) {
    const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      const { WorkerAgent } = require("../core/WorkerAgent");
      const { StorageService } = require("../database/Storage");
      const { SkillRegistry } = require("../core/SkillRegistry");
      const { join } = require("path");
      const { readFileSync, existsSync } = require("fs");

      const storage = new StorageService();
      await storage.initialize();

      const prompt = `🚨 A crash was detected in execution loop: '${workerName}'.
Please analyze the recent crash logs in episodic memory and propose a patch for any broken skills.
When you output the final patched code, put it in a JSON block like:
\`\`\`json
{
  "skillName": "name_of_skill",
  "description": "...",
  "paramSchema": { ... },
  "code": "..."
}
\`\`\`
Do not apply the patch directly, just output it.`;

      const soulPath = join(process.cwd(), ".agent", "soul.md");
      const userPath = join(process.cwd(), ".agent", "user.md");
      const behaviorPath = join(process.cwd(), ".agent", "behavior.md");
      const rulesPath = join(process.cwd(), ".agents", "AGENTS.md");
      let soulPrompt = "";
      let behaviorPrompt = "";
      let userMemory = "";
      let agentRules = "";

      if (existsSync(soulPath)) {
        soulPrompt = `\n\n# Your Personality & Tone (Soul)\n${readFileSync(soulPath, "utf-8")}`;
      }
      if (existsSync(behaviorPath)) {
        behaviorPrompt = `\n\n# Global Behavior Guidelines & Core Constraints\n${readFileSync(behaviorPath, "utf-8")}`;
      }
      const dbProfile = await storage.getUserProfile(chatId);
      if (dbProfile) {
        userMemory = `\n\n# User Memory & Preferences (PostgreSQL)\n${dbProfile}`;
      } else if (existsSync(userPath)) {
        userMemory = `\n\n# User Memory & Preferences\n${readFileSync(userPath, "utf-8")}`;
      }
      const sgtDateString = new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" });
      const temporalPrompt = `\n\n# Current Time Context (Asia/Singapore SGT / UTC+8)\n- Current local date and time: ${sgtDateString}\n- All calculations, schedules, and queries should default to Singapore Time (SGT / UTC+8) unless explicitly instructed otherwise.`;

      if (existsSync(rulesPath)) {
        agentRules = `\n\n# Formatting Rules & Core Constraints\n${readFileSync(rulesPath, "utf-8")}`;
      }
      agentRules += temporalPrompt;

      const flatInstructions = `You are Nexus, a personal AI coding assistant and developer/system administrator agent.${soulPrompt}${behaviorPrompt}${userMemory}${agentRules}`;

      const allowedSkills = SkillRegistry.getInstance().getSkills().map((s: any) => s.name);

      const worker = new WorkerAgent("nexus", flatInstructions, allowedSkills);
      const response = await worker.execute([{ role: "user", content: prompt, timestamp: Date.now() }], chatId);
      
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/i);
      if (jsonMatch) {
         const patchData = JSON.parse(jsonMatch[1]);
         await storage.setProfileValue(`PATCH_PENDING_${patchData.skillName}`, patchData);
         
         const payload = `🛠️ <b>DevOps Proposed Patch for ${patchData.skillName}</b>\n\n${escapeHtml(response.replace(jsonMatch[0], ""))}`;
         
         await bot.api.sendMessage(chatId, payload, {
            parse_mode: "HTML",
            message_thread_id: threadId,
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Approve Patch", callback_data: `action:approve_patch:${patchData.skillName}` }
                ]]
            }
         });
      } else {
         await bot.api.sendMessage(chatId, `🛠️ <b>DevOps Analysis (No Patch Proposed)</b>\n\n${escapeHtml(response)}`, {
            parse_mode: "HTML",
            message_thread_id: threadId
         });
      }
      await storage.close();
    } catch (err: any) {
      console.error("[AutoRepair] Failed:", err);
      await bot.api.sendMessage(chatId, `❌ DevOps agent crashed: ${err.message}`, { message_thread_id: threadId });
    }
  }

  private async runMaintenance() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.processReminders();
      
      // Auto-prune logs once per hour
      if (new Date().getMinutes() === 0) {
        const { StorageService } = require("../database/Storage");
        const storage = new StorageService();
        await storage.initialize();
        try {
          await storage.pruneLogs(30);
          console.log("[Scheduler] Database logs pruned successfully (older than 30 days).");
        } catch (pruneErr: any) {
          console.error("[Scheduler] Failed to prune logs:", pruneErr.message);
        } finally {
          await storage.close();
        }
      }
    } catch (error) {
      console.error("[Scheduler] Maintenance error:", error);
    } finally {
      this.isRunning = false;
    }
  }

  async processReminders(): Promise<void> {
    const { StorageService } = require("../database/Storage");
    const storage = new StorageService();
    await storage.initialize();

    try {
      const pending = await storage.getPendingReminders();
      if (pending.length === 0) return;

      console.log(`[Scheduler] Found ${pending.length} pending reminders due.`);

      for (const item of pending) {
        if (this.onReminderTrigger) {
          try {
            const isTask = item.message.trim().startsWith("[TASK]");
            if (item.cronExpression) {
              const payloadText = isTask ? item.message.trim() : `⏰ **Recurring Reminder:** ${item.message}`;
              await this.onReminderTrigger(item.chatId, payloadText);
              const { getNextCronDate } = require("../utils/cron");
              const nextDueAt = getNextCronDate(item.cronExpression, new Date());
              await storage.updateReminderDueAt(item.id!, nextDueAt);
              console.log(`[Scheduler] Rescheduled recurring reminder ${item.id} to ${nextDueAt.toISOString()}`);
            } else {
              const payloadText = isTask ? item.message.trim() : `🔔 **Reminder:** ${item.message}`;
              await this.onReminderTrigger(item.chatId, payloadText);
              await storage.markReminderSent(item.id!);
            }
          } catch (err: any) {
            console.error(`[Scheduler] Failed to trigger reminder ${item.id}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Scheduler] Error checking reminders:", err.message);
    } finally {
      await storage.close();
    }
  }

  async runDevOpsMaintenance(manualChatId?: string): Promise<string> {
    console.log("[Scheduler] Running DevOps maintenance trace audits...");
    const storage = new StorageService();
    await storage.initialize();

    try {
      // Query recent logs (last 50 logs)
      // SQLite/PG
      const dbUrl = process.env.DATABASE_URL;
      let logs: any[] = [];
      
      if (dbUrl && dbUrl.trim() !== "") {
        const pgPool = new pg.Pool({ connectionString: dbUrl });
        const res = await pgPool.query("SELECT * FROM logs ORDER BY id DESC LIMIT 50");
        logs = res.rows;
        await pgPool.end();
      } else {
        const sqliteDb = new Database("assistant.db");
        logs = sqliteDb.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 50").all() as any[];
        sqliteDb.close();
      }

      const errors = logs.filter((l) => l.is_error || l.is_error === 1);
      const totalRequests = logs.filter((l) => l.category === "orchestrator").length;
      
      let maintenanceReport = `## System Health Audit Report (${new Date().toLocaleString()})\n\n`;
      maintenanceReport += `- **Total Requests Handled**: ${totalRequests}\n`;
      maintenanceReport += `- **Logged Errors**: ${errors.length} / ${logs.length} entries\n\n`;

      if (errors.length > 0) {
        maintenanceReport += "### Logged Failures:\n";
        errors.forEach((err) => {
          maintenanceReport += `- [${err.category}] ${err.message} (${err.created_at})\n`;
        });
      } else {
        maintenanceReport += "✅ No system or execution anomalies detected in the logs directory.\n";
      }

      // Run SkillOpt Trajectory Adapter
      const { SkillOptService } = require("./SkillOptService");
      const skillOpt = new SkillOptService();
      if (skillOpt.isEnvironmentReady()) {
        const optRes = await skillOpt.runAdapter();
        if (optRes.exitCode === 0) {
          maintenanceReport += "\n🤖 **SkillOpt Engine:** Trajectory optimization dataset generated successfully.\n";
        }
      }

      // If user triggered this manually or we have a active chat channel, write the report
      const reportPath = join(process.cwd(), ".agent", "devops_report.md");
      const Bun = (globalThis as any).Bun;
      await Bun.write(reportPath, maintenanceReport);

      if (manualChatId && this.onReminderTrigger) {
        await this.onReminderTrigger(
          manualChatId,
          `🛠️ **DevOps Audit Completed**\nReport saved to \`.agent/devops_report.md\`\n\n${maintenanceReport}`
        );
      }

      return maintenanceReport;
    } catch (err: any) {
      console.error("[Scheduler] DevOps maintenance check failed:", err.message);
      return `Error performing audit: ${err.message}`;
    } finally {
      await storage.close();
    }
  }
}

// Quick helper to resolve PG/Database loading in scheduler context
import pg from "pg";
import { Database } from "bun:sqlite";
import { join } from "path";
