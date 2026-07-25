import { StorageService } from "../../../src/database/Storage";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
}

export async function execute(
  args: { action?: "list" | "search"; query?: string },
  context?: { chatId: string }
) {
  const chatId = context?.chatId || "default_cli_chat";
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

    let accessToken = creds.access_token;
    if (Date.now() >= creds.expiry_date - 300000) {
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

      if (clientId && clientSecret && creds.refresh_token) {
        const refreshRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
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

    let graphUrl = "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,subject,from,body,bodyPreview,createdDateTime";
    if (args.query && args.query.trim().length > 0) {
      const filterStr = encodeURIComponent(`contains(subject,'${args.query.trim()}') or contains(body,'${args.query.trim()}')`);
      graphUrl += `&$search="${args.query.trim()}"`;
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
        message: `📧 No Outlook emails found matching query: "${args.query || "recent"}"`,
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
