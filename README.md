# Nexus 2.0

A production-hardened, self-evolving personal assistant built with **Bun** and **TypeScript**. Features a unified flat cognitive engine, database-backed dynamic skill registry, automated DevOps self-repair loops, Telegram bot integration, and PostgreSQL/SQLite persistence.

---

## 🏗️ System Architecture

Nexus 2.0 optimizes the reasoning layer by collapsing sub-agent hierarchies into a single, high-performance cognitive loop.

```
                    ┌────────────────────────┐
                    │  User Input (TG / CLI) │
                    └───────────┬────────────┘
                                │
                                ▼
                     ┌──────────────────────┐
                     │  Orchestrator Router │
                     └──────────┬───────────┘
                                │
                                ▼
                     ┌──────────────────────┐
                     │  Flat Worker Agent   │
                     │  (ReAct Loop, t<=8)  │
                     └──────────┬───────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
           Verify thoughts                Call skills
```

### 1. Unified Flat Cognitive Engine
- **Flat ReAct Loop (`src/core/WorkerAgent.ts`)**: Spawns a single executor directly loaded with personality traits, global behavior constraints, formatting rules, and all available tool instructions.
- **Circuit Breakers & Fallbacks (`src/core/LlmService.ts`)**: Routes LLM calls safely using retry loops, provider failovers (Gemini ⇆ DeepSeek), and maps/calculator fast-paths.

### 2. Dynamic Skill Registry & Self-Evolution
- **Skill Registry (`src/core/SkillRegistry.ts`)**: Compiles and hot-loads dynamic code from database records at runtime using `Bun.Transpiler()`, bypassing local filesystem cloud restrictions.
- **DevOps Self-Healing**: Detects execution loop crashes and schedules the agent to analyze crash logs, auto-generate patches, and reload the registry dynamically.

### 3. Deep Performance Optimizations
- **Concurrency Protection**: SQLite WAL (Write-Ahead Logging) mode enabled to prevent write locks during parallel background polling jobs.
- **Token Pruning**: Automatically truncates chat history payloads to 3000 characters to optimize context usage.
- **Robust Delivery**: Telegram safe sender fallback wrapper to deliver messages as unformatted text if formatting tags fail parsing constraints.

---

## 📁 Repository Directory Structure

```
├── .env.example
├── tsconfig.json
├── package.json
├── README.md
├── .agent/                   # Cognitive instructions & configurations
│   ├── behavior.md           # Global agent rules and telegram formatting
│   ├── guardrails.md         # Safety and file access sandbox rules
│   ├── soul.md               # Personality, values, and tone guidelines
│   └── skills/               # Core dynamic skills (SKILL.md + handler.ts)
├── src/                      # TypeScript implementation
│   ├── cli.ts                # Terminal REPL entrypoint
│   ├── telegram.ts           # Telegram bot bot & Bun web server
│   ├── test_pipeline.ts      # Mechanical verification suite
│   ├── test_evals.ts         # E2E capability evaluations (reminders/hosting)
│   ├── test_telegram_formatting.ts # Telegram output validation sandbox
│   ├── core/                 # Orchestrator, WorkerAgent, LlmService, registries
│   ├── database/             # Storage.ts SQL database adapter
│   ├── services/             # Heartbeat Scheduler and SkillOpt Service
│   └── utils/                # General helpers (e.g. cron parser)
```

---

## 🚀 Getting Started

### 1. Installation
Ensure you have **Bun** installed globally on your machine.
```bash
git clone https://github.com/benjamin-wo/nexus-assistant.git
cd nexus-assistant
bun install
```

### 2. Configuration
Create your environment variables file:
```bash
cp .env.example .env
```
Fill in the parameters inside `.env` (Telegram tokens, Google OAuth client details, LLM API keys).

### 3. Verify
Run the automated checks and E2E evaluation suite to ensure everything builds and executes cleanly:
```bash
# Run mechanical check pipeline
bun run src/test_pipeline.ts

# Run E2E capability evaluations (cron reminders, html hosting)
bun run src/test_evals.ts

# Run Telegram output rule validation checks
bun run src/test_telegram_formatting.ts
```

### 4. Run
Launch either interface to start chatting:
```bash
# Terminal CLI REPL
bun run src/cli.ts

# Telegram Bot
bun run src/telegram.ts
```
