import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: {
    action?: "readLogs" | "logImprovement";
    limit?: number;
    category?: "BUG_REPORT" | "IMPROVEMENT" | string;
    message?: string;
    details?: string;
    isError?: boolean;
  },
  context?: { chatId: string; alias?: string }
) {
  let action = args.action;

  // Compatibility resolution for old aliases
  if (context?.alias === "readLogs") action = "readLogs";
  if (context?.alias === "logImprovement") action = "logImprovement";

  if (!action) {
    if (args.category || args.message) {
      action = "logImprovement";
    } else {
      action = "readLogs";
    }
  }

  const storage = new StorageService();
  await storage.initialize();

  try {
    switch (action) {
      case "readLogs": {
        const limit = args.limit || 20;
        const logs = await storage.getRecentLogs(limit);
        return { success: true, count: logs.length, logs };
      }

      case "logImprovement": {
        const category = args.category || "IMPROVEMENT";
        const message = args.message || "User feedback";
        const details = args.details || "";
        const isError = args.isError !== undefined ? args.isError : false;

        await storage.logEvent({
          category,
          message,
          details,
          isError,
        });

        return {
          success: true,
          message: `Logged ${category} to database: "${message}"`,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  } finally {
    await storage.close();
  }
}
