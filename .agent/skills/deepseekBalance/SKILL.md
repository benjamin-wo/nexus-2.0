---
name: deepseekBalance
description: Tracks DeepSeek API balance and token usage/cost. Fetches the current account balance from the DeepSeek user balance API, reviews recorded token usage, or lists recent balance snapshots.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [balance, usage, history]
      description: "The action to perform: 'balance' to fetch the current DeepSeek account balance, 'usage' to summarize recorded token usage and estimated cost, or 'history' to list recent balance snapshots."
    days:
      type: number
      description: "Used by 'usage'. How many days of usage to summarize. Default: 30."
    limit:
      type: number
      description: "Used by 'history'. How many recent balance snapshots to return. Default: 10."
    alertIfBelow:
      type: number
      description: "Used by 'balance'. Optional numeric threshold. If the total balance falls below this value, flag a low-balance warning."
  required:
    - action
---
Use this skill when the user asks about their DeepSeek balance, API credits, spending, or cost tracking.
- For current balance: use action 'balance'. This hits https://api.deepseek.com/user/balance and saves a snapshot to the database for history.
- For spending/token usage: use action 'usage'. This summarizes recorded token usage over the last N days and estimates cost in USD (rates configurable via DEEPSEEK_INPUT_PRICE_PER_M / DEEPSEEK_OUTPUT_PRICE_PER_M env vars).
- For balance history: use action 'history'.
- If the user expresses concern about running low on credits, pass alertIfBelow with a sensible threshold (e.g. their typical weekly spend) so the result flags a warning when the balance is under it.
- If the balance API returns an error about an invalid key, tell the user to check DEEPSEEK_API_KEY.
