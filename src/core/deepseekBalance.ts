// DeepSeek balance & cost tracking helpers.
//
// Balance: GET https://api.deepseek.com/user/balance (Bearer token from
// DEEPSEEK_API_KEY). Cost: derived from token usage recorded by LlmService,
// using per-million-token rates that are configurable via env vars so they can
// be updated as DeepSeek pricing changes without a code deploy.

import { StorageService } from "../database/Storage";

export interface DeepseekBalanceInfo {
  currency: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
}

export interface DeepseekBalanceResult {
  isAvailable: boolean;
  balances: DeepseekBalanceInfo[];
  fetchedAt: string;
}

/** Pure parser (exported for tests). Handles the documented response shape. */
export function parseBalanceResponse(data: any): DeepseekBalanceResult {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  return {
    isAvailable: !!data?.is_available,
    balances: infos.map((b: any) => ({
      currency: b.currency || "CNY",
      totalBalance: Number(b.total_balance) || 0,
      grantedBalance: Number(b.granted_balance) || 0,
      toppedUpBalance: Number(b.topped_up_balance) || 0,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchDeepseekBalance(apiKey?: string): Promise<DeepseekBalanceResult> {
  const key = apiKey || process.env.DEEPSEEK_API_KEY || "";
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY is not configured in environment variables.");
  }

  const res = await fetch("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek balance API error (${res.status}): ${errText}`);
  }

  return parseBalanceResponse(await res.json());
}

/**
 * Estimated cost in USD for a token usage record.
 * Rates are USD per 1M tokens, overridable via env:
 *   DEEPSEEK_INPUT_PRICE_PER_M  (default 0.27)
 *   DEEPSEEK_OUTPUT_PRICE_PER_M (default 1.10)
 */
export function estimateDeepseekCost(promptTokens: number, completionTokens: number): number {
  const inputRate = Number(process.env.DEEPSEEK_INPUT_PRICE_PER_M || 0.27);
  const outputRate = Number(process.env.DEEPSEEK_OUTPUT_PRICE_PER_M || 1.10);
  return (promptTokens / 1_000_000) * inputRate + (completionTokens / 1_000_000) * outputRate;
}

/** Fetches the current balance and persists a snapshot to the database. */
export async function checkAndStoreBalance(apiKey?: string): Promise<DeepseekBalanceResult> {
  const result = await fetchDeepseekBalance(apiKey);

  const storage = new StorageService();
  await storage.initialize();
  try {
    for (const b of result.balances) {
      await storage.saveBalanceSnapshot({
        currency: b.currency,
        totalBalance: b.totalBalance,
        grantedBalance: b.grantedBalance,
        toppedUpBalance: b.toppedUpBalance,
        isAvailable: result.isAvailable,
      });
    }
  } finally {
    await storage.close();
  }

  return result;
}

/** Aggregates recorded token usage (last `days`) into a cost summary. */
export async function getUsageSummary(provider = "deepseek", days = 30) {
  const storage = new StorageService();
  await storage.initialize();
  try {
    const usage = await storage.getLlmUsageSummary(provider, days);
    return {
      provider,
      days,
      ...usage,
      estimatedCostUsd: Number(estimateDeepseekCost(usage.promptTokens, usage.completionTokens).toFixed(4)),
    };
  } finally {
    await storage.close();
  }
}
