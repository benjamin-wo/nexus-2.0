import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: {
    totalAmount: number;
    myShare: number;
    category?: string;
    description: string;
    splits: { name: string; amount: number }[];
  },
  context?: { chatId: string }
) {
  const chatId = context?.chatId || "default_cli_chat";
  const { totalAmount, myShare, category = "Food", description, splits } = args;

  const storage = new StorageService();
  await storage.initialize();

  try {
    // 1. Log net personal share to expenses table
    const expenseId = await storage.createExpense({
      chatId,
      amount: myShare,
      category,
      description: `${description} (My Net Share)`,
    });

    // 2. Create pending reimbursement entries for each friend
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
  } finally {
    await storage.close();
  }
}
