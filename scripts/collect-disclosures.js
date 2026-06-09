import { collectOfficialDisclosures } from "../server/collectors/index.js";
import { loadLocalEnv } from "../server/env.js";
import { addEventsAndScore, getDataSourceConfig, recordIngestionRun } from "../server/store.js";

await loadLocalEnv();

const args = new Set(process.argv.slice(2));
const markets = [];
if (args.has("--us")) markets.push("US");
if (args.has("--hk")) markets.push("HK");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 7;
const selectedMarkets = markets.length ? markets : ["US", "HK"];
const startedAt = new Date().toISOString();
const dataSourceConfig = await getDataSourceConfig();

console.log(`Collecting official disclosures: markets=${selectedMarkets.join(",")} days=${days}`);

const collected = await collectOfficialDisclosures({
  config: dataSourceConfig,
  markets: selectedMarkets,
  days
});
const results = await addEventsAndScore(collected.events);
const run = await recordIngestionRun({
  type: "official-disclosures-cli",
  status: collected.errors.length ? "partial" : "success",
  startedAt,
  finishedAt: new Date().toISOString(),
  markets: selectedMarkets,
  days,
  imported: results.filter((item) => !item.error).length,
  failed: results.filter((item) => item.error).length,
  scored: results.filter((item) => item.opportunity).length,
  errors: collected.errors
});

console.log(
  JSON.stringify(
    {
      runId: run.id,
      status: run.status,
      imported: run.imported,
      scored: run.scored,
      errors: run.errors
    },
    null,
    2
  )
);
