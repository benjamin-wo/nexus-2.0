import { StorageService } from "../../../src/database/Storage";

export async function execute(
  args: {
    action?: "save" | "list";
    title?: string;
    content?: string;
  },
  context?: { chatId: string; alias?: string }
) {
  const chatId = context?.chatId || "default_cli_chat";

  // Compatibility resolution for old aliases
  let action = args.action;
  if (context?.alias === "saveResearchNote") action = "save";
  if (context?.alias === "getResearchNotes") action = "list";

  if (!action) {
    if (args.title || args.content) {
      action = "save";
    } else {
      action = "list";
    }
  }

  const storage = new StorageService();
  await storage.initialize();

  try {
    switch (action) {
      case "save": {
        const title = args.title;
        const content = args.content;
        if (!title || !content) {
          throw new Error("Parameters 'title' and 'content' are required for action 'save'.");
        }

        const id = await storage.createResearchNote({
          chatId,
          title,
          content,
        });

        return {
          success: true,
          id,
          message: `Successfully saved research note: '${title}'`,
        };
      }

      case "list": {
        const notes = await storage.getResearchNotes(chatId);
        return { success: true, notes };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  } finally {
    await storage.close();
  }
}
