import { expect, test, describe } from "bun:test";
import { parseBalanceResponse, estimateDeepseekCost } from "../src/core/deepseekBalance";

describe("DeepSeek balance parsing", () => {
  test("parses documented response shape", () => {
    const result = parseBalanceResponse({
      is_available: true,
      balance_infos: [
        {
          currency: "CNY",
          total_balance: "110.00",
          granted_balance: "10.00",
          topped_up_balance: "100.00",
        },
      ],
    });
    expect(result.isAvailable).toBe(true);
    expect(result.balances).toHaveLength(1);
    expect(result.balances[0]).toEqual({
      currency: "CNY",
      totalBalance: 110,
      grantedBalance: 10,
      toppedUpBalance: 100,
    });
  });

  test("handles empty / malformed responses", () => {
    const empty = parseBalanceResponse({});
    expect(empty.isAvailable).toBe(false);
    expect(empty.balances).toEqual([]);

    const weird = parseBalanceResponse(null);
    expect(weird.isAvailable).toBe(false);
    expect(weird.balances).toEqual([]);
  });

  test("handles multiple currencies and string/number amounts", () => {
    const result = parseBalanceResponse({
      is_available: true,
      balance_infos: [
        { currency: "USD", total_balance: "5.5", granted_balance: "0", topped_up_balance: "5.5" },
        { currency: "CNY", total_balance: 88.25, granted_balance: 88.25, topped_up_balance: 0 },
      ],
    });
    expect(result.balances).toHaveLength(2);
    expect(result.balances[0].totalBalance).toBe(5.5);
    expect(result.balances[1].totalBalance).toBe(88.25);
  });
});

describe("DeepSeek cost estimation", () => {
  test("computes cost from token counts with default rates", () => {
    // 1M prompt tokens @ $0.27/M + 1M completion tokens @ $1.10/M = $1.37
    const cost = estimateDeepseekCost(1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.37, 5);
  });

  test("scales proportionally", () => {
    const cost = estimateDeepseekCost(500_000, 250_000);
    expect(cost).toBeCloseTo(0.135 + 0.275, 5);
  });
});
