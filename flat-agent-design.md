# Flat Agent Redesign — Proposal

Status: **Draft for discussion** · Branch: `claude/agent-capabilities-design-ja6t2q`

## Goal
Refer nexus v1 from https://github.com/benjamin-wo/nexus-assistant.git 

Collapse the three-tier `Orchestrator → Worker → Skill` stack into a **single
agent with a flat, consolidated toolbelt**. One LLM loop reasons about each
Telegram request and coordinates its own capabilities directly.

Non-goals: rewriting the runtime infra (Scheduler, TaskRegistry, SkillRegistry,
Storage). Those stay. This is about the *cognitive routing layer* only.

---

## Why change

Today a single message travels: **Orchestrator LLM call** (emits
`<spawn>worker</spawn>`) → **Worker LLM call** (ReAct loop) → **Skill**. Two
LLM round-trips before any real work, plus regex "fast-paths" bolted onto the
orchestrator (calc, bus codes) that exist *only* because the two-hop path is too
slow for trivial requests.

Two structural problems, not just latency:

1. **Misrouting is a silent failure.** The orchestrator guesses a worker from
   prose keywords. Wrong guess → the correct skill isn't even in scope.
2. **Workers can't collaborate.** Capabilities are partitioned across 7 worker
   profiles, so a cross-domain request — *"find the cheapest MRT route and log
   the fare as an expense"* — structurally can't be served: no single worker
   holds both `transit` and `logExpense`. We partitioned capabilities, then have
   to route perfectly to un-partition them.

The tiering was justified when models choked on 25+ tools in one context. That
is no longer true. A single modern model handles a flat ~10-tool belt easily.

---

## Target architecture

```
        ┌────────────────────────┐
        │  User Input (TG / CLI) │
        └───────────┬────────────┘
                    ▼
        ┌────────────────────────┐
        │      Agent (one loop)  │   system prompt = soul + global behavior
        │  ReAct, flat toolbelt  │   tools = consolidated capabilities
        └───────────┬────────────┘
                    ▼
        ┌────────────────────────┐
        │   Consolidated Skills  │   each SKILL.md carries its own usage rules
        └────────────────────────┘
```

- **Delete:** `orchestrator.md` router, the 7 `.agent/agents/*.md` worker
  profiles, and the `<spawn>` routing round-trip. The regex fast-paths can stay
  as a pure-latency optimization (they short-circuit *before* the LLM), but they
  are no longer load-bearing.
- **Keep:** Scheduler (heartbeat reminders + devops audit), TaskRegistry
  (background async + receipts), SkillRegistry (DB-backed hot reload),
  `createSkill` (self-evolution), Storage, LlmService.
- **The agent loop** is essentially today's `WorkerAgent` ReAct loop, but its
  tool set is the *full* consolidated skill list instead of a curated subset,
  and its system prompt is `soul.md` + a global behavior section instead of a
  worker profile. Raise `maxTurns` from 5 → ~8, since one agent now does what a
  routed worker used to.

---

## Where behavioral knowledge lives (Q1 decision)

**Co-locate the rule with the capability it governs.**

- Skill-specific "how to use this correctly" → that skill's `SKILL.md`
  `instructions`. (e.g. "check Outlook vs Gmail before defaulting" → email skill;
  "log only the net share" → splitBill skill.)
- Persona, tone, global do's/don'ts → the single system prompt
  (`soul.md` + short behavior block).

Rationale: the concat mechanism already exists (`WorkerAgent` injects each
in-scope skill's `instructions`); `createSkill`-generated skills ship their own
rules automatically; deleting a skill deletes its rules. This only stays lean
because we also consolidate to ~10 skills (below) — loading instructions for 28
skills every turn would bloat context; for 10 it is negligible.

---

## Skill consolidation (~28 → ~10)

The repo has the same capability implemented several times. Proposed target set:

| Capability        | Absorbs (today)                                             |
|-------------------|-------------------------------------------------------------|
| `webSearch`       | `searchWeb`, `webScraper`, `deep-research`                  |
| `email`           | `gmail`, `outlookEmail`, `pollEmails`                       |
| `maps`            | `googleMaps`, `ltaDataMall`, `trackBus`, `transitPlanner`   |
| `calendar`        | `googleCalendar`                                            |
| `schedule` (cron) | `reminder` (upgraded to real cron via `utils/cron.ts`)      |
| `expenses`        | `logExpense`, `getExpenses`, `splitBill`                    |
| `notes`           | `saveResearchNote`, `getResearchNotes`                      |
| `webPage`         | `htmlAnything`, `hostHtmlPage`, `frontend-design`, `web-design-guidelines` |
| `createSkill`     | (unchanged — self-evolution)                                |
| `calculator`      | (unchanged — fast, deterministic)                           |
| `sysAdmin`        | `readLogs`, `logImprovement` (devops introspection)         |
| `consulting-analysis` | (unchanged — non-redundant report generator)            |

**`weather`: drop.** It returns mock/fake data ("Use this mock skill"), so the
agent would confidently report fabricated forecasts. Delete it; if real weather
is wanted later, `createSkill` can build one against a free no-key API
(Open-Meteo). **`consulting-analysis`: keep** as its own skill — a two-phase
report generator that overlaps with nothing and composes with `webSearch`. Target
is ~11 skills.

Consolidation is the real work; deleting the worker tier is the easy part.

### Regex fast-paths

The orchestrator's regex fast-paths (calc, bus) exist only because the old
two-hop routing was slow. Flattening removes one hop, so:

- **Calc fast-path: drop.** In a single-agent world, a math query hitting the
  `calculator` skill directly is already fast. The regex is a bolted-on special
  case — exactly the moving parts we're removing.
- **Bus fast-path: keep.** Bus-arrival is a high-frequency, real-time query
  where even one LLM hop feels sluggish, and it's a pure deterministic
  passthrough. Worth the one regex.

---

## Your 5 named capabilities → this design

You named: **web search, gmail/outlook, google maps, cron creator, skill
creator**. Those map directly to `webSearch`, `email`, `maps`, `schedule`,
`createSkill` above — 5 of the ~10. The rest (expenses, calendar, notes,
webPage, calculator, sysAdmin) already exist and are worth keeping since the
runtime supports them for free.

---

## Model provider (Q2)

`LlmService` is already provider-agnostic: one `LLM_PROVIDER` env var switches
`gemini | deepseek | openrouter`, with a per-provider circuit breaker and media
auto-routed to Gemini. Migrating to OpenRouter when Gemini/DeepSeek credits run
out is a **one-line env change**, no code.

Flattening *helps* here: today each worker can pin its own `provider`/`model` in
frontmatter — 7 places a model reference can drift. One agent = one switch. If
we ever want a cheap model for a background summarizer, that stays possible by
constructing a second `LlmService` with an explicit provider.

---

## Migration order (incremental, behind aliases)

Big-bang on a bot used daily breaks everything at once with no way to isolate
the cause. Instead, four independently shippable and testable steps. The key
ordering rule: **consolidate the duplicate clusters *before* flattening** —
otherwise the flatten step dumps all ~28 tool definitions into one context,
which is the exact bloat we're removing.

1. **Consolidate the 4 worst duplicate clusters** — `webSearch`, `maps`,
   `email`, `webPage` — behind aliases so old skill names still resolve with
   zero behavior change. Takes ~28 → ~14.
2. **Flatten to the single agent** with those ~14 tools: fork `WorkerAgent`
   (full toolbelt, `soul.md` + global behavior prompt, `maxTurns ≈ 8`), replace
   the orchestrator's routing block with a direct call into it, keep the
   task/status/cancel intercepts and the **bus** fast-path (drop the calc one),
   delete `orchestrator.md` and `.agent/agents/*.md`. The big visible change —
   test hard.
3. **Finish consolidation** (`expenses`, `notes`) and move worker-profile
   behavioral rules down into the relevant `SKILL.md`s.
4. **Cleanup**: drop `weather`, delete dead aliases, update README architecture.

---

## Resolved decisions

- **`weather`**: drop (mock data). **`consulting-analysis`**: keep (non-redundant).
- **Fast-paths**: keep bus, drop calc.
- **Migration**: incremental behind aliases, consolidate-then-flatten (order above).
- **Behavioral knowledge (Q1)**: co-locate in each `SKILL.md`; lean system prompt.
- **Model provider (Q2)**: single `LLM_PROVIDER` switch; OpenRouter migration is
  env-only, no code.
