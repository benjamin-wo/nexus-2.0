import { StorageService, TaskEntry } from "../database/Storage";

export class TaskRegistry {
  private static instance: TaskRegistry | null = null;
  private abortControllers = new Map<string, AbortController>();
  private onTaskCompletedCallback:
    | ((taskId: string, chatId: string, description: string, success: boolean, resultOrError: any) => Promise<void>)
    | null = null;
  private onTaskUpdateCallback:
    | ((chatId: string, message: string) => Promise<void>)
    | null = null;

  private constructor() {}

  static getInstance(): TaskRegistry {
    if (!TaskRegistry.instance) {
      TaskRegistry.instance = new TaskRegistry();
    }
    return TaskRegistry.instance;
  }

  setCompletionCallback(
    callback: (taskId: string, chatId: string, description: string, success: boolean, resultOrError: any) => Promise<void>
  ) {
    this.onTaskCompletedCallback = callback;
  }

  /** Register a callback for mid-task live updates (e.g. Telegram push during polling loops) */
  setUpdateCallback(callback: (chatId: string, message: string) => Promise<void>) {
    this.onTaskUpdateCallback = callback;
  }

  /** Send a live update to the user's chat from inside a running task */
  async sendUpdate(chatId: string, message: string): Promise<void> {
    if (this.onTaskUpdateCallback) {
      try {
        await this.onTaskUpdateCallback(chatId, message);
      } catch (err) {
        console.error("[TaskRegistry] sendUpdate failed:", err);
      }
    }
  }

  generateTaskId(): string {
    return "task_" + Math.random().toString(36).substring(2, 8);
  }

  async startTask(
    chatId: string,
    description: string,
    runner: (signal: AbortSignal) => Promise<any>
  ): Promise<string> {
    const taskId = this.generateTaskId();
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    const storage = new StorageService();
    await storage.initialize();

    const taskEntry: TaskEntry = {
      taskId,
      chatId,
      status: "running",
      description,
      createdAt: new Date(),
    };

    await storage.createTask(taskEntry);
    await storage.close();

    // Launch execution asynchronously
    (async () => {
      let success = false;
      let output: any = null;
      const taskStorage = new StorageService();
      await taskStorage.initialize();

      try {
        output = await runner(controller.signal);
        success = true;
        await taskStorage.updateTaskStatus(taskId, "completed");
        await taskStorage.logEvent({
          category: "task_manager",
          message: `Task ${taskId} completed successfully`,
          isError: false,
        });
      } catch (error: any) {
        success = false;
        output = error.message || String(error);
        const currentStatus = (await taskStorage.getTask(taskId))?.status;
        
        if (currentStatus !== "cancelled") {
          await taskStorage.updateTaskStatus(taskId, "failed");
          await taskStorage.logEvent({
            category: "task_manager",
            message: `Task ${taskId} failed: ${output}`,
            isError: true,
          });
        } else {
          // If cancelled, leave as is
          output = "Task was explicitly cancelled.";
        }
      } finally {
        this.abortControllers.delete(taskId);
        await taskStorage.close();

        // Fire completion callback (e.g. to Telegram bot)
        if (this.onTaskCompletedCallback) {
          try {
            await this.onTaskCompletedCallback(taskId, chatId, description, success, output);
          } catch (callbackErr) {
            console.error("[TaskRegistry] Failed to execute task completion callback:", callbackErr);
          }
        }
      }
    })();

    return taskId;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const controller = this.abortControllers.get(taskId);
    
    const storage = new StorageService();
    await storage.initialize();
    
    try {
      const task = await storage.getTask(taskId);
      if (!task || task.status !== "running") {
        return false;
      }

      // Abort the running promise signal
      if (controller) {
        controller.abort();
        this.abortControllers.delete(taskId);
      }

      await storage.updateTaskStatus(taskId, "cancelled");
      await storage.logEvent({
        category: "task_manager",
        message: `Task ${taskId} was cancelled by user`,
        isError: false,
      });
      return true;
    } finally {
      await storage.close();
    }
  }

  async cancelTasksForChat(chatId: string): Promise<string[]> {
    const storage = new StorageService();
    await storage.initialize();
    try {
      const activeTasks = await storage.getActiveTasks(chatId);
      const cancelledIds: string[] = [];
      for (const t of activeTasks) {
        const ok = await this.cancelTask(t.taskId);
        if (ok) cancelledIds.push(t.taskId);
      }
      return cancelledIds;
    } finally {
      await storage.close();
    }
  }
}
