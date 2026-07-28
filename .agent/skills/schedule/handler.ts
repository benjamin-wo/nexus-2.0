import { StorageService } from "../../../src/database/Storage";
import { getNextCronDate } from "../../../src/utils/cron";

export async function execute(
  args: { duration?: string; cron?: string; message: string },
  context?: { chatId: string; alias?: string }
) {
  const { duration, cron, message } = args;
  const chatId = context?.chatId || "default_cli_chat";

  let dueAt: Date;
  let cronExpression: string | null = null;

  if (cron && cron.trim().length > 0) {
    cronExpression = cron.trim();
    dueAt = getNextCronDate(cronExpression, new Date());
  } else if (duration && duration.trim().length > 0) {
    const match = duration.match(/^(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day)s?$/i);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      let offsetMs = 0;
      if (unit.startsWith("s")) {
        offsetMs = value * 1000;
      } else if (unit.startsWith("m")) {
        offsetMs = value * 60 * 1000;
      } else if (unit.startsWith("h")) {
        offsetMs = value * 60 * 60 * 1000;
      } else if (unit.startsWith("d")) {
        offsetMs = value * 24 * 60 * 60 * 1000;
      }
      dueAt = new Date(Date.now() + offsetMs);
    } else {
      dueAt = new Date(duration);
      if (isNaN(dueAt.getTime())) {
        throw new Error("Invalid duration/time format. Use e.g. '5 minutes' or an ISO date string.");
      }
    }
  } else {
    throw new Error("Either 'duration' (for one-off reminder) or 'cron' (for recurring reminder) must be provided.");
  }

  const storage = new StorageService();
  await storage.initialize();
  
  try {
    const id = await storage.createReminder({
      chatId,
      message,
      dueAt,
      sent: false,
      cronExpression,
    });

    return {
      success: true,
      reminderId: id,
      message,
      dueAt: dueAt.toISOString(),
      cronExpression: cronExpression || undefined,
      isRecurring: Boolean(cronExpression),
      chatId,
    };
  } finally {
    await storage.close();
  }
}
