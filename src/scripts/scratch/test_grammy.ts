// @ts-nocheck
import { Bot } from "grammy";
import { config } from "dotenv";
config();
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "");
async function run() {
  try {
    await bot.api.sendMessage(process.env.TEST_CHAT_ID || "1004331094172", "Test", {
      reply_markup: {
        inline_keyboard: [[ { text: "test" } as any ]]
      }
    });
    console.log("Empty button success");
  } catch (e: any) {
    console.log("Empty button error:", e.message);
  }
}
run();
