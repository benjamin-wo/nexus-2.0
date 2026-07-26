import { pollUserOutlook } from "../../../src/outlookPoller";
import { pollUserGmail } from "../../../src/emailPoller";
import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: { provider?: "all" | "outlook" | "gmail" },
  context?: { chatId: string }
) {
  const provider = args.provider || "all";
  const chatId = context?.chatId || "default_cli_chat";

  const storage = new StorageService();
  await storage.initialize();

  try {
    const results: string[] = [];

    if (provider === "all" || provider === "outlook") {
      const msCreds = await storage.getMicrosoftCredentials(chatId);
      if (msCreds) {
        await pollUserOutlook(chatId, msCreds);
        results.push("✅ Outlook/Hotmail polling cycle completed.");
      } else {
        results.push("ℹ️ Outlook is not authorized for this account.");
      }
    }

    if (provider === "all" || provider === "gmail") {
      const gCreds = await storage.getGoogleCredentials(chatId);
      if (gCreds) {
        await pollUserGmail(chatId, gCreds);
        results.push("✅ Gmail polling cycle completed.");
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
