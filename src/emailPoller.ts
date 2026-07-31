import { StorageService, GoogleCredentials } from "./database/Storage";
import { NotifyFn } from "./core/NotifyBridge";
import { isAutoLogEnabled, sendAutoLoggedNotice, sendReceiptPrompt } from "./core/expenseNotify";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const LABEL_NAME = "Logged-Expense";

async function refreshGoogleToken(credentials: GoogleCredentials, chatId: string, storage: StorageService): Promise<string> {
  if (Date.now() < credentials.expiry_date - 60000) {
    return credentials.access_token;
  }
  
  console.log(`[EmailPoller] Refreshing token for chat ${chatId}...`);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token"
    })
  });

  const data = await response.json();
  if (data.error) {
    console.error(`[EmailPoller] Failed to refresh token for chat ${chatId}:`, data);
    throw new Error("Token refresh failed");
  }

  credentials.access_token = data.access_token;
  credentials.expiry_date = Date.now() + (data.expires_in * 1000);
  
  await storage.saveGoogleCredentials(chatId, credentials);
  return credentials.access_token;
}

async function getOrCreateLabel(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch labels: ${err}`);
  }
  const data = await res.json();
  const existingLabel = data.labels?.find((l: any) => l.name === LABEL_NAME);
  
  if (existingLabel) {
    return existingLabel.id;
  }

  console.log(`[EmailPoller] Creating label "${LABEL_NAME}"...`);
  const createRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: LABEL_NAME,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    })
  });
  
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create label: ${err}`);
  }
  
  const createData = await createRes.json();
  return createData.id;
}

function getEmailParts(payload: any): { plain: string; html: string } {
  let plain = '';
  let html = '';

  if (!payload) return { plain, html };

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    plain += Buffer.from(payload.body.data, 'base64url').toString('utf-8') + '\n';
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html += Buffer.from(payload.body.data, 'base64url').toString('utf-8') + '\n';
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const res = getEmailParts(part);
      plain += res.plain;
      html += res.html;
    }
  }

  return { plain, html };
}

function getEmailBody(payload: any): string {
  const { plain, html } = getEmailParts(payload);
  if (plain.trim().length > 10) {
    return plain;
  }
  if (html.trim().length > 0) {
    return stripHtmlTags(html);
  }
  return '';
}

function stripHtmlTags(html: string): string {
  let text = html.replace(/<style[^>]*>.*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>.*?<\/script>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<\/(?:div|p|tr|li|h[1-6]|table|blockquote)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/td>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#160;/g, ' ')
    .replace(/&#8217;/g, "'");

  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

import { LlmService } from "./core/LlmService";

export async function extractExpense(content: string, subject: string, fromHeader: string): Promise<any> {
  const prompt = `
You are an assistant that analyzes email content to determine if it is a financial receipt/transaction alert, and extracts details.
First, determine if the email is a financial receipt, invoice, order confirmation, bank/wallet transaction alert, payment confirmation, or utility bill.
Only classify it as a receipt/transaction if it documents a completed or pending financial payment, purchase, or money transfer.

Email Metadata:
- From: ${fromHeader}
- Subject: ${subject}

Extract the following details from this email:
- is_receipt (boolean: true if it is a financial receipt or transaction alert, false otherwise)
- amount (number only, or null if not found or is_receipt is false)
- description: Infer the clean, recognizable name of the merchant, shop, service, payee, or transfer recipient (e.g. "GOJEK", "Toast Box", "Kopitiam", "John Tan"). For DBS PayLah! or PayNow payments/transfers, extract the merchant or person's name listed under "To:" or "Payee:" or in the body text (e.g., if the email states "To: GOJEK", output "GOJEK"). DO NOT output "Unknown" or "null" as a literal string. If the payee/merchant cannot be identified at all, output null.
- category: Categorize the expense (e.g. Food, Shopping, Transfer, Transport, Groceries, Health, Subscription, Travel, Utilities, etc). If the transaction is to a ride-hailing service like GOJEK or Grab, categorize as Transport. If completely unsure, output null.
- payment_mode: Map the credit card or payment wallet by applying these rules strictly:
  * If it is a DBS PayLah! wallet alert, or from PayLah! Alerts, or from paylah.alert@dbs.com, or the subject/body mentions PayLah / DBS PayLah!, output: "PayLah!"
  * If it is a UOB email and the transaction references card ending in "6405", output: "UOB Krisflyer"
  * If it is a UOB email and the transaction references card ending in "5184", output: "UOB Visa Signature"
  * If it is a DBS/POSB transaction alert (and NOT a DBS PayLah! wallet alert), output: "DBS Womens"
  * If it is a Citibank email, output: "CitiBank Rewards"
  * If it is a HSBC email, output: "HSBC Revolution"
  * If none of the above rules match but you are certain it is a credit card transaction, output: "Credit Card"
  * Otherwise, output null.

Format your response STRICTLY as a JSON object with keys: "is_receipt", "amount", "description", "category", "payment_mode".

Email body:
${content}
`;

  try {
    const llm = new LlmService();
    const text = await llm.generateResponse([{ role: "user", content: prompt }]);
    const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || text.match(/{[\s\S]*?}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (err) {
    console.error("[EmailPoller] Failed to extract expense from LLM response:", err);
    return null;
  }
}

async function processUser(chatId: string, credentials: GoogleCredentials, storage: StorageService, notifier?: NotifyFn, customQuery?: string, days?: number) {
  try {
    const accessToken = await refreshGoogleToken(credentials, chatId, storage);
    const labelId = await getOrCreateLabel(accessToken);

    // Look back `days` (default 1) in Singapore time (UTC+8), regardless of server TZ.
    const daysBack = days && days > 0 ? Math.floor(days) : 1;
    const cutoff = new Date(Date.now() - daysBack * 86400000);
    const yStr = cutoff.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }); // YYYY-MM-DD

    // Dedup relies on the Logged-Expense label + processed_emails table, NOT on
    // is:unread — so read-but-unlabeled receipt emails are still caught.
    let queryStr = `-label:${LABEL_NAME} after:${yStr}`;
    if (customQuery && customQuery.trim().length > 0) {
      queryStr += ` (${customQuery.trim()})`;
    } else {
      queryStr += ` ((from:alerts@citibank.com.sg) OR (from:paylah.alert@dbs.com) OR (from:dbs.com "PayLah") OR (from:dbs.com "PayNow") OR (from:dbs.com "Received") OR (subject:"PayLah") OR (subject:"PayNow") OR (subject:"Received") OR ("DBS PayLah") OR (from:unialerts@uobgroup.com) OR (from:hsbc.bank.singapore.limited@notification.hsbc.com.hk) OR (from:ibanking.alert@dbs.com) OR (from:dbsalert@dbs.com))`;
    }
    // Scale the page size with the lookback window so backfills actually catch up.
    const maxResults = Math.min(50, Math.max(5, daysBack * 5));
    const searchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(queryStr)}&maxResults=${maxResults}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw new Error(`Gmail search failed with status ${searchRes.status}: ${errText}`);
    }

    const searchData = await searchRes.json();
    if (!searchData.messages || searchData.messages.length === 0) {
      return; // No new emails
    }

    console.log(`[EmailPoller] Found ${searchData.messages.length} potential expense emails for chat ${chatId}`);

    for (const msg of searchData.messages) {
      // Per-message isolation: one bad email must not abort the whole batch.
      try {
        // Idempotency guard (mirrors Outlook): skip messages already recorded
        // (backstop for label-application failures on previous runs).
        if (await storage.isEmailProcessed(msg.id)) continue;

        // get full message
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!msgRes.ok) {
          const errText = await msgRes.text();
          throw new Error(`Gmail fetch failed for ${msg.id}: ${msgRes.status} ${errText}`);
        }
        const msgData = await msgRes.json();

        const headers = msgData.payload?.headers || [];
        const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === 'subject');
        const subject = subjectHeader ? subjectHeader.value : "No Subject";

        const fromHeaderItem = headers.find((h: any) => h.name.toLowerCase() === 'from');
        const fromHeader = fromHeaderItem ? fromHeaderItem.value : "Unknown";

        const dateHeaderItem = headers.find((h: any) => h.name.toLowerCase() === 'date');
        const dateHeader = dateHeaderItem ? dateHeaderItem.value : "";
        let emailDate: string | undefined;
        if (dateHeader) {
          const d = new Date(dateHeader);
          if (!isNaN(d.getTime())) emailDate = d.toISOString();
        }

        console.log(`[EmailPoller] Processing message ${msg.id} ("${subject}")`);

        // try to extract full body, fallback to snippet
        let textBody = getEmailBody(msgData.payload);
        if (!textBody || textBody.trim().length === 0) {
          textBody = msgData.snippet || "";
        } else {
          textBody = stripHtmlTags(textBody);
        }

        const parsed = await extractExpense(textBody.substring(0, 4000), subject, fromHeader); // limit to 4000 chars to save tokens

        if (parsed && parsed.is_receipt) {
          const autoLog = await isAutoLogEnabled(storage);
          const amount = parsed.amount !== undefined && parsed.amount !== null ? Number(parsed.amount) : null;
          const category = parsed.category || null;
          const description = parsed.description || null;
          const paymentMode = parsed.payment_mode || null;
          const isComplete = amount !== null && description !== null && category !== null;

          let reimbursementSettled = false;

          // Check if this incoming payment matches an active pending reimbursement
          const isIncoming = /received|credited|incoming|paid you|transfer from/i.test(textBody + subject);
          if (isIncoming && parsed.amount && parsed.description) {
            const matched = await storage.matchAndSettleReimbursement(chatId, parsed.description, parsed.amount);
            if (matched) {
              reimbursementSettled = true;
              console.log(`[EmailPoller] Auto-settled reimbursement ${matched.id} for ${matched.debtorName} (${matched.amount})`);
              if (notifier) {
                const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
                const opts: any = { parse_mode: "Markdown" };
                if (financeThreadId) opts.message_thread_id = Number(financeThreadId);
                try {
                  await notifier(
                    chatId,
                    `🎉 **Reimbursement Settled!**\n\n**${matched.debtorName}** paid you **SGD ${parsed.amount.toFixed(2)}** via PayLah/PayNow for _${matched.description}_!\n\n✅ Debt marked as settled.`,
                    opts
                  );
                } catch (e) {
                  console.error(`[EmailPoller] Error sending reimbursement message to ${chatId}:`, e);
                }
              }
            }
          }

          // Settled reimbursements are NOT expenses — skip logging for them.
          if (!reimbursementSettled) {
            console.log(`[EmailPoller] Found receipt: $${parsed.amount} for ${parsed.description}`);

            if (autoLog && isComplete) {
              // Fully automatic mode: write straight to the expenses table.
              await storage.createExpense({
                chatId,
                amount,
                category: category!,
                description: description!,
                createdAt: emailDate,
              });
              console.log(`[EmailPoller] Auto-logged expense: $${amount} for ${description}`);
              await sendAutoLoggedNotice(notifier, storage, chatId, { amount, description, category, payment_mode: paymentMode });
            } else {
              const pendingId = await storage.createPendingExpense({
                chatId,
                amount,
                category,
                description,
                paymentMode,
                createdAt: emailDate,
              });
              await sendReceiptPrompt(notifier, storage, chatId, pendingId, { amount, description, category, payment_mode: paymentMode });
            }
          }
        } else {
          console.log(`[EmailPoller] Not an expense or un-parseable.`);
        }

        // Success: record + label so we never reprocess this message.
        await storage.markEmailProcessed(msg.id, chatId);
        const modifyRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ addLabelIds: [labelId] })
        });
        if (!modifyRes.ok) {
          const errStr = await modifyRes.text();
          console.error(`[EmailPoller] Failed to apply label to ${msg.id}: ${errStr}`);
        } else {
          console.log(`[EmailPoller] Label applied to ${msg.id}`);
        }
      } catch (err: any) {
        // Leave the message unmarked/unlabeled so a transient failure is
        // retried on the next poll — without blocking the rest of the batch.
        console.error(`[EmailPoller] Failed to process message ${msg.id}:`, err.message);
      }
    }

  } catch (err: any) {
    console.error(`[EmailPoller] Error processing user ${chatId}:`, err);
    // Surface failures to the user instead of silently doing nothing.
    if (notifier) {
      try {
        await notifier(
          chatId,
          `⚠️ **Gmail polling failed:** ${err.message}\n\nIf this is an auth error, re-run /authorize to reconnect your Gmail account.`,
          { parse_mode: "Markdown" }
        );
      } catch (notifyErr: any) {
        console.error(`[EmailPoller] Failed to notify user about polling error: ${notifyErr.message}`);
      }
    }
  }
}

export async function pollUserGmail(chatId: string, credentials: GoogleCredentials, notifier?: NotifyFn, customQuery?: string, days?: number) {
  const storage = new StorageService();
  await storage.initialize();
  try {
    await processUser(chatId, credentials, storage, notifier, customQuery, days);
  } finally {
    await storage.close();
  }
}
