import { collectRssNews } from "../server/collectors/rss.js";
import { loadLocalEnv } from "../server/env.js";
import { addEventsAndScore, getDataSourceConfig, getNewsFeeds, recordIngestionRun } from "../server/store.js";

await loadLocalEnv();

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 7;
const startedAt = new Date().toISOString();

console.log(`Collecting RSS news: days=${days}`);

const collected = await collectRssNews({
  feeds: await getNewsFeeds(),
  config: await getDataSourceConfig(),
  days
});
const results = await addEventsAndScore(collected.events);
const run = await recordIngestionRun({
  type: "rss-news-cli",
  status: collected.errors.length ? "partial" : "success",
  startedAt,
  finishedAt: new Date().toISOString(),
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
