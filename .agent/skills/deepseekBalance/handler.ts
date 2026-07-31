import { checkAndStoreBalance, getUsageSummary } from "../../../src/core/deepseekBalance";
import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: {
    action?: "balance" | "usage" | "history";
    days?: number;
    limit?: number;
    alertIfBelow?: number;
  },
  _context?: { chatId: string; alias?: string }
) {
  let action = args.action;

  if (!action) {
    if (args.days !== undefined || args.limit !== undefined) {
      action = "usage";
    } else {
      action = "balance";
    }
  }

  switch (action) {
    case "balance": {
      const result = await checkAndStoreBalance();
      const balanceLines = result.balances.map((b) => {
        const line = `• **${b.currency}:** ${b.totalBalance.toFixed(2)} (granted: ${b.grantedBalance.toFixed(2)}, topped up: ${b.toppedUpBalance.toFixed(2)})`;
        return line;
      });

      const alerts: string[] = [];
      if (!result.isAvailable) {
        alerts.push("⚠️ DeepSeek reports the account is NOT available for API calls.");
      }
      if (args.alertIfBelow !== undefined) {
        for (const b of result.balances) {
          if (b.totalBalance < args.alertIfBelow) {
            alerts.push(`⚠️ Low balance: ${b.currency} ${b.totalBalance.toFixed(2)} is below your threshold of ${args.alertIfBelow}.`);
          }
        }
      }

      return {
        success: true,
        fetchedAt: result.fetchedAt,
        isAvailable: result.isAvailable,
        balances: result.balances,
        summary: [
          `💳 **DeepSeek Balance** (as of ${result.fetchedAt}):`,
          ...balanceLines,
          ...alerts,
        ].join("\n"),
      };
    }

    case "usage": {
      const days = args.days && args.days > 0 ? Math.floor(args.days) : 30;
      const summary = await getUsageSummary("deepseek", days);
      return {
        success: true,
        ...summary,
        summary: [
          `📊 **DeepSeek Usage (last ${days} days):**`,
          `• **Calls:** ${summary.count}`,
          `• **Prompt tokens:** ${summary.promptTokens.toLocaleString()}`,
          `• **Completion tokens:** ${summary.completionTokens.toLocaleString()}`,
          `• **Total tokens:** ${summary.totalTokens.toLocaleString()}`,
          `• **Est. cost:** USD ${summary.estimatedCostUsd.toFixed(4)}`,
        ].join("\n"),
      };
    }

    case "history": {
      const limit = args.limit && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 10;
      const storage = new StorageService();
      await storage.initialize();
      try {
        const snaps = await storage.getBalanceSnapshots(limit);
        return {
          success: true,
          count: snaps.length,
          snapshots: snaps,
          summary: snaps.length
            ? `📈 **Recent Balance Snapshots:**\n` +
              snaps
                .map(
                  (s) =>
                    `• ${s.currency} ${s.totalBalance.toFixed(2)} — ${s.createdAt ? new Date(s.createdAt).toISOString() : "unknown"}${s.isAvailable ? "" : " (unavailable)"}`
                )
                .join("\n")
            : "No balance snapshots recorded yet. Ask me to check your balance first.",
        };
      } finally {
        await storage.close();
      }
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
