import { Database } from "bun:sqlite";
import pg from "pg";

export interface MediaAttachment {
  mimeType: string;
  data: string; // Base64 encoded string
}

export interface GoogleCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  subagent?: string;
  createdAt?: Date;
  media?: MediaAttachment[];
}

export interface Reminder {
  id?: number;
  chatId: string;
  message: string;
  dueAt: Date;
  sent: boolean;
  cronExpression?: string | null;
}

export interface LogEntry {
  category: string;
  message: string;
  details?: string;
  durationMs?: number;
  isError: boolean;
}

export interface TaskEntry {
  taskId: string;
  chatId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  description: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface Expense {
  id?: number;
  chatId: string;
  amount: number;
  category: string;
  description: string;
  createdAt?: Date | string;
}

export interface PendingExpense {
  id?: number;
  chatId: string;
  amount: number | null;
  category: string | null;
  description: string | null;
  paymentMode: string | null;
  rawData?: string;
  createdAt?: Date | string;
}

export interface ResearchNote {
  id?: number;
  chatId: string;
  title: string;
  content: string;
  createdAt?: Date;
}

export interface RuntimeSkill {
  id?: number;
  name: string;
  description: string;
  paramSchema: any;
  code: string;
  updatedAt?: Date;
}

export interface IStorage {
  initialize(): Promise<void>;
  saveMessage(chatId: string, message: Message): Promise<void>;
  getHistory(chatId: string, limit?: number): Promise<Message[]>;
  clearHistory(chatId: string): Promise<void>;
  createReminder(reminder: Reminder): Promise<number>;
  getPendingReminders(): Promise<Reminder[]>;
  markReminderSent(id: number): Promise<void>;
  updateReminderDueAt(id: number, nextDueAt: Date): Promise<void>;
  logEvent(log: LogEntry): Promise<void>;
  getRecentLogs(limit?: number): Promise<any[]>;
  getLogsPastHours(hours: number): Promise<any[]>;
  markLogsResolved(ids: number[]): Promise<void>;
  createTask(task: TaskEntry): Promise<void>;
  updateTaskStatus(taskId: string, status: TaskEntry["status"]): Promise<void>;
  getTask(taskId: string): Promise<TaskEntry | null>;
  getActiveTasks(chatId?: string): Promise<TaskEntry[]>;
  createExpense(expense: Expense): Promise<number>;
  getExpenses(chatId: string): Promise<Expense[]>;
  deleteExpense(id: number, chatId: string): Promise<void>;
  createPendingExpense(expense: PendingExpense): Promise<number>;
  getPendingExpense(id: number): Promise<PendingExpense | null>;
  deletePendingExpense(id: number): Promise<void>;
  createResearchNote(note: ResearchNote): Promise<number>;
  getResearchNotes(chatId: string): Promise<ResearchNote[]>;
  deleteResearchNote(id: number, chatId: string): Promise<void>;
  saveGoogleCredentials(chatId: string, credentials: GoogleCredentials): Promise<void>;
  getGoogleCredentials(chatId: string): Promise<GoogleCredentials | null>;
  getAllGoogleCredentials(): Promise<{chatId: string, credentials: GoogleCredentials}[]>;
  getSkills(): Promise<RuntimeSkill[]>;
  getSkill(name: string): Promise<RuntimeSkill | null>;
  insertSkill(name: string, description: string, paramSchema: any, code: string): Promise<void>;
  getThreadAssignment(threadId: number): Promise<string | null>;
  setThreadAssignment(threadId: number, workerName: string): Promise<void>;
  getProfileValue(key: string): Promise<any>;
  setProfileValue(key: string, value: any): Promise<void>;
  logEpisodicMemory(sessionId: string, interactionType: string, content: string): Promise<void>;
  checkAndSeedSkills(): Promise<void>;
  close(): Promise<void>;
}

export class StorageService implements IStorage {
  private static sharedPgPool: pg.Pool | null = null;
  private static sharedSqliteDb: Database | null = null;

  private pgPool: pg.Pool | null = null;
  private sqliteDb: Database | null = null;
  private isPostgres = false;

  constructor() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && dbUrl.trim() !== "") {
      const isLocalhost = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
      if (!StorageService.sharedPgPool) {
        StorageService.sharedPgPool = new pg.Pool({ 
          connectionString: dbUrl,
          ...(!isLocalhost && { ssl: { rejectUnauthorized: false } }),
          max: 10,
          idleTimeoutMillis: 30000,
        });
      }
      this.pgPool = StorageService.sharedPgPool;
      this.isPostgres = true;
    } else {
      if (!StorageService.sharedSqliteDb) {
        StorageService.sharedSqliteDb = new Database("assistant.db");
      }
      this.sqliteDb = StorageService.sharedSqliteDb;
      this.isPostgres = false;
    }
  }

  async initialize(): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      // PostgreSQL initialization
      const client = await this.pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS conversations (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            subagent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          
          CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            message TEXT NOT NULL,
            due_at TIMESTAMP NOT NULL,
            sent BOOLEAN DEFAULT FALSE,
            cron_expression TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          
          ALTER TABLE reminders ADD COLUMN IF NOT EXISTS cron_expression TEXT;
          
          CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY,
            category TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            duration_ms INTEGER,
            is_error BOOLEAN DEFAULT FALSE,
            resolved BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          
          -- Migration: add resolved to logs if missing
          ALTER TABLE logs ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT FALSE;
          
          CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            status TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            completed_at TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS pending_expenses (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            amount DOUBLE PRECISION,
            category TEXT,
            description TEXT,
            payment_mode TEXT,
            raw_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS research_notes (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS google_credentials (
            chat_id TEXT PRIMARY KEY,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expiry_date BIGINT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS runtime_skills (
              id SERIAL PRIMARY KEY,
              name VARCHAR(100) UNIQUE NOT NULL,
              description TEXT NOT NULL,
              param_schema JSONB NOT NULL,
              code TEXT NOT NULL,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS thread_assignments (
              thread_id BIGINT PRIMARY KEY,
              worker_name VARCHAR(100) NOT NULL,
              pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS user_profile (
              id SERIAL PRIMARY KEY,
              key VARCHAR(255) UNIQUE NOT NULL,
              value JSONB NOT NULL,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS episodic_memory (
              id SERIAL PRIMARY KEY,
              session_id VARCHAR(255), 
              interaction_type VARCHAR(50),
              content TEXT NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } finally {
        client.release();
      }
    } else if (this.sqliteDb) {
      // SQLite initialization
      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          subagent TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          message TEXT NOT NULL,
          due_at DATETIME NOT NULL,
          sent BOOLEAN DEFAULT FALSE,
          cron_expression TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      try {
        this.sqliteDb.run("ALTER TABLE reminders ADD COLUMN cron_expression TEXT;");
      } catch (_) {}

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          message TEXT NOT NULL,
          details TEXT,
          duration_ms INTEGER,
          is_error BOOLEAN DEFAULT FALSE,
          resolved BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // SQLite migration: try adding resolved to logs if missing
      try {
        this.sqliteDb.run("ALTER TABLE logs ADD COLUMN resolved BOOLEAN DEFAULT FALSE;");
      } catch (err: any) {
        // If it fails, the column likely already exists. SQLite throws 'duplicate column name' error.
      }

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          status TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at DATETIME NOT NULL,
          completed_at DATETIME
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS pending_expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          amount REAL,
          category TEXT,
          description TEXT,
          payment_mode TEXT,
          raw_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS research_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS google_credentials (
          chat_id TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expiry_date INTEGER NOT NULL
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS runtime_skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(100) UNIQUE NOT NULL,
            description TEXT NOT NULL,
            param_schema TEXT NOT NULL,
            code TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS thread_assignments (
            thread_id INTEGER PRIMARY KEY,
            worker_name VARCHAR(100) NOT NULL,
            pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key VARCHAR(255) UNIQUE NOT NULL,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS episodic_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id VARCHAR(255), 
            interaction_type VARCHAR(50),
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  }

  async saveMessage(chatId: string, message: Message): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        "INSERT INTO conversations (chat_id, role, content, subagent) VALUES ($1, $2, $3, $4)",
        [chatId, message.role, message.content, message.subagent || null]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          "INSERT INTO conversations (chat_id, role, content, subagent) VALUES (?, ?, ?, ?)"
        )
        .run(chatId, message.role, message.content, message.subagent || null);
    }
  }

  async getHistory(chatId: string, limit = 50): Promise<Message[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT role, content, subagent, created_at FROM conversations WHERE chat_id = $1 ORDER BY id DESC LIMIT $2",
        [chatId, limit]
      );
      return res.rows
        .map((row: any) => ({
          role: row.role as Message["role"],
          content: row.content,
          subagent: row.subagent || undefined,
          createdAt: new Date(row.created_at),
        }))
        .reverse();
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT role, content, subagent, created_at FROM conversations WHERE chat_id = ? ORDER BY id DESC LIMIT ?"
        )
        .all(chatId, limit) as any[];
      return rows
        .map((row) => ({
          role: row.role as Message["role"],
          content: row.content,
          subagent: row.subagent || undefined,
          createdAt: new Date(row.created_at),
        }))
        .reverse();
    }
    return [];
  }

  async clearHistory(chatId: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("DELETE FROM conversations WHERE chat_id = $1", [chatId]);
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare("DELETE FROM conversations WHERE chat_id = ?").run(chatId);
    }
  }

  async createReminder(reminder: Reminder): Promise<number> {
    const dueStr = reminder.dueAt.toISOString();
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "INSERT INTO reminders (chat_id, message, due_at, sent, cron_expression) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [reminder.chatId, reminder.message, dueStr, reminder.sent ? true : false, reminder.cronExpression || null]
      );
      return res.rows[0].id;
    } else if (this.sqliteDb) {
      const res = this.sqliteDb
        .prepare(
          "INSERT INTO reminders (chat_id, message, due_at, sent, cron_expression) VALUES (?, ?, ?, ?, ?) RETURNING id"
        )
        .get(reminder.chatId, reminder.message, dueStr, reminder.sent ? 1 : 0, reminder.cronExpression || null) as any;
      return res.id;
    }
    return 0;
  }

  async getPendingReminders(): Promise<Reminder[]> {
    const nowStr = new Date().toISOString();
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, chat_id, message, due_at, sent, cron_expression FROM reminders WHERE sent = FALSE AND due_at <= $1",
        [nowStr]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        message: row.message,
        dueAt: new Date(row.due_at),
        sent: row.sent,
        cronExpression: row.cron_expression || undefined,
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT id, chat_id, message, due_at, sent, cron_expression FROM reminders WHERE sent = 0 AND due_at <= ?"
        )
        .all(nowStr) as any[];
      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        message: row.message,
        dueAt: new Date(row.due_at),
        sent: row.sent === 1 || row.sent === true,
        cronExpression: row.cron_expression || undefined,
      }));
    }
    return [];
  }

  async markReminderSent(id: number): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("UPDATE reminders SET sent = TRUE WHERE id = $1", [id]);
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare("UPDATE reminders SET sent = 1 WHERE id = ?").run(id);
    }
  }

  async updateReminderDueAt(id: number, nextDueAt: Date): Promise<void> {
    const dueStr = nextDueAt.toISOString();
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("UPDATE reminders SET due_at = $1, sent = FALSE WHERE id = $2", [dueStr, id]);
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare("UPDATE reminders SET due_at = ?, sent = 0 WHERE id = ?").run(dueStr, id);
    }
  }

  async getUserReminders(chatId: string): Promise<Reminder[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, chat_id, message, due_at, sent, cron_expression FROM reminders WHERE chat_id = $1 ORDER BY due_at ASC",
        [chatId]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        message: row.message,
        dueAt: new Date(row.due_at),
        sent: row.sent,
        cronExpression: row.cron_expression || undefined,
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT id, chat_id, message, due_at, sent, cron_expression FROM reminders WHERE chat_id = ? ORDER BY due_at ASC"
        )
        .all(chatId) as any[];
      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        message: row.message,
        dueAt: new Date(row.due_at),
        sent: row.sent === 1 || row.sent === true,
        cronExpression: row.cron_expression || undefined,
      }));
    }
    return [];
  }

  async deleteReminder(id: number): Promise<boolean> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query("DELETE FROM reminders WHERE id = $1", [id]);
      return (res.rowCount || 0) > 0;
    } else if (this.sqliteDb) {
      const info = this.sqliteDb.prepare("DELETE FROM reminders WHERE id = ?").run(id);
      return info.changes > 0;
    }
    return false;
  }

  async logEvent(log: LogEntry): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        "INSERT INTO logs (category, message, details, duration_ms, is_error) VALUES ($1, $2, $3, $4, $5)",
        [
          log.category,
          log.message,
          log.details || null,
          log.durationMs !== undefined ? log.durationMs : null,
          log.isError,
        ]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          "INSERT INTO logs (category, message, details, duration_ms, is_error) VALUES (?, ?, ?, ?, ?)"
        )
        .run(
          log.category,
          log.message,
          log.details || null,
          log.durationMs !== undefined ? log.durationMs : null,
          log.isError ? 1 : 0
        );
    }
  }

  async getRecentLogs(limit: number = 50): Promise<any[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, category, message, details, duration_ms as \"durationMs\", is_error as \"isError\", created_at as \"createdAt\" FROM logs ORDER BY created_at DESC, id DESC LIMIT $1",
        [limit]
      );
      return res.rows;
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT id, category, message, details, duration_ms as durationMs, is_error as isError, created_at as createdAt FROM logs ORDER BY created_at DESC, id DESC LIMIT ?"
        )
        .all(limit) as any[];
      return rows.map((r) => ({
        ...r,
        isError: Boolean(r.isError),
      }));
    }
    return [];
  }

  async getLogsPastHours(hours: number): Promise<any[]> {
    if (this.isPostgres && this.pgPool) {
      // Postgres interval calculation
      const res = await this.pgPool.query(
        `SELECT id, category, message, details, duration_ms as "durationMs", is_error as "isError", created_at as "createdAt" 
         FROM logs 
         WHERE created_at >= NOW() - interval '1 hour' * $1 
         AND (is_error = TRUE OR category = 'IMPROVEMENT' OR category = 'TELEGRAM_GLOBAL_ERROR' OR category = 'TELEGRAM_MESSAGE_ERROR')
         AND (resolved = FALSE OR resolved IS NULL)
         ORDER BY created_at ASC`,
        [hours]
      );
      return res.rows;
    } else if (this.sqliteDb) {
      // SQLite datetime calculation
      const rows = this.sqliteDb
        .prepare(
          `SELECT id, category, message, details, duration_ms as durationMs, is_error as isError, created_at as createdAt 
           FROM logs 
           WHERE created_at >= datetime('now', '-' || ? || ' hours')
           AND (is_error = 1 OR category = 'IMPROVEMENT' OR category = 'TELEGRAM_GLOBAL_ERROR' OR category = 'TELEGRAM_MESSAGE_ERROR')
           AND (resolved = 0 OR resolved IS NULL)
           ORDER BY created_at ASC`
        )
        .all(hours) as any[];
      return rows.map((r) => ({
        ...r,
        isError: Boolean(r.isError),
      }));
    }
    return [];
  }

  async markLogsResolved(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    
    if (this.isPostgres && this.pgPool) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      await this.pgPool.query(
        `UPDATE logs SET resolved = TRUE WHERE id IN (${placeholders})`,
        ids
      );
    } else if (this.sqliteDb) {
      const placeholders = ids.map(() => "?").join(",");
      this.sqliteDb.run(
        `UPDATE logs SET resolved = 1 WHERE id IN (${placeholders})`,
        ids
      );
    }
  }

  async createTask(task: TaskEntry): Promise<void> {
    const createdStr = task.createdAt.toISOString();
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        "INSERT INTO tasks (task_id, chat_id, status, description, created_at) VALUES ($1, $2, $3, $4, $5)",
        [task.taskId, task.chatId, task.status, task.description, createdStr]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          "INSERT INTO tasks (task_id, chat_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(task.taskId, task.chatId, task.status, task.description, createdStr);
    }
  }

  async updateTaskStatus(taskId: string, status: TaskEntry["status"]): Promise<void> {
    const completedStr =
      status === "completed" || status === "failed" || status === "cancelled"
        ? new Date().toISOString()
        : null;

    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        "UPDATE tasks SET status = $1, completed_at = $2 WHERE task_id = $3",
        [status, completedStr, taskId]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare("UPDATE tasks SET status = ?, completed_at = ? WHERE task_id = ?")
        .run(status, completedStr, taskId);
    }
  }

  async getTask(taskId: string): Promise<TaskEntry | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT task_id, chat_id, status, description, created_at, completed_at FROM tasks WHERE task_id = $1",
        [taskId]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        taskId: row.task_id,
        chatId: row.chat_id,
        status: row.status as TaskEntry["status"],
        description: row.description,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      };
    } else if (this.sqliteDb) {
      const row = this.sqliteDb
        .prepare(
          "SELECT task_id, chat_id, status, description, created_at, completed_at FROM tasks WHERE task_id = ?"
        )
        .get(taskId) as any;
      if (!row) return null;
      return {
        taskId: row.task_id,
        chatId: row.chat_id,
        status: row.status as TaskEntry["status"],
        description: row.description,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      };
    }
    return null;
  }

  async getActiveTasks(chatId?: string): Promise<TaskEntry[]> {
    if (this.isPostgres && this.pgPool) {
      let query = "SELECT task_id, chat_id, status, description, created_at, completed_at FROM tasks WHERE status = 'running'";
      let params: any[] = [];
      if (chatId) {
        query += " AND chat_id = $1";
        params.push(chatId);
      }
      const res = await this.pgPool.query(query, params);
      return res.rows.map((row: any) => ({
        taskId: row.task_id,
        chatId: row.chat_id,
        status: row.status as TaskEntry["status"],
        description: row.description,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      }));
    } else if (this.sqliteDb) {
      let query = "SELECT task_id, chat_id, status, description, created_at, completed_at FROM tasks WHERE status = 'running'";
      let params: any[] = [];
      if (chatId) {
        query += " AND chat_id = ?";
        params.push(chatId);
      }
      const rows = this.sqliteDb.prepare(query).all(...params) as any[];
      return rows.map((row) => ({
        taskId: row.task_id,
        chatId: row.chat_id,
        status: row.status as TaskEntry["status"],
        description: row.description,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      }));
    }
    return [];
  }

  async createExpense(expense: Expense): Promise<number> {
    const createdStr = expense.createdAt 
      ? (expense.createdAt instanceof Date ? expense.createdAt.toISOString() : new Date(expense.createdAt).toISOString())
      : new Date().toISOString();

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "INSERT INTO expenses (chat_id, amount, category, description, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [expense.chatId, expense.amount, expense.category, expense.description, createdStr]
      );
      return res.rows[0].id;
    } else if (this.sqliteDb) {
      const res = this.sqliteDb
        .prepare(
          "INSERT INTO expenses (chat_id, amount, category, description, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id"
        )
        .get(expense.chatId, expense.amount, expense.category, expense.description, createdStr) as any;
      return res.id;
    }
    return 0;
  }

  async getExpenses(chatId: string): Promise<Expense[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, chat_id, amount, category, description, created_at FROM expenses WHERE chat_id = $1 ORDER BY id DESC",
        [chatId]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        amount: Number(row.amount),
        category: row.category,
        description: row.description,
        createdAt: new Date(row.created_at),
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT id, chat_id, amount, category, description, created_at FROM expenses WHERE chat_id = ? ORDER BY id DESC"
        )
        .all(chatId) as any[];
      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        amount: Number(row.amount),
        category: row.category,
        description: row.description,
        createdAt: new Date(row.created_at),
      }));
    }
    return [];
  }

  async deleteExpense(id: number, chatId: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("DELETE FROM expenses WHERE id = $1 AND chat_id = $2", [id, chatId]);
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare("DELETE FROM expenses WHERE id = ? AND chat_id = ?")
        .run(id, chatId);
    }
  }

  async createPendingExpense(expense: PendingExpense): Promise<number> {
    const createdStr = expense.createdAt 
      ? (expense.createdAt instanceof Date ? expense.createdAt.toISOString() : new Date(expense.createdAt).toISOString())
      : new Date().toISOString();

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "INSERT INTO pending_expenses (chat_id, amount, category, description, payment_mode, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [expense.chatId, expense.amount, expense.category, expense.description, expense.paymentMode, expense.rawData || null, createdStr]
      );
      return res.rows[0].id;
    } else if (this.sqliteDb) {
      const res = this.sqliteDb
        .prepare(
          "INSERT INTO pending_expenses (chat_id, amount, category, description, payment_mode, raw_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id"
        )
        .get(expense.chatId, expense.amount, expense.category, expense.description, expense.paymentMode, expense.rawData || null, createdStr) as any;
      return res.id;
    }
    return 0;
  }

  async getPendingExpense(id: number): Promise<PendingExpense | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, chat_id, amount, category, description, payment_mode, raw_data, created_at FROM pending_expenses WHERE id = $1",
        [id]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        chatId: row.chat_id,
        amount: row.amount !== null ? Number(row.amount) : null,
        category: row.category,
        description: row.description,
        paymentMode: row.payment_mode,
        rawData: row.raw_data,
        createdAt: new Date(row.created_at),
      };
    } else if (this.sqliteDb) {
      const row = this.sqliteDb
        .prepare(
          "SELECT id, chat_id, amount, category, description, payment_mode, raw_data, created_at FROM pending_expenses WHERE id = ?"
        )
        .get(id) as any;
      if (!row) return null;
      return {
        id: row.id,
        chatId: row.chat_id,
        amount: row.amount !== null ? Number(row.amount) : null,
        category: row.category,
        description: row.description,
        paymentMode: row.payment_mode,
        rawData: row.raw_data,
        createdAt: new Date(row.created_at),
      };
    }
    return null;
  }

  async deletePendingExpense(id: number): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("DELETE FROM pending_expenses WHERE id = $1", [id]);
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare("DELETE FROM pending_expenses WHERE id = ?")
        .run(id);
    }
  }

  async createResearchNote(note: ResearchNote): Promise<number> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "INSERT INTO research_notes (chat_id, title, content) VALUES ($1, $2, $3) RETURNING id",
        [note.chatId, note.title, note.content]
      );
      return res.rows[0].id;
    } else if (this.sqliteDb) {
      const res = this.sqliteDb
        .prepare(
          "INSERT INTO research_notes (chat_id, title, content) VALUES (?, ?, ?) RETURNING id"
        )
        .get(note.chatId, note.title, note.content) as any;
      return res.id;
    }
    return 0;
  }

  async getResearchNotes(chatId: string): Promise<ResearchNote[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT id, chat_id, title, content, created_at FROM research_notes WHERE chat_id = $1 ORDER BY id DESC",
        [chatId]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        chatId: row.chat_id,
        title: row.title,
        content: row.content,
        createdAt: new Date(row.created_at),
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare(
          "SELECT id, chat_id, title, content, created_at FROM research_notes WHERE chat_id = ? ORDER BY id DESC"
        )
        .all(chatId) as any[];
      return rows.map((row) => ({
        id: row.id,
        chatId: row.chat_id,
        title: row.title,
        content: row.content,
        createdAt: new Date(row.created_at),
      }));
    }
    return [];
  }

  async deleteResearchNote(id: number, chatId: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query("DELETE FROM research_notes WHERE id = $1 AND chat_id = $2", [id, chatId]);
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare("DELETE FROM research_notes WHERE id = ? AND chat_id = ?")
        .run(id, chatId);
    }
  }

  async saveGoogleCredentials(chatId: string, credentials: GoogleCredentials): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO google_credentials (chat_id, access_token, refresh_token, expiry_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chat_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             refresh_token = CASE WHEN EXCLUDED.refresh_token <> '' THEN EXCLUDED.refresh_token ELSE google_credentials.refresh_token END,
             expiry_date = EXCLUDED.expiry_date`,
        [chatId, credentials.access_token, credentials.refresh_token, credentials.expiry_date]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO google_credentials (chat_id, access_token, refresh_token, expiry_date)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET
             access_token = excluded.access_token,
             refresh_token = CASE WHEN excluded.refresh_token <> '' THEN excluded.refresh_token ELSE google_credentials.refresh_token END,
             expiry_date = excluded.expiry_date`
        )
        .run(chatId, credentials.access_token, credentials.refresh_token, credentials.expiry_date);
    }
  }

  async getGoogleCredentials(chatId: string): Promise<GoogleCredentials | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT access_token, refresh_token, expiry_date FROM google_credentials WHERE chat_id = $1",
        [chatId]
      );
      if (res.rows.length === 0) return null;
      return {
        access_token: res.rows[0].access_token,
        refresh_token: res.rows[0].refresh_token,
        expiry_date: Number(res.rows[0].expiry_date),
      };
    } else if (this.sqliteDb) {
      const row = this.sqliteDb
        .prepare("SELECT access_token, refresh_token, expiry_date FROM google_credentials WHERE chat_id = ?")
        .get(chatId) as any;
      if (!row) return null;
      return {
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        expiry_date: Number(row.expiry_date),
      };
    }
    return null;
  }

  async getAllGoogleCredentials(): Promise<{chatId: string, credentials: GoogleCredentials}[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "SELECT chat_id, access_token, refresh_token, expiry_date FROM google_credentials"
      );
      return res.rows.map((row: any) => ({
        chatId: row.chat_id,
        credentials: {
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expiry_date: Number(row.expiry_date),
        }
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb
        .prepare("SELECT chat_id, access_token, refresh_token, expiry_date FROM google_credentials")
        .all() as any[];
      return rows.map((row) => ({
        chatId: row.chat_id,
        credentials: {
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expiry_date: Number(row.expiry_date),
        }
      }));
    }
    return [];
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
  }

  async getSkills(): Promise<RuntimeSkill[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query("SELECT * FROM runtime_skills");
      return res.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        paramSchema: typeof r.param_schema === "string" ? JSON.parse(r.param_schema) : r.param_schema,
        code: r.code,
        updatedAt: new Date(r.updated_at)
      }));
    } else if (this.sqliteDb) {
      const rows = this.sqliteDb.prepare("SELECT * FROM runtime_skills").all() as any[];
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        paramSchema: JSON.parse(r.param_schema),
        code: r.code,
        updatedAt: new Date(r.updated_at)
      }));
    }
    return [];
  }

  async getSkill(name: string): Promise<RuntimeSkill | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query("SELECT * FROM runtime_skills WHERE name = $1", [name]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        paramSchema: typeof r.param_schema === "string" ? JSON.parse(r.param_schema) : r.param_schema,
        code: r.code,
        updatedAt: new Date(r.updated_at)
      };
    } else if (this.sqliteDb) {
      const r = this.sqliteDb.prepare("SELECT * FROM runtime_skills WHERE name = ?").get(name) as any;
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        paramSchema: JSON.parse(r.param_schema),
        code: r.code,
        updatedAt: new Date(r.updated_at)
      };
    }
    return null;
  }

  async insertSkill(name: string, description: string, paramSchema: any, code: string): Promise<void> {
    const schemaStr = JSON.stringify(paramSchema);
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO runtime_skills (name, description, param_schema, code) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE 
         SET description = EXCLUDED.description, param_schema = EXCLUDED.param_schema, code = EXCLUDED.code, updated_at = CURRENT_TIMESTAMP`,
        [name, description, schemaStr, code]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare(
        `INSERT INTO runtime_skills (name, description, param_schema, code) 
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET 
         description = excluded.description, param_schema = excluded.param_schema, code = excluded.code, updated_at = CURRENT_TIMESTAMP`
      ).run(name, description, schemaStr, code);
    }
  }

  async getThreadAssignment(threadId: number): Promise<string | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query("SELECT worker_name FROM thread_assignments WHERE thread_id = $1", [threadId]);
      if (res.rows.length === 0) return null;
      return res.rows[0].worker_name;
    } else if (this.sqliteDb) {
      const r = this.sqliteDb.prepare("SELECT worker_name FROM thread_assignments WHERE thread_id = ?").get(threadId) as any;
      if (!r) return null;
      return r.worker_name;
    }
    return null;
  }

  async setThreadAssignment(threadId: number, workerName: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO thread_assignments (thread_id, worker_name) VALUES ($1, $2)
         ON CONFLICT (thread_id) DO UPDATE SET worker_name = EXCLUDED.worker_name, pinned_at = CURRENT_TIMESTAMP`,
        [threadId, workerName]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare(
        `INSERT INTO thread_assignments (thread_id, worker_name) VALUES (?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET worker_name = excluded.worker_name, pinned_at = CURRENT_TIMESTAMP`
      ).run(threadId, workerName);
    }
  }

  async getProfileValue(key: string): Promise<any> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query("SELECT value FROM user_profile WHERE key = $1", [key]);
      if (res.rows.length === 0) return null;
      return typeof res.rows[0].value === "string" ? JSON.parse(res.rows[0].value) : res.rows[0].value;
    } else if (this.sqliteDb) {
      const r = this.sqliteDb.prepare("SELECT value FROM user_profile WHERE key = ?").get(key) as any;
      if (!r) return null;
      return JSON.parse(r.value);
    }
    return null;
  }

  async setProfileValue(key: string, value: any): Promise<void> {
    const valStr = JSON.stringify(value);
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO user_profile (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, valStr]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare(
        `INSERT INTO user_profile (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).run(key, valStr);
    }
  }

  async logEpisodicMemory(sessionId: string, interactionType: string, content: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        "INSERT INTO episodic_memory (session_id, interaction_type, content) VALUES ($1, $2, $3)",
        [sessionId, interactionType, content]
      );
    } else if (this.sqliteDb) {
      this.sqliteDb.prepare(
        "INSERT INTO episodic_memory (session_id, interaction_type, content) VALUES (?, ?, ?)"
      ).run(sessionId, interactionType, content);
    }
  }

  async checkAndSeedSkills(): Promise<void> {
    const fs = require("fs");
    const path = require("path");
    const YAML = require("yaml");

    const skills = await this.getSkills();
    if (skills.length > 0) return; // Already seeded

    const skillsDir = path.join(process.cwd(), ".agent", "skills");
    if (!fs.existsSync(skillsDir)) return;

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      const mdPath = path.join(skillsDir, skillName, "SKILL.md");
      const tsPath = path.join(skillsDir, skillName, "handler.ts");

      if (!fs.existsSync(mdPath) || !fs.existsSync(tsPath)) continue;

      try {
        const mdText = fs.readFileSync(mdPath, "utf-8");
        const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        
        if (!match) {
          console.log(`[Storage] Failed to extract frontmatter for '${skillName}'`);
          continue;
        }

        const frontmatterStr = match[1];
        const frontmatter = YAML.parse(frontmatterStr);

        const name = frontmatter.name || skillName;
        const description = frontmatter.description || "";
        const parameters = frontmatter.parameters || { type: "object", properties: {} };
        const code = fs.readFileSync(tsPath, "utf-8");

        await this.insertSkill(name, description, parameters, code);
        console.log(`[Storage] Seeded skill '${name}' into database.`);
      } catch (err: any) {
        console.error(`[Storage] Failed to seed skill '${skillName}':`, err.message);
      }
    }
  }

  async close(force = false): Promise<void> {
    if (force) {
      if (StorageService.sharedPgPool) {
        await StorageService.sharedPgPool.end();
        StorageService.sharedPgPool = null;
      }
      if (StorageService.sharedSqliteDb) {
        StorageService.sharedSqliteDb.close();
        StorageService.sharedSqliteDb = null;
      }
    }
  }
}
