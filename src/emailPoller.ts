import { StorageService, GoogleCredentials } from "./database/Storage";
import { Bot, InlineKeyboard } from "grammy";

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
    plain += Buffer.from(payload.body.data, 'base64').toString('utf-8') + '\n';
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html += Buffer.from(payload.body.data, 'base64').toString('utf-8') + '\n';
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

async function extractExpense(content: string, subject: string, fromHeader: string): Promise<any> {
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
- description: Infer the clean, recognizable name of the merchant, shop, service, payee, or transfer recipient (e.g. "Toast Box", "Kopitiam", "John Tan"). For DBS PayLah! or PayNow payments/transfers, extract the merchant or person's name receiving the money. DO NOT output "Unknown" or "null" as a literal string. If the payee/merchant cannot be identified at all, output null.
- category: Categorize the expense (e.g. Food, Shopping, Transfer, Transport, Groceries, Health, Subscription, Travel, Utilities, etc). If completely unsure, output null.
- payment_mode: Map the credit card or payment wallet by applying these rules strictly:
  * If it is a DBS PayLah! wallet alert, or from paylah.alert@dbs.com, or the subject/body mentions PayLah / DBS PayLah!, output: "PayLah!"
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

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    console.error("[EmailPoller] LLM API Error");
    return null;
  }

  const data = await response.json();
  const text = data.choices[0].message.content;
  try {
    const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || text.match(/{[\s\S]*?}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const parsed = JSON.parse(jsonStr);
    
    return parsed;
  } catch (err) {
    console.error("[EmailPoller] Failed to parse LLM response:", err);
    return null;
  }
}

async function processUser(chatId: string, credentials: GoogleCredentials, storage: StorageService, bot?: Bot) {
  try {
    const accessToken = await refreshGoogleToken(credentials, chatId, storage);
    const labelId = await getOrCreateLabel(accessToken);
    
    // search for unlabeled expense emails
    // SGT timezone offset (UTC+8)
    const yesterday = new Date(Date.now() - 86400000 + (8 * 3600000));
    const yStr = `${yesterday.getFullYear()}/${(yesterday.getMonth() + 1).toString().padStart(2, '0')}/${yesterday.getDate().toString().padStart(2, '0')}`;
    
    const queryStr = `is:unread -label:${LABEL_NAME} after:${yStr} ((from:alerts@citibank.com.sg "charge" "transaction" "made" -due) OR (from:paylah.alert@dbs.com) OR (from:ibanking.alert@dbs.com "PayLah") OR (from:dbsalert@dbs.com "PayLah") OR (subject:"PayLah") OR ("DBS PayLah") OR (from:unialerts@uobgroup.com "transaction") OR (from:hsbc.bank.singapore.limited@notification.hsbc.com.hk subject:"Transaction Alerts" "Transaction" "Amount") OR (from:ibanking.alert@dbs.com subject:"Card Transaction Alert"))`;
    const searchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(queryStr)}&maxResults=5`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const searchData = await searchRes.json();
    if (!searchData.messages || searchData.messages.length === 0) {
      return; // No new emails
    }

    console.log(`[EmailPoller] Found ${searchData.messages.length} potential expense emails for chat ${chatId}`);

    for (const msg of searchData.messages) {
      // get full message
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const msgData = await msgRes.json();
      
      const headers = msgData.payload.headers;
      const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === 'subject');
      const subject = subjectHeader ? subjectHeader.value : "No Subject";
      
      const fromHeaderItem = headers.find((h: any) => h.name.toLowerCase() === 'from');
      const fromHeader = fromHeaderItem ? fromHeaderItem.value : "Unknown";

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
        console.log(`[EmailPoller] Found receipt: $${parsed.amount} for ${parsed.description}`);
        const pendingId = await storage.createPendingExpense({
          chatId,
          amount: parsed.amount !== undefined ? Number(parsed.amount) : null,
          category: parsed.category || null,
          description: parsed.description || null,
          paymentMode: parsed.payment_mode || null
        });

        if (bot) {
          const amountStr = parsed.amount !== null && parsed.amount !== undefined ? `$${parsed.amount}` : "[Missing]";
          const descStr = parsed.description || "[Missing]";
          const catStr = parsed.category || "[Missing]";
          const payStr = parsed.payment_mode || "[Missing]";
          
          let msgText = `📧 **New Receipt Found!**\n\n`;
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
            keyboard.text("❌ Discard", `log_no:${pendingId}`)
                    .text("✏️ Complete details", `log_edit:${pendingId}`);
          } else {
            msgText += `Should I log this?`;
            keyboard.text("✅ Yes, log it", `log_yes:${pendingId}`)
                    .text("❌ Discard", `log_no:${pendingId}`)
                    .row()
                    .text("✏️ Edit details", `log_edit:${pendingId}`);
          }

          try {
            const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
            const opts: any = { parse_mode: "Markdown", reply_markup: keyboard };
            if (financeThreadId) {
                opts.message_thread_id = Number(financeThreadId);
            }
            await bot.api.sendMessage(chatId, msgText, opts);
          } catch (e) {
            console.error(`[EmailPoller] Error sending Telegram message to ${chatId}:`, e);
          }
        }
      } else {
        console.log(`[EmailPoller] Not an expense or un-parseable.`);
      }

      // Add label so we don't process it again
      const modifyRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          addLabelIds: [labelId]
        })
      });

      if (!modifyRes.ok) {
        const errStr = await modifyRes.text();
        console.error(`[EmailPoller] Failed to apply label to ${msg.id}: ${errStr}`);
      } else {
        console.log(`[EmailPoller] Label applied to ${msg.id}`);
      }
    }

  } catch (err) {
    console.error(`[EmailPoller] Error processing user ${chatId}:`, err);
  }
}

export async function pollEmails(bot?: Bot) {
  console.log("[EmailPoller] Starting poll cycle...");
  const storage = new StorageService();
  await storage.initialize();

  const allCreds = await storage.getAllGoogleCredentials();
  console.log(`[EmailPoller] Found ${allCreds.length} users with Google Credentials.`);

  for (const { chatId, credentials } of allCreds) {
    await processUser(chatId, credentials, storage, bot);
  }

  await storage.close();
  console.log("[EmailPoller] Cycle complete.");
}

export function startEmailPoller(bot?: Bot, intervalMs: number = 15 * 60 * 1000) {
  console.log(`[EmailPoller] Initialized to run every ${intervalMs / 60000} minutes.`);
  
  // Run once immediately
  pollEmails(bot).catch(console.error);

  // Set up the interval
  setInterval(() => {
    pollEmails(bot).catch(console.error);
  }, intervalMs);
}

// If run directly from CLI (e.g., bun run src/emailPoller.ts)
if (import.meta.main) {
  pollEmails().catch(console.error);
}
