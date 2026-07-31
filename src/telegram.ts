import { Bot } from "grammy";
import { Orchestrator } from "./core/Orchestrator";
import { SkillRegistry } from "./core/SkillRegistry";
import { Scheduler } from "./services/Scheduler";
import { TaskRegistry } from "./core/TaskRegistry";
import { StorageService } from "./database/Storage";
import { LlmService } from "./core/LlmService";
import { setTelegramNotifier } from "./core/NotifyBridge";
import { getGoogleAuthUrl } from "./core/googleAuth";
import { checkAndStoreBalance, getUsageSummary } from "./core/deepseekBalance";
import { join } from "path";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Edit a callback-query message safely:
 *  - always detaches the inline keyboard (so buttons can't be re-tapped after processing)
 *  - ignores Telegram's "message is not modified" 400 (double-taps / repeated callbacks)
 */
async function safeEditMessageText(ctx: any, text: string, opts: any = {}) {
  try {
    await ctx.editMessageText(text, {
      ...opts,
      reply_markup: opts.reply_markup ?? { inline_keyboard: [] },
    });
  } catch (err: any) {
    const msg = String(err?.message || err?.description || "");
    const isNotModified = err?.error_code === 400 && msg.includes("message is not modified");
    if (!isNotModified) throw err;
  }
}

function markdownToHtml(markdown: string): string {
  // 1. Escape HTML entities
  let html = escapeHtml(markdown);

  const placeholders: string[] = [];

  // 2. Code blocks: ```code``` -> <pre><code>code</code></pre>
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const lines = code.split("\n");
    if (lines.length > 0 && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
      lines.shift();
    }
    placeholders.push(`<pre><code>${lines.join("\n").trim()}</code></pre>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // 3. Inline code: `code` -> <code>code</code>
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    placeholders.push(`<code>${code}</code>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // 4. Links: [text](url) -> <a href="$2">$1</a> (Extract URLs to placeholders to protect from italic underscores)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    placeholders.push(url);
    return `<a href="@@@PLACEHOLDER${placeholders.length - 1}@@@">${text}</a>`;
  });

  // 5. Bold: **bold** -> <b>bold</b> (enforce non-space inner boundaries, no nested asterisks)
  html = html.replace(/(?<!\*)\*\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*\*(?!\*)/g, "<b>$1</b>");
 
  // 6. Italic: *italic* -> <i>italic</i> (enforce non-space boundaries to avoid matching bullet points)
  html = html.replace(/(?<!\*)\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*(?!\*)/g, "<i>$1</i>");
 
  // 7. Italic: _italic_ -> <i>italic</i>
  html = html.replace(/(?<!_)_(?!_)(?=\S)([\s\S]*?)(?<=\S)_(?!_)/g, "<i>$1</i>");
 
  // 8. Restore placeholders (use function replacement to avoid $ capturing issues)
  for (let i = 0; i < placeholders.length; i++) {
    html = html.replace(`@@@PLACEHOLDER${i}@@@`, () => placeholders[i]);
  }

  return html;
}

async function replySafe(ctx: any, text: string, options: any = {}) {
  const html = markdownToHtml(text);
  try {
    return await ctx.reply(html, { parse_mode: "HTML", ...options });
  } catch (err: any) {
    if (err.message && (err.message.includes("can't parse entities") || err.message.includes("XML"))) {
      console.warn("[Telegram] HTML parsing failed, falling back to plain text:", err.message);
      return await ctx.reply(text, { ...options, parse_mode: undefined });
    }
    throw err;
  }
}

async function sendMessageSafe(bot: Bot, chatId: string, text: string, options: any = {}) {
  const html = markdownToHtml(text);
  try {
    return await bot.api.sendMessage(chatId, html, { parse_mode: "HTML", ...options });
  } catch (err: any) {
    if (err.message && (err.message.includes("can't parse entities") || err.message.includes("XML"))) {
      console.warn("[Telegram] HTML parsing failed, falling back to plain text:", err.message);
      return await bot.api.sendMessage(chatId, text, { ...options, parse_mode: undefined });
    }
    throw err;
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN is not defined in the environment.");
    process.exit(1);
  }

  console.log("[Telegram] Initializing bot...");

  // Env audit: surfaces missing OAuth config in Railway logs immediately.
  console.log(
    `[Telegram] Env audit: TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN ? "set" : "MISSING"}, ` +
    `GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID ? "set" : "MISSING"}, ` +
    `GOOGLE_CLIENT_SECRET=${process.env.GOOGLE_CLIENT_SECRET ? "set" : "MISSING"}, ` +
    `WEBAPP_URL=${process.env.WEBAPP_URL || "MISSING (fallback http://localhost:3000)"}`
  );

  // 1. Initialize Skill Registry
  const registry = SkillRegistry.getInstance();
  await registry.initialize();
  console.log(`[Telegram] Loaded ${registry.getSkills().length} skills.`);

  const bot = new Bot(token);

  // Wire the global notification bridge so pollers/skills can push messages
  // (including interactive keyboards) to the user without a Bot reference.
  setTelegramNotifier(async (chatId, text, opts) => {
    await bot.api.sendMessage(chatId, text, opts);
  });

  // Set command menu in Telegram client
  await bot.api.setMyCommands([
    { command: "start", description: "Initialize the assistant" },
    { command: "owed", description: "Who owes you money (receivables)" },
    { command: "reimbursements", description: "Manage active reimbursements" },
    { command: "authorize", description: "Connect Gmail account via Google OAuth" },
    { command: "authorize_outlook", description: "Connect Outlook/Hotmail account via Microsoft OAuth" },
    { command: "reminders", description: "List and manage active reminders & cron tasks" },
    { command: "autolog", description: "Toggle automatic expense logging from emails (/autolog on|off)" },
    { command: "balance", description: "Check DeepSeek API balance & usage" },
    { command: "fixingtime", description: "DevOps error log audit & self-healing magic prompt" },
    { command: "cancel", description: "Stop active background tracking sessions" },
  ]).catch(err => console.error("[Telegram] Failed to set commands:", err.message));

  const orchestrator = new Orchestrator();
  const scheduler = new Scheduler();
  const storage = new StorageService();
  await storage.initialize();

  // 2. Start Scheduler (Secretary alert callback routes directly to Telegram Chat ID)
  scheduler.start(async (chatId, message) => {
    try {
      if (message.startsWith("[TASK]")) {
        const promptText = message.replace("[TASK]", "").trim();
        console.log(`[Scheduler] Executing scheduled task for ${chatId}: ${promptText}`);
        const response = await orchestrator.processMessage(chatId, promptText, undefined);
        await sendMessageSafe(bot, chatId, `📋 <b>Scheduled Task Completed:</b>\n\n${response}`);
      } else {
        await sendMessageSafe(bot, chatId, message);
      }
    } catch (err: any) {
      console.error(`[Telegram Scheduler Alert] Failed to send to ${chatId}:`, err.message);
    }
  });

  // 3. Register TaskRegistry Completion Hook to notify Telegram Chat ID
  TaskRegistry.getInstance().setCompletionCallback(
    async (taskId, chatId, description, success, resultOrError) => {
      try {
        let text = "";
        if (success) {
          text = `✅ **Task Completed!**\nTask ID: \`${taskId}\`\nDescription: ${description}\n\n*Output:*\n${resultOrError}`;
        } else if (String(resultOrError).includes("cancelled")) {
          text = `🛑 **Task Cancelled**\nTask ID: \`${taskId}\`\nDescription: ${description}`;
        } else {
          text = `❌ **Task Failed!**\nTask ID: \`${taskId}\`\nDescription: ${description}\n\n*Error:*\n${resultOrError}`;
        }
        await sendMessageSafe(bot, chatId, text);
      } catch (err: any) {
        console.error(`[Telegram Task Callback] Failed to alert ${chatId}:`, err.message);
      }
    }
  );

  // Register mid-task update callback (used by polling tasks like trackBus to push live messages)
  TaskRegistry.getInstance().setUpdateCallback(async (chatId, message) => {
    try {
      await sendMessageSafe(bot, chatId, message);
    } catch (err: any) {
      console.error(`[Telegram Task Update] Failed to send live update to ${chatId}:`, err.message);
    }
  });

  function getWebAppUrl(chatId: string): string {
    if (process.env.WEBAPP_URL) {
      const base = process.env.WEBAPP_URL.endsWith("/") 
        ? process.env.WEBAPP_URL.slice(0, -1) 
        : process.env.WEBAPP_URL;
      return `${base}?chatId=${chatId}`;
    }
    const domain = process.env.RAILWAY_STATIC_URL;
    if (domain) {
      return `https://${domain}?chatId=${chatId}`;
    }
    return `http://localhost:3000?chatId=${chatId}`;
  }

  // 4a. Handle /cancel and /stop commands to stop running tracking sessions
  bot.on("message", async (ctx, next) => {
    const text = (ctx.message.text || "").trim();
    const threadId = ctx.message.message_thread_id;
    const chatId = String(ctx.chat.id);

    if (text === "/cancel" || text.startsWith("/cancel ") || text === "/stop" || text.startsWith("/stop ")) {
      const parts = text.split(" ");
      const taskId = parts.length > 1 ? parts[1].trim() : null;
      if (taskId && taskId.startsWith("task_")) {
        const cancelled = await TaskRegistry.getInstance().cancelTask(taskId);
        if (cancelled) {
          await ctx.reply(`✅ Tracking session <code>${taskId}</code> has been stopped.`, { parse_mode: "HTML", message_thread_id: threadId });
        } else {
          await ctx.reply(`⚠️ No active task found with ID <code>${taskId}</code>.`, { parse_mode: "HTML", message_thread_id: threadId });
        }
      } else {
        const cancelledIds = await TaskRegistry.getInstance().cancelTasksForChat(chatId);
        if (cancelledIds.length > 0) {
          await ctx.reply(`🛑 Stopped tracking! Cancelled task(s): ${cancelledIds.map((id) => `<code>${id}</code>`).join(", ")}`, { parse_mode: "HTML", message_thread_id: threadId });
        } else {
          await ctx.reply(`ℹ️ No active tracking or background tasks running.`, { message_thread_id: threadId });
        }
      }
      return; 
    }

    if (text === "/reminders" || text === "/list_reminders") {
      const storage = new StorageService();
      await storage.initialize();
      const reminders = await storage.getUserReminders(chatId);
      await storage.close();

      if (reminders.length === 0) {
        await ctx.reply("⏰ You have no active or scheduled reminders.", { message_thread_id: threadId });
        return;
      }

      const inlineKeyboard: any[] = [];
      const lines = reminders.map((r) => {
        const type = r.cronExpression ? `🔄 Cron <code>${escapeHtml(r.cronExpression)}</code>` : `📅 One-shot`;
        const timeStr = r.dueAt ? r.dueAt.toLocaleString() : "Pending";
        inlineKeyboard.push([{ text: `❌ Delete: ${r.message.slice(0, 24)}`, callback_data: `action:delete_reminder:${r.id}` }]);
        return `• [${type}] <b>${escapeHtml(r.message)}</b>\n  ⏱️ Next due: <code>${escapeHtml(timeStr)}</code>`;
      });

      await ctx.reply(`⏰ <b>Your Active Reminders:</b>\n\n${lines.join("\n\n")}`, {
        parse_mode: "HTML",
        message_thread_id: threadId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
      return;
    }

    if (text === "/owed" || text === "/reimbursements") {
      const storage = new StorageService();
      await storage.initialize();
      const pending = await storage.getPendingReimbursements(chatId);
      await storage.close();

      if (pending.length === 0) {
        await ctx.reply("🎉 No pending reimbursements! All group debts are settled.", { message_thread_id: threadId });
        return;
      }

      const inlineKeyboard: any[] = [];
      let totalOwed = 0;
      const lines = pending.map((r) => {
        totalOwed += r.amount;
        inlineKeyboard.push([{ text: `✅ Settled: ${r.debtorName} ($${r.amount.toFixed(2)})`, callback_data: `action:settle_reimbursement:${r.id}` }]);
        return `• 👤 <b>${escapeHtml(r.debtorName)}</b> owes <code>SGD ${r.amount.toFixed(2)}</code> for <i>${escapeHtml(r.description)}</i>`;
      });

      await ctx.reply(`💸 <b>Pending Receivables (Total: SGD ${totalOwed.toFixed(2)}):</b>\n\n${lines.join("\n\n")}`, {
        parse_mode: "HTML",
        message_thread_id: threadId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
      return;
    }


    if (text === "/set_devops_thread") {
      if (threadId) {
        const storage = new StorageService();
        await storage.initialize();
        await storage.setProfileValue("DEVOPS_THREAD_ID", threadId);
        await storage.close();
        await ctx.reply(`✅ This thread has been set as the global DevOps Sandbox.`, { message_thread_id: threadId });
      } else {
        await ctx.reply(`⚠️ You must run this inside a topic thread.`);
      }
      return;
    }

    if (text === "/set_pm_thread") {
      if (threadId) {
        const storage = new StorageService();
        await storage.initialize();
        await storage.setProfileValue("PM_THREAD_ID", threadId);
        await storage.close();
        await ctx.reply(`✅ This thread has been set as the global Bugs and Improvements PM topic.`, { message_thread_id: threadId });
      } else {
        await ctx.reply(`⚠️ You must run this inside a topic thread.`);
      }
      return;
    }

    if (text === "/set_finance_thread") {
      if (threadId) {
        const storage = new StorageService();
        await storage.initialize();
        await storage.setProfileValue("FINANCE_THREAD_ID", threadId);
        await storage.close();
        await ctx.reply(`✅ This thread has been set as the Finance topic for expense polling alerts.`, { message_thread_id: threadId });
      } else {
        await ctx.reply(`⚠️ You must run this inside a topic thread.`);
      }
      return;
    }

    if (text === "/autolog" || text.startsWith("/autolog ")) {
      const storage = new StorageService();
      await storage.initialize();
      const arg = text.replace("/autolog", "").trim().toLowerCase();

      if (arg === "on" || arg === "true" || arg === "yes" || arg === "1") {
        await storage.setProfileValue("AUTO_LOG_EXPENSES", true);
        await storage.close();
        await ctx.reply(`✅ <b>Auto-log enabled.</b>\n\nDetected payment/receipt emails will now be written to your expense database automatically.`, {
          parse_mode: "HTML",
          message_thread_id: threadId,
        });
      } else if (arg === "off" || arg === "false" || arg === "no" || arg === "0") {
        await storage.setProfileValue("AUTO_LOG_EXPENSES", false);
        await storage.close();
        await ctx.reply(`✅ <b>Auto-log disabled.</b>\n\nDetected payments will ask for your confirmation (Yes / Discard / Edit) before logging.`, {
          parse_mode: "HTML",
          message_thread_id: threadId,
        });
      } else {
        const current = await storage.getProfileValue("AUTO_LOG_EXPENSES");
        await storage.close();
        const state = current === true || current === "true";
        await ctx.reply(
          state
            ? `🟢 <b>Auto-log is ON.</b>\n\nPayment emails are logged automatically. Use <code>/autolog off</code> to require confirmation.`
            : `⚪️ <b>Auto-log is OFF.</b>\n\nYou confirm each detected payment before it's logged. Use <code>/autolog on</code> to log automatically.`,
          { parse_mode: "HTML", message_thread_id: threadId }
        );
      }
      return;
    }

    if (text === "/balance" || text.startsWith("/balance ")) {
      const args = text.replace("/balance", "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const sub = args[0] || "balance";
      const num = parseInt(args[1] || "", 10);

      try {
        if (sub === "usage") {
          const days = !isNaN(num) && num > 0 ? num : 30;
          const summary = await getUsageSummary("deepseek", days);
          await ctx.reply(
            `📊 <b>DeepSeek Usage (last ${summary.days} days)</b>\n` +
              `• Calls: <code>${summary.count}</code>\n` +
              `• Prompt tokens: <code>${summary.promptTokens.toLocaleString()}</code>\n` +
              `• Completion tokens: <code>${summary.completionTokens.toLocaleString()}</code>\n` +
              `• Total tokens: <code>${summary.totalTokens.toLocaleString()}</code>\n` +
              `• Est. cost: <b>USD ${summary.estimatedCostUsd.toFixed(4)}</b>`,
            { parse_mode: "HTML", message_thread_id: threadId }
          );
        } else if (sub === "history") {
          const storage = new StorageService();
          await storage.initialize();
          const snaps = await storage.getBalanceSnapshots(isNaN(num) || num <= 0 ? 10 : Math.min(num, 50));
          await storage.close();
          if (snaps.length === 0) {
            await ctx.reply("No balance snapshots recorded yet. Try <code>/balance</code> first.", { parse_mode: "HTML", message_thread_id: threadId });
          } else {
            await ctx.reply(
              `📈 <b>Recent Balance Snapshots</b>\n` +
                snaps
                  .map(
                    (s) =>
                      `• <code>${s.currency}</code> <b>${s.totalBalance.toFixed(2)}</b> — ${new Date(s.createdAt!).toISOString()}${s.isAvailable ? "" : " ⚠️ unavailable"}`
                  )
                  .join("\n"),
              { parse_mode: "HTML", message_thread_id: threadId }
            );
          }
        } else {
          const result = await checkAndStoreBalance();
          const lines = result.balances.map(
            (b) => `• <code>${b.currency}</code> <b>${b.totalBalance.toFixed(2)}</b> (granted: ${b.grantedBalance.toFixed(2)}, topped up: ${b.toppedUpBalance.toFixed(2)})`
          );
          const availability = result.isAvailable ? "🟢 available" : "🔴 NOT available";
          await ctx.reply(
            `💳 <b>DeepSeek Balance</b> (as of ${new Date(result.fetchedAt).toISOString()})\n` +
              lines.join("\n") +
              `\n\nStatus: ${availability}\n\n<i>Usage: /balance usage [days] | /balance history</i>`,
            { parse_mode: "HTML", message_thread_id: threadId }
          );
        }
      } catch (err: any) {
        await ctx.reply(`❌ Failed to check DeepSeek: ${err.message}`, { message_thread_id: threadId });
      }
      return;
    }

    if (text === "/authorize" || text === "/authorize_gmail" || text === "/gmail_auth" || text === "/connect_gmail") {
      const clientId = process.env.GOOGLE_CLIENT_ID || "";
      if (!clientId) {
        await ctx.reply("⚠️ <code>GOOGLE_CLIENT_ID</code> is not defined in the environment.", { parse_mode: "HTML", message_thread_id: threadId });
        return;
      }

      const authUrl = getGoogleAuthUrl(chatId);
      const redirectUri = new URL(authUrl).searchParams.get("redirect_uri");
      console.log(`[Telegram] /authorize for chat ${chatId} -> ${authUrl}`);

      let warning = "";
      if (!process.env.GOOGLE_CLIENT_SECRET) {
        warning = `\n\n⚠️ <code>GOOGLE_CLIENT_SECRET</code> is not set in the environment — the callback will fail to exchange the code.`;
      }

      await ctx.reply(
        `🔗 <b>Authorize Google Access</b>\n\nClick the button below to grant Nexus access to your Gmail and Calendar:\n\nRedirect URI used: <code>${redirectUri}</code>${warning}`,
        {
          parse_mode: "HTML",
          message_thread_id: threadId,
          reply_markup: {
            inline_keyboard: [[{ text: "🔑 Authorize Google Account", url: authUrl }]]
          }
        }
      );
      return;
    }

    if (text === "/authorize_outlook" || text === "/authorize_microsoft" || text === "/outlook_auth") {
      const port = process.env.PORT || 3000;
      const webappUrl = process.env.WEBAPP_URL || `http://localhost:${port}`;
      const base = webappUrl.endsWith("/") ? webappUrl.slice(0, -1) : webappUrl;
      const redirectUri = `${base}/api/oauth/microsoft/callback`;
      const clientId = process.env.MICROSOFT_CLIENT_ID || "";

      if (!clientId) {
        await ctx.reply("⚠️ <code>MICROSOFT_CLIENT_ID</code> is not defined in the environment.", { parse_mode: "HTML", message_thread_id: threadId });
        return;
      }

      const scopes = encodeURIComponent("https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite offline_access");
      const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scopes}&state=${chatId}`;

      await ctx.reply(`🔗 <b>Authorize Microsoft / Outlook Access</b>\n\nClick the button below to grant Nexus access to read your Outlook/Hotmail emails:`, {
        parse_mode: "HTML",
        message_thread_id: threadId,
        reply_markup: {
          inline_keyboard: [[{ text: "🔑 Authorize Outlook Account", url: authUrl }]]
        }
      });
      return;
    }

    if (text.includes("🚨 **MANUAL_BUG_REPORT**")) {
       const storage = new StorageService();
       await storage.initialize();
       await storage.logEpisodicMemory(chatId, "crash_telemetry", text);
       await storage.close();
       await ctx.reply("✅ Bug report intercepted and logged for DevOps analysis.", { message_thread_id: threadId });
       return;
    }

    return next();
  });

  // 4. Handle incoming messages (text, photos, voice notes)
  bot.on("message", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const text = (ctx.message.text || ctx.message.caption || "").trim();

    // Check for /fixingtime
    if (text === "/fixingtime") {
      await ctx.replyWithChatAction("typing");
      try {
        const logs = await storage.getLogsPastHours(24);
        if (logs.length === 0) {
          await ctx.reply("No errors or improvements logged in the last 24 hours. Great job!");
          return;
        }

        const logContext = logs.map(l => `[${l.category}] ${l.message}\nDetails: ${l.details || "None"}`).join("\n---\n");
        const promptText = `
You are a Staff Software Engineer handing off work. The user uses an advanced AI coding assistant (Antigravity) locally.
Your job is to generate a comprehensive summary of the errors and improvements logged today, followed by a "Solid Prompt" that the user can copy and paste directly into their local Antigravity IDE.
The solid prompt should instruct the local AI to fix the specific errors and implement the requested improvements in their codebase. Keep the prompt extremely detailed so the AI knows exactly what to do.

Here are the raw logs from the past 24 hours:
${logContext}

Output format MUST be EXACTLY:
1. **Summary of Issues** (bullet points)
2. **Requested Features** (bullet points)
3. **The Magic Prompt** (Put the actual prompt text inside a standard markdown code block so the user can click to copy it)
`;

        const llm = new LlmService();
        const llmReply = await llm.generateResponse([{ role: "user", content: promptText }]);

        await replySafe(ctx, llmReply);

        // Mark logs as resolved so they don't appear in future /fixingtime calls
        const logIds = logs.map(l => l.id);
        await storage.markLogsResolved(logIds);
      } catch (err: any) {
        await ctx.reply(`❌ Failed to generate fixing time summary: ${err.message}`);
      }
      return;
    }

    // Check if the user is asking to open the dashboard/expenses/notes
    const isExpenses = text.startsWith("/expenses") || text.toLowerCase().includes("show expense") || text.toLowerCase().includes("expense dashboard");
    const isNotes = text.startsWith("/notes") || text.toLowerCase().includes("show note") || text.toLowerCase().includes("notes library");

    if (isExpenses) {
      const url = getWebAppUrl(chatId);
      const isHttps = url.startsWith("https://");
      const threadId = ctx.message.message_thread_id;
      
      if (isHttps) {
        await ctx.reply("Here is your <b>Personal Expense Tracker</b> dashboard:", {
          parse_mode: "HTML",
          message_thread_id: threadId,
          reply_markup: {
            inline_keyboard: [[
              { text: "📊 Open Expense Dashboard", url: url }
            ]]
          }
        });
      } else {
        await ctx.reply(`Here is your <b>Personal Expense Tracker</b> dashboard link:\n\n<a href="${url}">📊 Open Expense Dashboard</a>\n\n(Local testing link: <code>${url}</code>)`, {
          parse_mode: "HTML",
          message_thread_id: threadId
        });
      }
      return;
    }

    if (isNotes) {
      const url = `${getWebAppUrl(chatId)}&tab=notes`;
      const isHttps = url.startsWith("https://");
      const threadId = ctx.message.message_thread_id;
      
      if (isHttps) {
        await ctx.reply("Here is your <b>Research Notes</b> library:", {
          parse_mode: "HTML",
          message_thread_id: threadId,
          reply_markup: {
            inline_keyboard: [[
              { text: "📝 Open Research Notes", url: url }
            ]]
          }
        });
      } else {
        await ctx.reply(`Here is your <b>Research Notes</b> library link:\n\n<a href="${url}">📝 Open Research Notes</a>\n\n(Local testing link: <code>${url}</code>)`, {
          parse_mode: "HTML",
          message_thread_id: threadId
        });
      }
      return;
    }

    // Resolve voice, photo, or audio attachments
    let media: any[] | undefined = undefined;

    if (ctx.message.photo) {
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest resolution
        const file = await ctx.api.getFile(photo.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buffer = await res.arrayBuffer();
          media = [{
            mimeType: "image/jpeg",
            data: Buffer.from(buffer).toString("base64")
          }];
        }
      } catch (err) {
        console.error("[Telegram Media Fetch Error] Photo:", err);
      }
    } else if (ctx.message.voice) {
      try {
        const voice = ctx.message.voice;
        const file = await ctx.api.getFile(voice.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buffer = await res.arrayBuffer();
          media = [{
            mimeType: voice.mime_type || "audio/ogg",
            data: Buffer.from(buffer).toString("base64")
          }];
        }
      } catch (err) {
        console.error("[Telegram Media Fetch Error] Voice:", err);
      }
    } else if (ctx.message.audio) {
      try {
        const audio = ctx.message.audio;
        const file = await ctx.api.getFile(audio.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buffer = await res.arrayBuffer();
          media = [{
            mimeType: audio.mime_type || "audio/mpeg",
            data: Buffer.from(buffer).toString("base64")
          }];
        }
      } catch (err) {
        console.error("[Telegram Media Fetch Error] Audio:", err);
      }
    }

    if (!text && !media) {
      return; // Ignore empty / unsupported types
    }

    // Send typing action to Telegram
    await ctx.replyWithChatAction("typing");

    try {
      const threadId = ctx.message.message_thread_id;
      
      const storage = new StorageService();
      await storage.initialize();
      const activeEditId = await storage.getProfileValue(`ACTIVE_PENDING_EXPENSE_ID_${chatId}`);
      let processedText = text;
      
      if (activeEditId) {
        const pending = await storage.getPendingExpense(Number(activeEditId));
        if (pending) {
          processedText = `[CONTEXT: The user is completing or editing the pending expense ID ${activeEditId}. Currently, the database has:
- Amount: ${pending.amount || "missing"}
- Description: "${pending.description || "missing"}"
- Category: "${pending.category || "missing"}"
- Payment Mode: "${pending.paymentMode || "missing"}"

The user says: "${text}".
Please update the missing or changed values and save this expense to the database. After saving, notify the user that the expense has been logged successfully.]\n\n${text}`;
        }
        await storage.setProfileValue(`ACTIVE_PENDING_EXPENSE_ID_${chatId}`, null);
      }
      await storage.close();

      const response = await orchestrator.processMessage(chatId, processedText, media, threadId);
      await replySafe(ctx, response, { message_thread_id: threadId });
    } catch (err: any) {
      const threadId = ctx.message.message_thread_id;
      console.error(`[Telegram Message Error] Chat: ${chatId}`, err);
      
      if (err.message && err.message.startsWith("WorkerCrash::")) {
         const parts = err.message.split("::");
         const devopsThreadId = parts[1];
         const workerName = parts[2];
         const lastInput = parts[3];
         const stackTrace = parts[4];
         
         const payload = `🚨 **Crash Detected in ${workerName}**\n\n**Input:** ${lastInput}\n\n**Trace:**\n<code>${escapeHtml(stackTrace.substring(0, 500))}...</code>`;
         
         if (devopsThreadId) {
             await sendMessageSafe(bot, chatId, payload, {
                 parse_mode: "HTML",
                 message_thread_id: Number(devopsThreadId),
                 reply_markup: {
                     inline_keyboard: [[
                         { text: "🛠️ Auto-Repair (DevOps)", callback_data: `action:autorepair:${workerName}` }
                     ]]
                 }
             });
         }
         
         const storage = new StorageService();
         await storage.initialize();
         try {
             await storage.logEvent({
                 category: `WORKER_CRASH_${workerName.toUpperCase()}`,
                 message: `WorkerCrash in ${workerName}: ${lastInput}`,
                 details: stackTrace,
                 isError: true,
             });
         } catch (logErr) {
             console.error("[Telegram] Failed to log WorkerCrash to DB:", logErr);
         }
         
         const pmThreadId = await storage.getProfileValue("PM_THREAD_ID");
         await storage.close();
         
         if (pmThreadId && pmThreadId !== devopsThreadId) {
             await sendMessageSafe(bot, chatId, `🚨 **Bug Report (Crash):**\n\nWorker: ${workerName}\nInput: ${lastInput}\n\nTrace:\n<code>${escapeHtml(stackTrace.substring(0, 500))}...</code>`, {
                 parse_mode: "HTML",
                 message_thread_id: Number(pmThreadId)
             });
         }
         
         await ctx.reply("❌ An unexpected error occurred. The DevOps team has been notified.", { message_thread_id: threadId });
         return;
      }
      
      try {
        await storage.logEvent({
          category: "TELEGRAM_MESSAGE_ERROR",
          message: err.message,
          details: err.stack || JSON.stringify(err),
          isError: true
        });
      } catch (dbErr) {
        console.error("Failed to log error to DB:", dbErr);
      }
      await ctx.reply(`❌ An execution error occurred: ${err.message}`, { message_thread_id: threadId });
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith("action:autorepair:")) {
       await ctx.answerCallbackQuery({ text: "Spawning DevOps Agent..." });
       const workerName = data.split(":")[2];
       if (scheduler.triggerAutoRepair) {
           scheduler.triggerAutoRepair(String(ctx.chat?.id), ctx.callbackQuery.message?.message_thread_id, workerName, bot);
       }
    } else if (data.startsWith("action:approve_patch:")) {
       await ctx.answerCallbackQuery({ text: "Applying patch..." });
       const skillName = data.split(":")[2];
       
       const storage = new StorageService();
       await storage.initialize();
       const pendingPatch = await storage.getProfileValue(`PATCH_PENDING_${skillName}`);
       if (pendingPatch) {
          const { code, description, paramSchema } = pendingPatch;
          await storage.insertSkill(skillName, description, paramSchema, code);
          const registry = SkillRegistry.getInstance();
          await registry.reload();
          await safeEditMessageText(ctx, `✅ Patch applied successfully for skill: ${skillName}. Registry reloaded.`, { parse_mode: "HTML" });
          await storage.setProfileValue(`PATCH_PENDING_${skillName}`, null);
       } else {
          await ctx.reply("⚠️ Patch data not found or expired.");
       }
    } else if (data.startsWith("action:approve_skillopt:")) {
       await ctx.answerCallbackQuery({ text: "Applying SkillOpt optimization..." });
       const skillName = data.split(":")[2];
       const storage = new StorageService();
       await storage.initialize();
       const pendingOpt = await storage.getProfileValue(`SKILLOPT_PENDING_${skillName}`);
       if (pendingOpt) {
          const { optimizedPrompt } = pendingOpt;
          const skillPath = join(process.cwd(), ".agent", "skills", skillName, "SKILL.md");
          await Bun.write(skillPath, optimizedPrompt);
          const registry = SkillRegistry.getInstance();
          await registry.reload();
          await safeEditMessageText(ctx, `🤖 ✅ <b>SkillOpt Prompt Updated:</b> <code>${skillName}</code>. SkillRegistry reloaded.`, { parse_mode: "HTML" });
          await storage.setProfileValue(`SKILLOPT_PENDING_${skillName}`, null);
       } else {
          await ctx.reply("⚠️ SkillOpt optimization data not found or expired.");
       }
       await storage.close();
    } else if (data.startsWith("action:settle_reimbursement:")) {
       const id = parseInt(data.replace("action:settle_reimbursement:", ""));
       await ctx.answerCallbackQuery({ text: "Marking settled..." });
       const storage = new StorageService();
       await storage.initialize();
       const settled = await storage.settleReimbursement(id);
       await storage.close();
       if (settled) {
          await safeEditMessageText(ctx, "🎉 <b>Debt marked as settled!</b>", { parse_mode: "HTML" });
       } else {
          await ctx.reply("⚠️ Reimbursement not found or already settled.");
       }
    } else if (data.startsWith("action:delete_reminder:")) {
       const reminderId = parseInt(data.replace("action:delete_reminder:", ""));
       await ctx.answerCallbackQuery({ text: "Deleting reminder..." });
       const storage = new StorageService();
       await storage.initialize();
       const deleted = await storage.deleteReminder(reminderId);
       await storage.close();
       if (deleted) {
          await safeEditMessageText(ctx, "✅ <b>Reminder deleted successfully.</b>", { parse_mode: "HTML" });
       } else {
          await ctx.reply("⚠️ Reminder not found or already deleted.");
       }
    } else if (data.startsWith("log_yes:")) {
      const pendingId = parseInt(data.split(":")[1]);
      await ctx.answerCallbackQuery({ text: "Logging expense..." });
      
      const storage = new StorageService();
      await storage.initialize();
      const pending = await storage.getPendingExpense(pendingId);
      if (pending) {
        if (pending.amount === null || !pending.description || !pending.category) {
          await ctx.reply("⚠️ Cannot log expense, missing required fields. Please edit details.");
        } else {
          await storage.createExpense({
            chatId: pending.chatId,
            amount: pending.amount,
            category: pending.category,
            description: pending.description,
            createdAt: pending.createdAt
          });
          await storage.deletePendingExpense(pendingId);
          await safeEditMessageText(
            ctx,
            (ctx.callbackQuery.message?.text || "Receipt") + `\n\n✅ **Logged to Database!**`,
            { parse_mode: "Markdown" }
          );
        }
      } else {
        await safeEditMessageText(
          ctx,
          (ctx.callbackQuery.message?.text || "Receipt") + `\n\n⚠️ This receipt was already processed.`,
          { parse_mode: "Markdown" }
        );
      }
      await storage.close();
    } else if (data.startsWith("log_no:")) {
      const pendingId = parseInt(data.split(":")[1]);
      await ctx.answerCallbackQuery({ text: "Discarding expense..." });
      
      const storage = new StorageService();
      await storage.initialize();
      const pending = await storage.getPendingExpense(pendingId);
      if (pending) {
        await storage.deletePendingExpense(pendingId);
        await safeEditMessageText(
          ctx,
          (ctx.callbackQuery.message?.text || "Receipt") + `\n\n❌ **Discarded!**`,
          { parse_mode: "Markdown" }
        );
      } else {
        await safeEditMessageText(
          ctx,
          (ctx.callbackQuery.message?.text || "Receipt") + `\n\n⚠️ This receipt was already processed.`,
          { parse_mode: "Markdown" }
        );
      }
      await storage.close();
    } else if (data.startsWith("log_edit:")) {
      const pendingId = parseInt(data.split(":")[1]);
      await ctx.answerCallbackQuery({ text: "Preparing edit..." });

      const storage = new StorageService();
      await storage.initialize();
      await storage.setProfileValue(`ACTIVE_PENDING_EXPENSE_ID_${chatId}`, pendingId);
      
      const pending = await storage.getPendingExpense(pendingId);
      const desc = pending?.description || "this receipt";
      await storage.close();

      await ctx.reply(`✏️ **Editing Expense:** "${desc}"\n\nPlease send me the updated or missing details (e.g. "it was $15.50" or "McDonalds"). I will update and log it!`, {
        reply_markup: { force_reply: true }
      });
    }
  });

  // 5. Global error handler
  bot.catch(async (err) => {
    console.error("[Telegram Global Bot Error]", err.error);
    try {
      const storage = new StorageService();
      await storage.initialize();
      const errorObj = err.error instanceof Error ? err.error : new Error(String(err.error));
      await storage.logEvent({
        category: "TELEGRAM_GLOBAL_ERROR",
        message: errorObj.message,
        details: errorObj.stack || JSON.stringify(err.error),
        isError: true
      });
      const pmThreadId = await storage.getProfileValue("PM_THREAD_ID");
      if (pmThreadId) {
          // Attempt to extract chatId from ctx, default to log failure if unavailable
          const chatId = err.ctx.chat?.id;
          if (chatId) {
              await sendMessageSafe(bot, chatId, `🚨 **Global Bot Error:**\n\nMessage: ${errorObj.message}\n\nTrace:\n<code>${escapeHtml((errorObj.stack || "").substring(0, 500))}...</code>`, {
                  message_thread_id: Number(pmThreadId)
              });
          }
      }
      await storage.close();
    } catch (dbErr) {
      console.error("Failed to log global error to DB:", dbErr);
    }
  });

  // 6. Start Web Server using Bun.serve
  const port = process.env.PORT || 3000;
  Bun.serve({
    port: Number(port),
    async fetch(req: Request) {
      const url = new URL(req.url);
      const storage = new StorageService();

      try {
        await storage.initialize();

        // 1. GET /api/expenses?chatId=...
        if (url.pathname === "/api/expenses" && req.method === "GET") {
          const chatId = url.searchParams.get("chatId");
          if (!chatId) return new Response("Missing chatId", { status: 400 });
          const expenses = await storage.getExpenses(chatId);
          return Response.json(expenses);
        }

        // 2. POST /api/expenses
        if (url.pathname === "/api/expenses" && req.method === "POST") {
          const body = await req.json() as any;
          if (!body.chatId || !body.amount || !body.category || !body.description) {
            return new Response("Missing fields", { status: 400 });
          }
          const id = await storage.createExpense({
            chatId: body.chatId,
            amount: Number(body.amount),
            category: body.category,
            description: body.description,
            createdAt: body.date,
          });
          return Response.json({ success: true, id });
        }

        // 3. POST /api/expenses/delete
        if (url.pathname === "/api/expenses/delete" && req.method === "POST") {
          const body = await req.json() as any;
          if (!body.id || !body.chatId) {
            return new Response("Missing fields", { status: 400 });
          }
          await storage.deleteExpense(Number(body.id), body.chatId);
          return Response.json({ success: true });
        }

        // 4. GET /api/notes?chatId=...
        if (url.pathname === "/api/notes" && req.method === "GET") {
          const chatId = url.searchParams.get("chatId");
          if (!chatId) return new Response("Missing chatId", { status: 400 });
          const notes = await storage.getResearchNotes(chatId);
          return Response.json(notes);
        }

        // 5. POST /api/notes
        if (url.pathname === "/api/notes" && req.method === "POST") {
          const body = await req.json() as any;
          if (!body.chatId || !body.title || !body.content) {
            return new Response("Missing fields", { status: 400 });
          }
          const id = await storage.createResearchNote({
            chatId: body.chatId,
            title: body.title,
            content: body.content,
          });
          return Response.json({ success: true, id });
        }

        // 6. POST /api/notes/delete
        if (url.pathname === "/api/notes/delete" && req.method === "POST") {
          const body = await req.json() as any;
          if (!body.id || !body.chatId) {
            return new Response("Missing fields", { status: 400 });
          }
          await storage.deleteResearchNote(Number(body.id), body.chatId);
          return Response.json({ success: true });
        }

        // 7. GET /api/oauth/debug — environment diagnostic (no secrets leaked)
        if (url.pathname === "/api/oauth/debug" && req.method === "GET") {
          return Response.json({
            ok: true,
            requestHost: url.host,
            requestProtocol: url.protocol,
            googClientId: process.env.GOOGLE_CLIENT_ID ? "set" : "MISSING",
            googClientSecret: process.env.GOOGLE_CLIENT_SECRET ? "set" : "MISSING",
            webappUrl: process.env.WEBAPP_URL || "MISSING",
            expectedCallbackPath: "/api/oauth/callback",
          });
        }

        // 8. GET /api/oauth/callback
        if (url.pathname === "/api/oauth/callback" && req.method === "GET") {
          const code = url.searchParams.get("code");
          const chatId = url.searchParams.get("state");
          if (!code || !chatId) {
            return new Response("Missing code or state", { status: 400 });
          }

          // Exchange code for tokens. Prefer WEBAPP_URL, but fall back to the
          // actual request origin so the exchange always matches what Google called.
          const webappUrl = process.env.WEBAPP_URL || `${url.protocol}//${url.host}`;
          const base = webappUrl.endsWith("/") ? webappUrl.slice(0, -1) : webappUrl;
          const redirectUri = `${base}/api/oauth/callback`;

          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: process.env.GOOGLE_CLIENT_ID || "",
              client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
              redirect_uri: redirectUri,
              grant_type: "authorization_code"
            })
          });

          if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error(`[Google OAuth] Token exchange failed for chat ${chatId}: ${err}`);
            return new Response(`Failed to exchange Google OAuth token: ${err}`, { status: 500 });
          }

          const tokens = await tokenRes.json() as any;

          // Preserve existing refresh_token if Google does not return a new one on re-auth
          let refresh = tokens.refresh_token;
          if (!refresh) {
            const existing = await storage.getGoogleCredentials(chatId);
            if (existing) refresh = existing.refresh_token;
          }

          await storage.saveGoogleCredentials(chatId, {
            access_token: tokens.access_token,
            refresh_token: refresh || "",
            expiry_date: Date.now() + (tokens.expires_in * 1000)
          });
          console.log(`[Google OAuth] Successfully saved credentials for chat ${chatId} (has refresh: ${!!refresh}).`);

          return new Response(`
            <html>
              <head>
                <title>Authentication Successful</title>
                <style>
                  body {
                    background-color: #121214;
                    color: #ffffff;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                  }
                  .card {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 40px;
                    border-radius: 16px;
                    text-align: center;
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
                    max-width: 400px;
                  }
                  h1 { color: #4caf50; margin-bottom: 10px; font-size: 24px; }
                  p { color: #b3b3b3; font-size: 16px; line-height: 1.5; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>✓ Authenticated successfully!</h1>
                  <p>Nexus has been granted Google access. You can now safely close this window and return to your Telegram chat.</p>
                </div>
              </body>
            </html>
          `, { headers: { "Content-Type": "text/html" } });
        }

        if (url.pathname === "/api/oauth/microsoft/callback") {
          const errorParam = url.searchParams.get("error");
          const errorDesc = url.searchParams.get("error_description");
          if (errorParam) {
            console.error(`[Microsoft OAuth Error] ${errorParam}: ${errorDesc}`);
            return new Response(`Microsoft OAuth Error: ${errorParam}\nDetails: ${errorDesc}`, { status: 400 });
          }

          const code = url.searchParams.get("code");
          const chatId = url.searchParams.get("state");

          if (!code || !chatId) {
            return new Response(`Missing code or state parameters. Received params: ${url.search}`, { status: 400 });
          }

          const webappUrl = process.env.WEBAPP_URL || `http://localhost:${port}`;
          const base = webappUrl.endsWith("/") ? webappUrl.slice(0, -1) : webappUrl;
          const redirectUri = `${base}/api/oauth/microsoft/callback`;

          const tokenRes = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.MICROSOFT_CLIENT_ID || "",
              client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
              code,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
          });

          if (!tokenRes.ok) {
            const err = await tokenRes.text();
            return new Response(`Failed to exchange Microsoft OAuth token: ${err}`, { status: 500 });
          }

          const tokens = (await tokenRes.json()) as any;
          let refresh = tokens.refresh_token;
          if (!refresh) {
            const existing = await storage.getMicrosoftCredentials(chatId);
            if (existing) refresh = existing.refresh_token;
          }

          await storage.saveMicrosoftCredentials(chatId, {
            access_token: tokens.access_token,
            refresh_token: refresh || "",
            expiry_date: Date.now() + tokens.expires_in * 1000,
          });

          return new Response(`
            <html>
              <head>
                <title>Outlook Authentication Successful</title>
                <style>
                  body { background-color: #121214; color: #ffffff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                  .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 16px; text-align: center; }
                  h1 { color: #4caf50; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>✓ Outlook Authenticated Successfully!</h1>
                  <p>Nexus has been granted Outlook/Hotmail access. You can now close this window and return to Telegram.</p>
                </div>
              </body>
            </html>
          `, { headers: { "Content-Type": "text/html" } });
        }

        // 8. Serve Static Files
        let filePath = url.pathname;
        if (filePath === "/") filePath = "/index.html";
        const publicPath = join(process.cwd(), "src", "public", filePath);
        const file = Bun.file(publicPath);
        if (await file.exists()) {
          // Generated pages under /pages/* get a CSP scoped to their own needs (inline
          // styles/scripts, Google Fonts, Unsplash/Picsum images) - left off the real
          // dashboard (index.html/app.js/style.css/api routes) so it stays unaffected.
          if (filePath.startsWith("/pages/")) {
            return new Response(file, {
              headers: {
                "Content-Security-Policy":
                  "default-src 'self'; img-src 'self' https://images.unsplash.com https://picsum.photos data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'",
              },
            });
          }
          return new Response(file);
        }

        return new Response("Not Found", { status: 404 });
      } catch (err: any) {
        console.error("[Web Server Error]", err);
        return new Response(`Server Error: ${err.message}`, { status: 500 });
      }
    }
  });

  console.log(`[Telegram] Web Server started on port ${port}`);
  console.log("[Telegram] Bot starting...");
  await bot.start();
}

main().catch((err) => {
  console.error("Fatal startup error in Telegram service:", err);
  process.exit(1);
});
