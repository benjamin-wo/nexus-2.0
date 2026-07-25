# Bug Incident Report: DeepSeek Model Alias Crash

## Status
- **State:** Resolved
- **Date:** 2026-07-26
- **Component:** `LlmService.ts` / `WorkerAgent` (`productManager.md`)
- **Fix Commit:** `32ae624`

## Error Traceback
```
❌ An internal agent error occurred: WorkerCrash::::productManager::any bugs?::Error: API error (400) on https://api.deepseek.com/chat/completions: {"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-reasoner.","type":"invalidrequesterror","param":null,"code":"invalidrequesterror"}}
    at callOpenAiCompatible (/app/src/core/LlmService.ts:247:17)
```

## Root Cause Analysis
1. `.agent/agents/productManager.md` had `model: deepseek-reasoner` set in its YAML frontmatter header.
2. When `WorkerAgent` initialized the `productManager` profile, it extracted `customModel = "deepseek-reasoner"`.
3. The DeepSeek API / proxy endpoint rejected `deepseek-reasoner` with HTTP 400 because only `deepseek-v4-pro` or `deepseek-v4-flash` are supported by that API deployment.
4. `LlmService` threw a non-retryable 400 exception, causing the `productManager` worker agent to crash.

## Resolution
1. **Agent Frontmatter Fix**: Updated `.agent/agents/productManager.md` frontmatter to use `model: deepseek-v4-pro`.
2. **Resilient Model Fallback**: Enhanced `callDeepseek` in `src/core/LlmService.ts` to catch 400 errors containing unsupported model messages and automatically fallback to `process.env.DEEPSEEK_MODEL` or `deepseek-v4-pro`.
3. **Verification**: Executed the automated verification pipeline (`bun run src/test_pipeline.ts`) and verified clean worker routing and response generation.
