// Global notification bridge so long-running pollers / skills can push
// messages (including interactive keyboards) to the user even when they
// don't hold a direct reference to the Telegram Bot instance.
//
// telegram.ts calls setTelegramNotifier() at startup with a wrapper around
// bot.api.sendMessage. Code paths that only have a chatId (e.g. the email
// pollers invoked from the email skill) can then use notifyUser().

export type NotifyOptions = Record<string, any>;
export type NotifyFn = (chatId: string, text: string, opts?: NotifyOptions) => Promise<void>;

let notifyFn: NotifyFn | null = null;

export function setTelegramNotifier(fn: NotifyFn | null): void {
  notifyFn = fn;
}

export async function notifyUser(chatId: string, text: string, opts?: NotifyOptions): Promise<void> {
  if (notifyFn) {
    await notifyFn(chatId, text, opts);
  }
}
