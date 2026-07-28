import { execute as runTemplate } from "./htmlAnythingHelper";
import { execute as runHost } from "./hostHelper";
import { execute as runReview } from "./reviewHelper";

export async function execute(
  args: {
    action?: "template" | "host" | "review";
    layoutType?: "magazine" | "keynote" | "socialCard" | "dataReport" | "itinerary";
    fileName?: string;
    htmlContent?: string;
    targetFile?: string;
  },
  context?: { chatId: string; alias?: string }
) {
  let action = args.action;

  // Compatibility resolution for old aliases
  if (context?.alias === "htmlAnything") action = "template";
  if (context?.alias === "hostHtmlPage") action = "host";
  if (context?.alias === "web-design-guidelines") action = "review";

  // Heuristic checks
  if (!action) {
    if (args.htmlContent || args.fileName) {
      action = "host";
    } else if (args.targetFile) {
      action = "review";
    } else {
      action = "template";
    }
  }

  switch (action) {
    case "template":
      if (!args.layoutType) {
        throw new Error("Parameter 'layoutType' is required for action 'template'.");
      }
      return runTemplate({ layoutType: args.layoutType });

    case "host":
      if (!args.fileName || !args.htmlContent) {
        throw new Error("Parameters 'fileName' and 'htmlContent' are required for action 'host'.");
      }
      return runHost({ fileName: args.fileName, htmlContent: args.htmlContent });

    case "review":
      if (!args.targetFile) {
        throw new Error("Parameter 'targetFile' is required for action 'review'.");
      }
      return runReview({ targetFile: args.targetFile });

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
