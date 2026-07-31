import { StorageService, MicrosoftCredentials } from "./database/Storage";
import { extractExpense } from "./emailPoller";
import { NotifyFn } from "./core/NotifyBridge";
import { isAutoLogEnabled, sendAutoLoggedNotice, sendReceiptPrompt } from "./core/expenseNotify";

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

export async function pollUserOutlook(chatId: string, creds: MicrosoftCredentials, notifier?: NotifyFn, customQuery?: string, days?: number) {
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

    const daysBack = days && days > 0 ? Math.floor(days) : 1;
    const cutoffDate = new Date(Date.now() - daysBack * 86400000);

    // Fetch unread messages from Microsoft Graph API
    // $top scales with the lookback window so backfills actually find messages.
    const top = Math.min(50, Math.max(5, daysBack * 5));
    let graphUrl = `https://graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=${top}&$select=id,subject,from,body,bodyPreview,createdDateTime`;
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
    let messages = (graphData.value || []) as any[];

    // Respect the lookback window (Graph $search can't be combined with date filters)
    messages = messages.filter((m: any) => {
      const d = m.createdDateTime ? new Date(m.createdDateTime) : new Date(0);
      return d >= cutoffDate;
    });

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

      let emailDate: string | undefined;
      if (msg.createdDateTime) {
        const d = new Date(msg.createdDateTime);
        if (!isNaN(d.getTime())) emailDate = d.toISOString();
      }

      const parsed = await extractExpense(textBody, subject, fromHeader);

      if (parsed && parsed.is_receipt) {
        const autoLog = await isAutoLogEnabled(storage);
        const amount = parsed.amount !== undefined && parsed.amount !== null ? Number(parsed.amount) : null;
        const category = parsed.category || null;
        const description = parsed.description || null;
        const paymentMode = parsed.payment_mode || null;
        const isComplete = amount !== null && description !== null && category !== null;

        const isIncoming = /received|credited|incoming|paid you|transfer from/i.test(textBody + subject);
        if (isIncoming && parsed.amount && parsed.description) {
          const matched = await storage.matchAndSettleReimbursement(chatId, parsed.description, parsed.amount);
          if (matched) {
            console.log(`[OutlookPoller] Auto-settled reimbursement ${matched.id} for ${matched.debtorName} (${matched.amount})`);
            if (notifier) {
              const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
              const opts: any = { parse_mode: "Markdown" };
              if (financeThreadId) opts.message_thread_id = Number(financeThreadId);
              try {
                await notifier(
                  chatId,
                  `🎉 **Reimbursement Settled!**\n\n**${matched.debtorName}** paid you **SGD ${parsed.amount.toFixed(2)}** via Outlook for _${matched.description}_!\n\n✅ Debt marked as settled.`,
                  opts
                );
              } catch (e) {
                console.error(`[OutlookPoller] Error sending reimbursement message to ${chatId}:`, e);
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
            continue;
          }
        }

        console.log(`[OutlookPoller] Found receipt: $${parsed.amount} for ${parsed.description}`);

        if (autoLog && isComplete) {
          // Fully automatic mode: write straight to the expenses table.
          await storage.createExpense({
            chatId,
            amount,
            category: category!,
            description: description!,
            createdAt: emailDate,
          });
          console.log(`[OutlookPoller] Auto-logged expense: $${amount} for ${description}`);
          await sendAutoLoggedNotice(notifier, storage, chatId, { amount, description, category, payment_mode: paymentMode }, "Outlook");
        } else {
          const pendingId = await storage.createPendingExpense({
            chatId,
            amount,
            category,
            description,
            paymentMode,
            createdAt: emailDate,
          });
          await sendReceiptPrompt(notifier, storage, chatId, pendingId, { amount, description, category, payment_mode: paymentMode }, "Outlook");
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

