import { getAccessToken, getGoogleAuthUrl } from "../../../src/core/googleAuth";
import { StorageService } from "../../../src/database/Storage";
import { pollUserOutlook } from "../../../src/outlookPoller";
import { pollUserGmail } from "../../../src/emailPoller";
import { notifyUser } from "../../../src/core/NotifyBridge";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
}

async function refreshOutlookToken(storage: any, chatId: string, creds: any): Promise<string> {
  let accessToken = creds.access_token;
  if (Date.now() >= creds.expiry_date - 300000) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

    if (clientId && clientSecret && creds.refresh_token) {
      const refreshRes = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: creds.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as any;
        accessToken = data.access_token;
        await storage.saveMicrosoftCredentials(chatId, {
          access_token: data.access_token,
          refresh_token: data.refresh_token || creds.refresh_token,
          expiry_date: Date.now() + data.expires_in * 1000,
        });
      }
    }
  }
  return accessToken;
}

export async function execute(
  args: {
    action?: "list" | "get" | "send" | "poll" | "listEmails" | "getEmail" | "sendEmail" | "search";
    provider?: "gmail" | "outlook" | "all";
    q?: string;
    query?: string;
    messageId?: string;
    to?: string;
    subject?: string;
    body?: string;
    days?: number;
  },
  context?: { chatId: string; alias?: string }
) {
  const chatId = context?.chatId || "default_cli_chat";
  
  // Normalize actions from old alias names
  let action = args.action;
  let provider = args.provider;

  if (context?.alias === "gmail") {
    provider = "gmail";
    if (args.action === "listEmails") action = "list";
    if (args.action === "getEmail") action = "get";
    if (args.action === "sendEmail") action = "send";
  } else if (context?.alias === "outlookEmail") {
    provider = "outlook";
    if (args.action === "list" || args.action === "search") action = "list";
  } else if (context?.alias === "pollEmails") {
    action = "poll";
    provider = args.provider || "all";
  }

  // General fallbacks if missing
  if (!action) {
    if (args.to || args.subject || args.body) {
      action = "send";
    } else if (args.messageId) {
      action = "get";
    } else {
      action = "list";
    }
  }
  if (!provider && action !== "poll") {
    provider = "gmail"; // Default to gmail for operations
  }

  const query = args.q || args.query || "";

  switch (action) {
    case "list":
    case "search":
    case "listEmails": {
      if (provider === "gmail") {
        let token: string;
        try {
          token = await getAccessToken(chatId);
        } catch (err: any) {
          if (err.message.includes("NOT_AUTHENTICATED")) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: err.message.split(": ").slice(1).join(": ") };
          }
          throw err;
        }

        let url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5";
        if (query) {
          url += `&q=${encodeURIComponent(query)}`;
        }

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 401 || res.status === 403) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: getGoogleAuthUrl(chatId) };
          }
          throw new Error(`Gmail API failed with status ${res.status}: ${errText}`);
        }
        
        const data = await res.json() as any;
        const messages = data.messages || [];

        const detailedMessages = await Promise.all(
          messages.map(async (msg: any) => {
            const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (!detailRes.ok) return { id: msg.id, snippet: "Error loading metadata" };
            const detail = await detailRes.json() as any;
            
            const headers = detail.payload?.headers || [];
            const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
            const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "(Unknown Sender)";
            const dateHeader = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";

            return {
              id: msg.id,
              from: fromHeader,
              subject: subjectHeader,
              date: dateHeader,
              snippet: detail.snippet
            };
          })
        );

        return { success: true, messages: detailedMessages };
      } else if (provider === "outlook") {
        const storage = new StorageService();
        await storage.initialize();

        try {
          const creds = await storage.getMicrosoftCredentials(chatId);
          if (!creds) {
            return {
              success: false,
              message: "⚠️ Outlook/Hotmail account is not authorized yet. Please type `/authorize_outlook` in Telegram to link your account!",
            };
          }

          const accessToken = await refreshOutlookToken(storage, chatId, creds);

          let graphUrl = "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,subject,from,body,bodyPreview,createdDateTime";
          if (query.trim().length > 0) {
            graphUrl += `&$search="${query.trim()}"`;
          }

          const res = await fetch(graphUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!res.ok) {
            const errText = await res.text();
            return {
              success: false,
              message: `❌ Microsoft Graph API error: ${errText}`,
            };
          }

          const data = (await res.json()) as any;
          const messages = data.value || [];

          if (messages.length === 0) {
            return {
              success: true,
              message: `📧 No Outlook emails found matching query: "${query || "recent"}"`,
            };
          }

          const formatted = messages
            .map((m: any, idx: number) => {
              const subject = m.subject || "No Subject";
              const from = m.from?.emailAddress?.address || "Unknown";
              const date = m.createdDateTime ? new Date(m.createdDateTime).toLocaleString() : "Unknown";
              const snippet = stripHtml(m.bodyPreview || m.body?.content || "").substring(0, 180);
              return `${idx + 1}. <b>${subject}</b>\n   • From: <code>${from}</code>\n   • Date: ${date}\n   • Snippet: <i>${snippet}...</i>`;
            })
            .join("\n\n");

          return {
            success: true,
            count: messages.length,
            message: `📧 <b>Recent Outlook Emails:</b>\n\n${formatted}`,
          };
        } finally {
          await storage.close();
        }
      }
      break;
    }

    case "get":
    case "getEmail": {
      const messageId = args.messageId;
      if (!messageId) throw new Error("Parameter 'messageId' is required for action 'get'.");

      if (provider === "gmail") {
        let token: string;
        try {
          token = await getAccessToken(chatId);
        } catch (err: any) {
          if (err.message.includes("NOT_AUTHENTICATED")) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: err.message.split(": ").slice(1).join(": ") };
          }
          throw err;
        }

        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 401 || res.status === 403) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: getGoogleAuthUrl(chatId) };
          }
          throw new Error(`Gmail API failed with status ${res.status}: ${errText}`);
        }
        
        const detail = await res.json() as any;
        const headers = detail.payload?.headers || [];
        const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
        const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "(Unknown Sender)";
        const dateHeader = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";

        let bodyText = detail.snippet || "";
        const parts = detail.payload?.parts || [];
        const bodyPart = parts.find((p: any) => p.mimeType === "text/plain");
        if (bodyPart?.body?.data) {
          bodyText = Buffer.from(bodyPart.body.data, "base64").toString("utf-8");
        }

        return {
          success: true,
          messageId,
          from: fromHeader,
          subject: subjectHeader,
          date: dateHeader,
          body: bodyText
        };
      } else if (provider === "outlook") {
        const storage = new StorageService();
        await storage.initialize();

        try {
          const creds = await storage.getMicrosoftCredentials(chatId);
          if (!creds) {
            return {
              success: false,
              message: "⚠️ Outlook/Hotmail account is not authorized yet.",
            };
          }

          const accessToken = await refreshOutlookToken(storage, chatId, creds);

          const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=id,subject,from,body,createdDateTime`;
          const res = await fetch(graphUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!res.ok) {
            const errText = await res.text();
            return {
              success: false,
              message: `❌ Microsoft Graph API error: ${errText}`,
            };
          }

          const m = (await res.json()) as any;
          const subject = m.subject || "No Subject";
          const from = m.from?.emailAddress?.address || "Unknown";
          const date = m.createdDateTime ? new Date(m.createdDateTime).toLocaleString() : "Unknown";
          const bodyText = stripHtml(m.body?.content || "");

          return {
            success: true,
            messageId,
            from,
            subject,
            date,
            body: bodyText
          };
        } finally {
          await storage.close();
        }
      }
      break;
    }

    case "send":
    case "sendEmail": {
      const { to, subject, body } = args;
      if (!to || !subject || !body) {
        throw new Error("Parameters 'to', 'subject', and 'body' are required for action 'send'.");
      }

      if (provider === "gmail") {
        let token: string;
        try {
          token = await getAccessToken(chatId);
        } catch (err: any) {
          if (err.message.includes("NOT_AUTHENTICATED")) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: err.message.split(": ").slice(1).join(": ") };
          }
          throw err;
        }

        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
        const emailLines = [
          `To: ${to}`,
          `Subject: ${utf8Subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "MIME-Version: 1.0",
          "",
          body
        ];
        const rawMime = Buffer.from(emailLines.join("\r\n"))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ raw: rawMime })
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 401 || res.status === 403) {
            return { success: false, error: "NOT_AUTHENTICATED", authUrl: getGoogleAuthUrl(chatId) };
          }
          throw new Error(`Gmail API failed with status ${res.status}: ${errText}`);
        }
        
        const sentData = await res.json() as any;
        return { success: true, messageId: sentData.id, message: `Email sent successfully to ${to}.` };
      } else if (provider === "outlook") {
        const storage = new StorageService();
        await storage.initialize();

        try {
          const creds = await storage.getMicrosoftCredentials(chatId);
          if (!creds) {
            return { success: false, message: "⚠️ Outlook is not authorized." };
          }

          const accessToken = await refreshOutlookToken(storage, chatId, creds);

          const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                subject,
                body: { contentType: "Text", content: body },
                toRecipients: [{ emailAddress: { address: to } }],
              },
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Microsoft Graph API failed: ${errText}`);
          }

          return { success: true, message: `Email sent successfully to ${to} via Outlook.` };
        } finally {
          await storage.close();
        }
      }
      break;
    }

    case "poll": {
      const pollProvider = provider || "all";
      const days = args.days;
      const storage = new StorageService();
      await storage.initialize();

      try {
        const results: string[] = [];

        if (pollProvider === "all" || pollProvider === "outlook") {
          const msCreds = await storage.getMicrosoftCredentials(chatId);
          if (msCreds) {
            await pollUserOutlook(chatId, msCreds, notifyUser, query, days);
            results.push(query ? `✅ Outlook polling completed for filter: "${query}".` : "✅ Outlook/Hotmail polling cycle completed.");
          } else {
            results.push("ℹ️ Outlook is not authorized for this account.");
          }
        }

        if (pollProvider === "all" || pollProvider === "gmail") {
          const gCreds = await storage.getGoogleCredentials(chatId);
          if (gCreds) {
            await pollUserGmail(chatId, gCreds, notifyUser, query, days);
            results.push(query ? `✅ Gmail polling completed for filter: "${query}".` : "✅ Gmail polling cycle completed.");
          } else {
            results.push("ℹ️ Gmail is not authorized for this account.");
          }
        }

        return {
          success: true,
          message: `📧 <b>Email Polling Completed:</b>\n\n${results.join("\n")}`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `❌ Email polling failed: ${err.message}`,
        };
      } finally {
        await storage.close();
      }
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
