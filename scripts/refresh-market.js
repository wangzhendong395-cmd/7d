import { collectMarketSnapshots } from "../server/collectors/market.js";
import { loadLocalEnv } from "../server/env.js";
import { addMarketSnapshots, getTrackedMarketStocks } from "../server/store.js";

await loadLocalEnv();

const symbolArgs = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => arg.toUpperCase());

const tracked = await getTrackedMarketStocks();
const stocks = symbolArgs.length ? tracked.filter((item) => symbolArgs.includes(item.symbol)) : tracked;

console.log(`Refreshing market snapshots: ${stocks.length} symbols`);

const collected = await collectMarketSnapshots({ stocks });
const snapshots = await addMarketSnapshots(collected.snapshots);

console.log(
  JSON.stringify(
    {
      imported: snapshots.length,
      failed: collected.errors.length,
      errors: collected.errors
    },
    null,
    2
  )
);
