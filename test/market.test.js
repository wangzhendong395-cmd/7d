import assert from "node:assert/strict";
import test from "node:test";
import { collectMarketSnapshots } from "../server/collectors/market.js";

const chartResponse = (symbol, closes, volumes = []) => ({
  chart: {
    result: [
      {
        meta: { symbol },
        timestamp: closes.map((_, index) => 1780000000 + index * 86400),
        indicators: {
          quote: [
            {
              close: closes,
              volume: volumes.length ? volumes : closes.map(() => 100)
            }
          ]
        }
      }
    ],
    error: null
  }
});

test("market collector calculates relative market and volume ratio", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/QQQ")) return { ok: true, json: async () => chartResponse("QQQ", [100, 101]) };
    if (text.includes("%5EHSI")) return { ok: true, json: async () => chartResponse("^HSI", [200, 202]) };
    if (text.includes("/NVDA")) return { ok: true, json: async () => chartResponse("NVDA", [10, 11], [100, 300]) };
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await collectMarketSnapshots({
    stocks: [{ symbol: "NVDA", market: "US" }]
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].changePct, 10);
  assert.equal(result.snapshots[0].relativeMarketPct, 9);
  assert.equal(result.snapshots[0].volumeRatio, 3);
});
