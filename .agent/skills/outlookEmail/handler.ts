import { ImapFlow } from "imapflow";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
}

export async function execute(args: { action: "list" | "search"; query?: string }) {
  const email = process.env.OUTLOOK_EMAIL;
  const password = process.env.OUTLOOK_APP_PASSWORD;

  if (!email || !password) {
    return {
      success: false,
      message: "⚠️ Outlook credentials (OUTLOOK_EMAIL and OUTLOOK_APP_PASSWORD) are not configured on this instance.",
    };
  }

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

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const criteria: any = {};
      if (args.query) {
        criteria.body = args.query;
      }

      const messages = client.fetch(criteria, { envelope: true, source: true, uid: true });
      const results: any[] = [];

      for await (const msg of messages) {
        const envelope = msg.envelope;
        const subject = envelope.subject || "No Subject";
        const from = envelope.from?.[0]?.address || "Unknown";
        const date = envelope.date ? envelope.date.toLocaleString() : "Unknown";
        const snippet = stripHtml(msg.source.toString("utf-8")).substring(0, 200);

        results.push({
          uid: msg.uid,
          subject,
          from,
          date,
          snippet,
        });

        if (results.length >= 5) break; // Return top 5 recent matches
      }

      if (results.length === 0) {
        return {
          success: true,
          message: `📧 No Outlook emails found matching your query: "${args.query || "recent"}"`,
        };
      }

      const formatted = results
        .map(
          (m, idx) =>
            `${idx + 1}. <b>${m.subject}</b>\n   • From: <code>${m.from}</code>\n   • Date: ${m.date}\n   • Snippet: <i>${m.snippet}...</i>`
        )
        .join("\n\n");

      return {
        success: true,
        count: results.length,
        message: `📧 <b>Recent Outlook Emails (${email}):</b>\n\n${formatted}`,
      };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return {
      success: false,
      message: `❌ Error connecting to Outlook IMAP: ${err.message}`,
    };
  } finally {
    await client.logout().catch(() => {});
  }
}
