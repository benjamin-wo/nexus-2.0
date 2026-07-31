import { InlineKeyboard } from "grammy";
import { NotifyFn } from "./NotifyBridge";
import { StorageService } from "../database/Storage";

export interface ParsedReceipt {
  amount: number | null;
  description: string | null;
  category: string | null;
  payment_mode?: string | null;
}

/** Reads the AUTO_LOG_EXPENSES user preference (supports both boolean and "true" strings). */
export async function isAutoLogEnabled(storage: StorageService): Promise<boolean> {
  const val = await storage.getProfileValue("AUTO_LOG_EXPENSES");
  return val === true || val === "true";
}

/** Sends the "New Receipt Found" confirmation prompt with inline buttons (log / discard / edit). */
export async function sendReceiptPrompt(
  notifier: NotifyFn | undefined,
  storage: StorageService,
  chatId: string,
  pendingId: number,
  parsed: ParsedReceipt,
  providerLabel = ""
): Promise<void> {
  if (!notifier) return;

  const amountStr = parsed.amount !== null && parsed.amount !== undefined ? `$${parsed.amount}` : "[Missing]";
  const descStr = parsed.description || "[Missing]";
  const catStr = parsed.category || "[Missing]";
  const payStr = parsed.payment_mode || "[Missing]";

  let msgText = `📧 **New Receipt Found${providerLabel ? ` (${providerLabel})` : ""}!**\n\n`;
  msgText += `• **Amount:** ${amountStr}\n`;
  msgText += `• **Desc:** ${descStr}\n`;
  msgText += `• **Category:** ${catStr}\n`;
  msgText += `• **Payment:** ${payStr}\n\n`;

  const missing: string[] = [];
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
    await notifier(chatId, msgText, opts);
  } catch (e) {
    console.error(`[ExpenseNotify] Error sending receipt prompt to ${chatId}:`, e);
  }
}

/** Sends a confirmation notice when an expense was auto-logged (no keyboard needed). */
export async function sendAutoLoggedNotice(
  notifier: NotifyFn | undefined,
  storage: StorageService,
  chatId: string,
  parsed: ParsedReceipt,
  providerLabel = ""
): Promise<void> {
  if (!notifier) return;

  const amountStr = parsed.amount !== null && parsed.amount !== undefined ? `$${parsed.amount}` : "[Missing]";
  const descStr = parsed.description || "[Missing]";
  const catStr = parsed.category || "[Missing]";
  const payStr = parsed.payment_mode || "[Missing]";

  const msgText =
    `✅ **Auto-logged Expense${providerLabel ? ` (${providerLabel})` : ""}:**\n\n` +
    `• **Amount:** ${amountStr}\n` +
    `• **Desc:** ${descStr}\n` +
    `• **Category:** ${catStr}\n` +
    `• **Payment:** ${payStr}`;

  try {
    const financeThreadId = await storage.getProfileValue("FINANCE_THREAD_ID");
    const opts: any = { parse_mode: "Markdown" };
    if (financeThreadId) opts.message_thread_id = Number(financeThreadId);
    await notifier(chatId, msgText, opts);
  } catch (e) {
    console.error(`[ExpenseNotify] Error sending auto-log notice to ${chatId}:`, e);
  }
}
