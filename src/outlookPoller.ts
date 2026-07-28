import { Bot, InlineKeyboard } from "grammy";
import { StorageService, MicrosoftCredentials } from "./database/Storage";
import { extractExpense } from "./emailPoller";

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
}

async function refreshMicrosoftToken(chatId: string, refreshToken: string, storage: StorageService): Promise<string | null> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error(`[OutlookPoller] Token refresh failed for chat ${chatId}: ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as any;
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token || refreshToken;
    const newExpiry = Date.now() + data.expires_in * 1000;

    await storage.saveMicrosoftCredentials(chatId, {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expiry_date: newExpiry,
    });

    return newAccessToken;
  } catch (err: any) {
    console.error(`[OutlookPoller] Exception refreshing token for ${chatId}:`, err.message);
    return null;
  }
}

export async function pollUserOutlook(chatId: string, creds: MicrosoftCredentials, bot?: Bot, customQuery?: string) {
  const storage = new StorageService();
  await storage.initialize();

  try {
    let accessToken = creds.access_token;

    // Check token expiry (refresh if expiring within 5 mins)
    if (Date.now() >= creds.expiry_date - 300000) {
      console.log(`[OutlookPoller] Access token expiring for chat ${chatId}, refreshing...`);
      const refreshed = await refreshMicrosoftToken(chatId, creds.refresh_token, storage);
      if (!refreshed) {
        console.error(`[OutlookPoller] Unable to refresh token for chat ${chatId}.`);
        return;
      }
      accessToken = refreshed;
    }

    // Fetch unread messages from Microsoft Graph API
    let graphUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=5&$select=id,subject,from,body,bodyPreview,createdDateTime";
    if (customQuery && customQuery.trim().length > 0) {
      graphUrl += `&$search="${customQuery.trim()}"`;
    }

    const graphRes = await fetch(
      graphUrl,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!graphRes.ok) {
      const errText = await graphRes.text();
      console.error(`[OutlookPoller] Microsoft Graph API error for ${chatId}: ${errText}`);
      return;
    }

    const graphData = (await graphRes.json()) as any;
    const messages = graphData.value || [];

    if (messages.length === 0) return;

    console.log(`[OutlookPoller] Found ${messages.length} unread Microsoft emails for chat ${chatId}`);

    for (const msg of messages) {
      if (!msg.id) continue;

      const alreadyProcessed = await storage.isEmailProcessed(msg.id);
      if (alreadyProcessed) {
        continue;
      }

      await storage.markEmailProcessed(msg.id, chatId);

      const subject = msg.subject || "No Subject";
      const fromHeader = msg.from?.emailAddress?.address || "Unknown";
      const textBody = stripHtmlTags(msg.body?.content || msg.bodyPreview || "").substring(0, 4000);

      const parsed = await extractExpense(textBody, subject, fromHeader);

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
                `🎉 **Reimbursement Settled!**\n\n**${matched.debtorName}** paid you **SGD ${parsed.amount.toFixed(2)}** via Outlook for _${matched.description}_!\n\n✅ Debt marked as settled.`,
                opts
              );
            }

            // Mark message as read via Microsoft Graph PATCH API
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ isRead: true }),
            });
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

      // Mark message as read via Microsoft Graph PATCH API
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isRead: true }),
      });
    }
  } catch (err: any) {
    console.error(`[OutlookPoller] Error polling Microsoft Graph for ${chatId}:`, err.message);
  } finally {
    await storage.close();
  }
}

