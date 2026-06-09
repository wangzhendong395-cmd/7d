import {
  buildDailyDigestText,
  buildRiskAlertText,
  buildStockQueryText,
  buildTextMessage,
  sendFeishuMessage
} from "../server/feishu.js";
import { loadLocalEnv } from "../server/env.js";
import { readDb } from "../server/store.js";

await loadLocalEnv();

const command = process.argv[2] || "daily";
const arg = process.argv[3];
const db = await readDb();

const briefForSymbol = (symbol) => {
  const normalized = symbol.toUpperCase();
  const opportunities = db.scoredEvents
    .filter((item) => item.symbol.toUpperCase() === normalized)
    .sort((a, b) => b.score - a.score);
  if (!opportunities.length) return null;
  return {
    symbol: opportunities[0].symbol,
    stockName: opportunities[0].stockName,
    primaryOpportunity: opportunities[0]
  };
};

let text;
if (command === "test") {
  text = "7D事件机会雷达：飞书机器人测试消息已发送。";
} else if (command === "risk") {
  const items = db.watchlistEntries.map((entry) => ({
    ...entry,
    performance: db.performanceTracking.find((item) => item.watchlistId === entry.id) || null
  }));
  text = buildRiskAlertText(items);
} else if (command === "stock") {
  if (!arg) throw new Error("Usage: npm run feishu:daily -- stock NVDA");
  const brief = briefForSymbol(arg);
  if (!brief) throw new Error(`Stock not found: ${arg}`);
  text = buildStockQueryText(brief);
} else {
  text = buildDailyDigestText(db.scoredEvents);
}

const result = await sendFeishuMessage(buildTextMessage(text));
console.log(JSON.stringify(result, null, 2));
if (!result.ok && !result.skipped) process.exit(1);
