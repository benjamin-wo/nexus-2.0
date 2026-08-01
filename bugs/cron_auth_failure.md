# Bug Incident Report: Background Cron Authentication & Task Routing Failure

## Status
- **State:** Resolved
- **Date:** 2026-08-01
- **Component:** `Scheduler.ts` / `telegram.ts` / `screenshotPage/handler.ts`
- **Fix Commit:** Pending

## Error Traceback
```
❌ Cron failure: background task [TASK] pollEmails failed to trigger at scheduled time (10:00 AM).
Diagnostic Findings reported by Nexus Assistant:
- "The reminder / schedule service is currently experiencing a synchronization lag with the primary event loop. It is failing to execute tasks that require external API authentication (like pollEmails) in the background."
- "The Root Cause: The background worker lacks the persistent OAuth session tokens required to access your Gmail/Outlook accounts without an active user session."
```

## Root Cause Analysis
1. **Task Prefix Routing Bug (`Scheduler.ts` & `telegram.ts`)**:
   - In `src/services/Scheduler.ts`, `processReminders()` prepended reminder formatting strings (`⏰ **Recurring Reminder:** ` or `🔔 **Reminder:** `) to all reminder messages before emitting them via `onReminderTrigger(chatId, message)`.
   - In `src/telegram.ts`, the scheduler callback checked `if (message.startsWith("[TASK]"))`. Because scheduled tasks arrived prefixed with reminder markdown (e.g., `⏰ **Recurring Reminder:** [TASK] pollEmails`), `startsWith("[TASK]")` always evaluated to `false`.
   - As a result, `orchestrator.processMessage` was never invoked for scheduled background tasks; only a static Telegram chat message was sent.
2. **LLM Hallucinated "OAuth Session Token Persistence"**:
   - When the user asked why the 10:00 AM cron job failed to poll emails, Nexus Assistant lacked direct code visibility into why `[TASK]` was ignored.
   - The LLM hallucinated a plausible-sounding diagnosis claiming that the background worker "lacks persistent OAuth session tokens required to access Gmail/Outlook accounts without an active user session."
   - In reality, Google and Microsoft OAuth credentials (`access_token`, `refresh_token`) are persistently stored per `chatId` in SQLite/PostgreSQL (`StorageService`) and are automatically refreshed via `refreshGoogleToken` / `refreshOutlookToken` when expired.

## Resolution
1. **Unmodified Task Payload Routing (`Scheduler.ts`)**:
   - Updated `processReminders()` in `src/services/Scheduler.ts` to detect whether `item.message` starts with `[TASK]`. If `isTask` is true, the raw message is passed directly to `onReminderTrigger(chatId, payloadText)` without prepending reminder prefixes.
2. **Hardened `[TASK]` Matching (`telegram.ts`)**:
   - Updated `scheduler.start(...)` in `src/telegram.ts` to use regex matching (`/(?:⏰ \*\*Recurring Reminder:\*\* |🔔 \*\*Reminder:\*\* )?\[TASK\]\s*(.+)/i`), ensuring any scheduled task string containing `[TASK]` is properly stripped and routed to `orchestrator.processMessage(chatId, promptText, undefined)`.
3. **Cross-Platform Screenshot Rendering Fix (`screenshotPage/handler.ts`)**:
   - Fixed macOS development compatibility in `screenshotPage/handler.ts` by using local Google Chrome binary paths and clean launch arguments (`--no-sandbox`, `--disable-setuid-sandbox`), resolving pipeline timeouts and `ENOEXEC` crashes.
4. **Verification**:
   - Executed the automated verification pipeline (`bun run src/test_pipeline.ts`), confirming all 17 dynamic skills, file operations, database adapters, and self-evolution checks pass cleanly.
