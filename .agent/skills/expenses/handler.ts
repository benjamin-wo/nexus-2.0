import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: {
    action?: "log" | "list" | "split";
    amount?: number;
    category?: string;
    description?: string;
    date?: string;
    totalAmount?: number;
    myShare?: number;
    splits?: { name: string; amount: number }[];
  },
  context?: { chatId: string; alias?: string }
) {
  const chatId = context?.chatId || "default_cli_chat";

  // Compatibility resolution for old aliases
  let action = args.action;
  if (context?.alias === "logExpense") action = "log";
  if (context?.alias === "getExpenses") action = "list";
  if (context?.alias === "splitBill") action = "split";

  if (!action) {
    if (args.splits || args.myShare || args.totalAmount) {
      action = "split";
    } else if (args.amount) {
      action = "log";
    } else {
      action = "list";
    }
  }

  const storage = new StorageService();
  await storage.initialize();

  try {
    switch (action) {
      case "log": {
        const amount = args.amount;
        const category = args.category || "Food";
        const description = args.description || "Logged Expense";
        if (amount === undefined || amount === null) {
          throw new Error("Parameter 'amount' is required for action 'log'.");
        }

        const id = await storage.createExpense({
          chatId,
          amount,
          category,
          description,
          createdAt: args.date,
        });

        const dateMsg = args.date ? ` on ${args.date}` : "";
        return {
          success: true,
          id,
          message: `Successfully logged expense of SGD ${amount.toFixed(2)} under '${category}'${dateMsg}`,
        };
      }

      case "list": {
        const expenses = await storage.getExpenses(chatId);
        return { success: true, expenses };
      }

      case "split": {
        const totalAmount = args.totalAmount;
        const myShare = args.myShare;
        const category = args.category || "Food";
        const description = args.description || "Shared Tab";
        const splits = args.splits || [];

        if (totalAmount === undefined || myShare === undefined || !description || splits.length === 0) {
          throw new Error("Parameters 'totalAmount', 'myShare', 'description', and 'splits' are required for action 'split'.");
        }

        // 1. Log net personal share
        const expenseId = await storage.createExpense({
          chatId,
          amount: myShare,
          category,
          description: `${description} (My Net Share)`,
        });

        // 2. Create pending reimbursements
        const reimbursementIds: number[] = [];
        for (const s of splits) {
          const id = await storage.createReimbursement({
            chatId,
            debtorName: s.name,
            amount: s.amount,
            description,
            status: "pending",
          });
          reimbursementIds.push(id);
        }

        const splitLines = splits.map((s) => `• **${s.name}**: SGD ${s.amount.toFixed(2)}`).join("\n");
        const totalOwed = splits.reduce((acc, s) => acc + s.amount, 0);

        return {
          success: true,
          expenseId,
          totalAmount,
          myShare,
          totalOwed,
          message: `💸 **Group Bill Split Successfully!**\n\n- **Total Bill Paid:** SGD ${totalAmount.toFixed(2)}\n- **Your Net Expense:** SGD ${myShare.toFixed(2)} (${category})\n- **Total Receivables:** SGD ${totalOwed.toFixed(2)}\n\n**Friend Debts Logged:**\n${splitLines}\n\nNexus will automatically match incoming PayNow/PayLah payments from these friends!`,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  } finally {
    await storage.close();
  }
}
