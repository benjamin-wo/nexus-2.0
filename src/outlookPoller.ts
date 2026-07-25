import { ImapFlow } from "imapflow";
import { Bot, InlineKeyboard } from "grammy";
import { StorageService } from "./database/Storage";
import { extractExpense } from "./emailPoller";

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
}

export async function pollOutlook(bot?: Bot) {
  const email = process.env.OUTLOOK_EMAIL;
  const password = process.env.OUTLOOK_APP_PASSWORD;

  if (!email || !password) {
    return; // Outlook credentials not configured on this instance
  }

  console.log(`[OutlookPoller] Starting poll cycle for ${email}...`);

  const client = new ImapFlow({
    host: "outlook.office365.com",
    port: 993,
    secure: true,
    auth: {
      user: email,
      pass: password,
    },
    logger: false,
  });

  const storage = new StorageService();
  await storage.initialize();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search for unread messages
      const messages = client.fetch({ unseen: true }, { source: true, envelope: true, uid: true });

      for await (const msg of messages) {
        const envelope = msg.envelope;
        const subject = envelope.subject || "No Subject";
        const fromHeader = envelope.from?.[0]?.address || "Unknown";
        const uid = msg.uid;

        console.log(`[OutlookPoller] Processing message UID ${uid} ("${subject}") from ${fromHeader}`);

        const source = msg.source.toString("utf-8");
        const textBody = stripHtmlTags(source).substring(0, 4000);

        const parsed = await extractExpense(textBody, subject, fromHeader);

        // Find primary chat_id for this single-user deployment
        const activeTasks = await storage.getActiveTasks();
        const logs = await storage.getRecentLogs(10);
        let chatId = logs.find((l: any) => l.details && l.details.chatId)?.details?.chatId || "default_chat";

        // Try getting chat ID from user_profile or recent conversations if possible
        if (chatId === "default_chat" && storage.isPostgres) {
          const res = await (storage as any).pgPool.query(
            "SELECT chat_id FROM conversations ORDER BY id DESC LIMIT 1"
          );
          if (res.rows.length > 0) chatId = res.rows[0].chat_id;
        }

        if (parsed && parsed.is_receipt) {
          const isIncoming = /received|credited|incoming|paid you|transfer from/i.test(textBody + subject);
          if (isIncoming && parsed.amount && parsed.description) {
            const matched = await storage.matchAndSettleReimbursement(chatId, parsed.description, parsed.amount);
            if (matched) {
              console.log(`[OutlookPoller] Auto-settled reimbursement ${matched.id} for ${matched.debtorName} (${matched.amount})`);
              if (bot) {
                const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
                const opts: any = { parse_mode: "Markdown" };
                if (financeThreadId) opts.message_thread_id = Number(financeThreadId);
                await bot.api.sendMessage(
                  chatId,
                  `🎉 **Reimbursement Settled!**\n\n**${matched.debtorName}** paid you **SGD ${parsed.amount.toFixed(2)}** via PayNow/Outlook for _${matched.description}_!\n\n✅ Debt marked as settled.`,
                  opts
                );
              }
              // Mark message as read
              await client.messageFlagsAdd({ uid }, ["\\Seen"]);
              continue;
            }
          }

          console.log(`[OutlookPoller] Found receipt: $${parsed.amount} for ${parsed.description}`);
          const pendingId = await storage.createPendingExpense({
            chatId,
            amount: parsed.amount !== undefined ? Number(parsed.amount) : null,
            category: parsed.category || null,
            description: parsed.description || null,
            paymentMode: parsed.payment_mode || null,
          });

          if (bot) {
            const amountStr = parsed.amount !== null && parsed.amount !== undefined ? `$${parsed.amount}` : "[Missing]";
            const descStr = parsed.description || "[Missing]";
            const catStr = parsed.category || "[Missing]";
            const payStr = parsed.payment_mode || "[Missing]";

            let msgText = `📧 **New Receipt Found (Outlook)!**\n\n`;
            msgText += `• **Amount:** ${amountStr}\n`;
            msgText += `• **Desc:** ${descStr}\n`;
            msgText += `• **Category:** ${catStr}\n`;
            msgText += `• **Payment:** ${payStr}\n\n`;

            const missing = [];
            if (!parsed.amount) missing.push("Amount");
            if (!parsed.description) missing.push("Description");
            if (!parsed.category) missing.push("Category");
            if (!parsed.payment_mode) missing.push("Payment Mode");

            let keyboard = new InlineKeyboard();
            if (missing.length > 0) {
              msgText += `Please provide the missing details (e.g. ${missing.join(", ")}) so I can log this expense.`;
              keyboard.text("❌ Discard", `log_no:${pendingId}`).text("✏️ Complete details", `log_edit:${pendingId}`);
            } else {
              msgText += `Should I log this?`;
              keyboard
                .text("✅ Yes, log it", `log_yes:${pendingId}`)
                .text("❌ Discard", `log_no:${pendingId}`)
                .row()
                .text("✏️ Edit details", `log_edit:${pendingId}`);
            }

            try {
              const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
              const opts: any = { parse_mode: "Markdown", reply_markup: keyboard };
              if (financeThreadId) opts.message_thread_id = Number(financeThreadId);
              await bot.api.sendMessage(chatId, msgText, opts);
            } catch (e) {
              console.error(`[OutlookPoller] Error sending Telegram message to ${chatId}:`, e);
            }
          }
        }

        // Mark as read in IMAP so we don't re-process
        await client.messageFlagsAdd({ uid }, ["\\Seen"]);
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    console.error(`[OutlookPoller] Error polling Outlook IMAP for ${email}:`, err.message);
  } finally {
    await storage.close();
  }
}

export function startOutlookPoller(bot?: Bot, intervalMs: number = 15 * 60 * 1000) {
  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_APP_PASSWORD) {
    return;
  }
  console.log(`[OutlookPoller] Initialized to run every ${intervalMs / 60000} minutes.`);
  pollOutlook(bot).catch((err) => console.error("[OutlookPoller] Initial poll failed:", err));
  setInterval(() => {
    pollOutlook(bot).catch((err) => console.error("[OutlookPoller] Scheduled poll failed:", err));
  }, intervalMs);
}
