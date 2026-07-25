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
      const storage = new StorageService();
      await storage.initialize();

      const prompt = `🚨 A crash was detected in worker '${workerName}'.
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

      const { join } = require("path");
      const { readFileSync, existsSync } = require("fs");
      const workerPath = join(process.cwd(), ".agent", "agents", "devops.md");
      if (!existsSync(workerPath)) {
         throw new Error("devops.md profile not found");
      }
      const workerMd = readFileSync(workerPath, "utf-8");
      
      const skillsSection = workerMd.match(/## Available Skills\r?\n([\s\S]*?)(?:\r?\n##|$)/i);
      const allowedSkills: string[] = [];
      if (skillsSection) {
         for (const line of skillsSection[1].split("\n")) {
            const m = line.match(/^[-*]\s+`?([a-zA-Z0-9_]+)`?/);
            if (m) allowedSkills.push(m[1].trim());
         }
      }

      const worker = new WorkerAgent("devops", workerMd, allowedSkills);
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
            if (item.cronExpression) {
              await this.onReminderTrigger(item.chatId, `⏰ **Recurring Reminder:** ${item.message}`);
              const { getNextCronDate } = require("../utils/cron");
              const nextDueAt = getNextCronDate(item.cronExpression, new Date());
              await storage.updateReminderDueAt(item.id!, nextDueAt);
              console.log(`[Scheduler] Rescheduled recurring reminder ${item.id} to ${nextDueAt.toISOString()}`);
            } else {
              await this.onReminderTrigger(item.chatId, `🔔 **Reminder:** ${item.message}`);
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
