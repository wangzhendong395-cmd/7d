import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, maskSecret, saveLocalEnvValues } from "./env.js";
import { buildBrokerEnvValues, getBrokerStatus, testChiefConfig, testFutuOpenD, testIbkrGateway, testTigerConfig } from "./brokers.js";
import { collectOfficialDisclosures } from "./collectors/index.js";
import { collectMarketSnapshots } from "./collectors/market.js";
import {
  buildDailyDigestText,
  buildHelpText,
  buildRiskAlertText,
  buildStockQueryText,
  buildTextMessage,
  getFeishuWebhookUrl,
  getFeishuAppConfig,
  parseFeishuCommand,
  replyFeishuMessage,
  sendFeishuMessage
} from "./feishu.js";
import {
  addCustomIndustry,
  addEventAndScore,
  addEventsAndScore,
  addMarketSnapshot,
  addMarketSnapshots,
  addPersonalAction,
  addWatchlistEntry,
  confirmModelSuggestion,
  createBackup,
  getDataSourceConfig,
  getSystemStatus,
  getTrackedMarketStocks,
  readDb,
  recordFeishuEvent,
  recordIngestionRun,
  removeCustomIndustry,
  removeDataSourceStock,
  regenerateWeeklyReview,
  updatePerformance,
  updateCustomIndustry,
  upsertDataSourceStock
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);

const json = (res, data, status = 200) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data, null, 2));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
};

const gradeRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const compactStockCard = (item) => ({
  symbol: item.symbol,
  stockName: item.stockName,
  market: item.market,
  industry: item.industry,
  eventType: item.eventType,
  grade: item.grade,
  score: item.score,
  event: item.event,
  reasons: item.reasons.slice(0, 2),
  risks: item.risks.slice(0, 2),
  watchSignals: item.watchSignals.slice(0, 2),
  conclusion: item.conclusion
});

const filterOpportunities = (items, url) => {
  const market = url.searchParams.get("market");
  const industry = url.searchParams.get("industry");
  const eventType = url.searchParams.get("eventType");
  const grade = url.searchParams.get("grade");
  const q = url.searchParams.get("q")?.trim().toLowerCase();

  return items
    .filter((item) => !market || item.market === market)
    .filter((item) => !industry || item.industry === industry)
    .filter((item) => !eventType || item.eventType === eventType)
    .filter((item) => !grade || item.grade === grade)
    .filter((item) => {
      if (!q) return true;
      return [item.symbol, item.stockName, item.event, item.industry, item.eventType]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => gradeRank[b.grade] - gradeRank[a.grade] || b.score - a.score);
};

const groupOpportunitiesByStock = (items) => {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.symbol)) groups.set(item.symbol, []);
    groups.get(item.symbol).push(item);
  });

  return [...groups.values()]
    .map((group) => {
      const sorted = group
        .slice()
        .sort((a, b) => gradeRank[b.grade] - gradeRank[a.grade] || b.score - a.score || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
      return {
        ...sorted[0],
        eventCount: group.length,
        relatedEventIds: sorted.map((item) => item.id)
      };
    })
    .sort((a, b) => gradeRank[b.grade] - gradeRank[a.grade] || b.score - a.score);
};

const buildStockBrief = (db, symbol) => {
  const normalized = symbol.toUpperCase();
  const opportunities = db.scoredEvents
    .filter((item) => item.symbol.toUpperCase() === normalized)
    .sort((a, b) => gradeRank[b.grade] - gradeRank[a.grade] || b.score - a.score);
  if (!opportunities.length) return null;

  const events = db.rawEvents
    .filter((event) => event.symbol.toUpperCase() === normalized)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const watchlist = db.watchlistEntries.filter((entry) => entry.symbol.toUpperCase() === normalized);
  const snapshot = db.marketSnapshots.find((item) => item.symbol.toUpperCase() === normalized) || null;

  return {
    symbol: opportunities[0].symbol,
    stockName: opportunities[0].stockName,
    market: opportunities[0].market,
    industry: opportunities[0].industry,
    primaryOpportunity: {
      ...opportunities[0],
      eventCount: opportunities.length,
      relatedEventIds: opportunities.map((item) => item.id)
    },
    opportunities,
    events,
    watchlist,
    marketSnapshot: snapshot
  };
};

const routeApi = async (req, res, url) => {
  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, {
      ok: true,
      service: "7d-event-radar",
      version: "0.2.0",
      persistence: "json",
      records: {
        rawEvents: db.rawEvents.length,
        opportunities: db.scoredEvents.length,
        watchlist: db.watchlistEntries.length
      }
    });
  }

  if (req.method === "GET" && url.pathname === "/api/system/status") {
    return json(res, await getSystemStatus());
  }

  if (req.method === "POST" && url.pathname === "/api/system/backup") {
    return json(res, await createBackup(), 201);
  }

  if (req.method === "GET" && url.pathname === "/api/system/export") {
    return json(res, db);
  }

  if (req.method === "GET" && url.pathname === "/api/opportunities") {
    const filtered = filterOpportunities(db.scoredEvents, url);
    const shouldGroup = url.searchParams.get("group") !== "event";
    const limit = clamp(Number(url.searchParams.get("limit") || 50) || 50, 1, 50);
    const items = shouldGroup ? groupOpportunitiesByStock(filtered) : filtered;
    return json(res, {
      items: items.slice(0, limit),
      total: items.length,
      limit,
      disclaimer: "本系统为个人研究和复盘工具，所有内容仅用于信息整理、事件跟踪和模型验证。"
    });
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    return json(res, { items: db.rawEvents.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)) });
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    const body = await readBody(req);
    const result = await addEventAndScore(body);
    return result.error ? json(res, { error: result.error }, 400) : json(res, result, 201);
  }

  if (req.method === "POST" && url.pathname === "/api/import/events") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(res, { error: "items array is required" }, 400);
    const results = await addEventsAndScore(items);
    return json(res, {
      imported: results.filter((item) => !item.error).length,
      failed: results.filter((item) => item.error).length,
      results
    });
  }

  if (req.method === "GET" && url.pathname === "/api/data-sources/config") {
    return json(res, await getDataSourceConfig());
  }

  const dataSourceStockMatch = url.pathname.match(/^\/api\/data-sources\/(us|hk)\/stocks$/i);
  if (req.method === "POST" && dataSourceStockMatch) {
    const body = await readBody(req);
    const result = await upsertDataSourceStock(dataSourceStockMatch[1], body);
    return result.error ? json(res, { error: result.error }, 400) : json(res, result, 201);
  }

  const dataSourceDeleteMatch = url.pathname.match(/^\/api\/data-sources\/(us|hk)\/stocks\/([^/]+)$/i);
  if (req.method === "DELETE" && dataSourceDeleteMatch) {
    const result = await removeDataSourceStock(dataSourceDeleteMatch[1], decodeURIComponent(dataSourceDeleteMatch[2]));
    return result.error ? json(res, { error: result.error }, 400) : json(res, result);
  }

  if (req.method === "GET" && url.pathname === "/api/ingestion-runs") {
    return json(res, { items: db.ingestionRuns.slice().reverse() });
  }

  if (req.method === "POST" && url.pathname === "/api/collect/disclosures") {
    const body = await readBody(req);
    const markets = Array.isArray(body.markets) && body.markets.length ? body.markets : ["US", "HK"];
    const days = Number(body.days || 7);
    const startedAt = new Date().toISOString();
    const collected = await collectOfficialDisclosures({ config: await getDataSourceConfig(), markets, days });
    const results = await addEventsAndScore(collected.events);
    const run = await recordIngestionRun({
      type: "official-disclosures",
      status: collected.errors.length ? "partial" : "success",
      startedAt,
      finishedAt: new Date().toISOString(),
      markets,
      days,
      imported: results.filter((item) => !item.error).length,
      failed: results.filter((item) => item.error).length,
      scored: results.filter((item) => item.opportunity).length,
      errors: collected.errors
    });
    return json(res, { run, results, errors: collected.errors });
  }

  if (req.method === "GET" && url.pathname === "/api/market-snapshots") {
    return json(res, { items: db.marketSnapshots });
  }

  if (req.method === "POST" && url.pathname === "/api/market/refresh") {
    const body = await readBody(req);
    const tracked = await getTrackedMarketStocks();
    const symbols = Array.isArray(body.symbols) && body.symbols.length
      ? tracked.filter((item) => body.symbols.includes(item.symbol))
      : tracked;
    const collected = await collectMarketSnapshots({ stocks: symbols });
    const snapshots = await addMarketSnapshots(collected.snapshots);
    return json(res, {
      imported: snapshots.length,
      failed: collected.errors.length,
      snapshots,
      errors: collected.errors
    });
  }

  if (req.method === "POST" && url.pathname === "/api/market-snapshots") {
    const body = await readBody(req);
    const result = await addMarketSnapshot(body);
    return result.error ? json(res, { error: result.error }, 400) : json(res, result, 201);
  }

  const opportunityMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)$/);
  if (req.method === "GET" && opportunityMatch) {
    const item = db.scoredEvents.find((event) => event.id === opportunityMatch[1]);
    return item ? json(res, item) : json(res, { error: "Opportunity not found" }, 404);
  }

  const stockEventsMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/events$/);
  if (req.method === "GET" && stockEventsMatch) {
    const symbol = decodeURIComponent(stockEventsMatch[1]).toUpperCase();
    return json(res, {
      symbol,
      items: db.rawEvents.filter((event) => event.symbol.toUpperCase() === symbol)
    });
  }

  const stockBriefMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/brief$/);
  if (req.method === "GET" && stockBriefMatch) {
    const symbol = decodeURIComponent(stockBriefMatch[1]);
    const brief = buildStockBrief(db, symbol);
    return brief ? json(res, brief) : json(res, { error: "Stock not found" }, 404);
  }

  const scoreMatch = url.pathname.match(/^\/api\/scores\/([^/]+)$/);
  if (req.method === "GET" && scoreMatch) {
    const item = db.scoredEvents.find((event) => event.eventId === scoreMatch[1] || event.id === scoreMatch[1]);
    return item ? json(res, { modelVersion: db.modelVersion.id, score: item }) : json(res, { error: "Score not found" }, 404);
  }

  if (req.method === "GET" && url.pathname === "/api/watchlist") {
    return json(res, {
      items: db.watchlistEntries.map((entry) => ({
        ...entry,
        performance: db.performanceTracking.find((item) => item.watchlistId === entry.id) || null
      }))
    });
  }

  if (req.method === "POST" && url.pathname === "/api/watchlist") {
    const body = await readBody(req);
    const entry = await addWatchlistEntry(body);
    if (!entry) return json(res, { error: "Opportunity not found" }, 404);
    return json(res, entry, 201);
  }

  const performanceMatch = url.pathname.match(/^\/api\/watchlist\/([^/]+)\/performance$/);
  if (req.method === "GET" && performanceMatch) {
    const item = db.performanceTracking.find((entry) => entry.watchlistId === performanceMatch[1]);
    return item ? json(res, item) : json(res, { error: "Performance not found" }, 404);
  }

  if (req.method === "PUT" && performanceMatch) {
    const body = await readBody(req);
    const item = await updatePerformance(performanceMatch[1], body);
    return json(res, item);
  }

  if (req.method === "GET" && url.pathname === "/api/reviews/weekly") {
    return json(res, db.weeklyReview);
  }

  if (req.method === "POST" && url.pathname === "/api/reviews/weekly/regenerate") {
    const review = await regenerateWeeklyReview();
    return json(res, review);
  }

  if (req.method === "GET" && url.pathname === "/api/model/config") {
    return json(res, {
      ...db.modelVersion,
      suggestions: db.modelSuggestions
    });
  }

  const modelSuggestionMatch = url.pathname.match(/^\/api\/model\/suggestions\/([^/]+)\/confirm$/);
  if (req.method === "POST" && modelSuggestionMatch) {
    const result = await confirmModelSuggestion(modelSuggestionMatch[1]);
    return result ? json(res, result) : json(res, { error: "Suggestion not found" }, 404);
  }

  if (req.method === "GET" && url.pathname === "/api/custom-industries") {
    return json(res, { items: db.customIndustries });
  }

  if (req.method === "POST" && url.pathname === "/api/custom-industries") {
    const body = await readBody(req);
    if (!body.name) return json(res, { error: "Industry name is required" }, 400);
    const industry = await addCustomIndustry(body);
    return json(res, industry, 201);
  }

  const industryMatch = url.pathname.match(/^\/api\/custom-industries\/([^/]+)$/);
  if (req.method === "PUT" && industryMatch) {
    const body = await readBody(req);
    const industry = await updateCustomIndustry(industryMatch[1], body);
    return industry ? json(res, industry) : json(res, { error: "Industry not found" }, 404);
  }

  if (req.method === "DELETE" && industryMatch) {
    const result = await removeCustomIndustry(industryMatch[1]);
    return result.removed ? json(res, result) : json(res, { error: "Industry not found" }, 404);
  }

  if (req.method === "GET" && url.pathname === "/api/personal-actions") {
    return json(res, { items: db.personalActions });
  }

  if (req.method === "POST" && url.pathname === "/api/personal-actions") {
    const body = await readBody(req);
    const action = await addPersonalAction(body);
    return json(res, action, 201);
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/query") {
    const body = await readBody(req);
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!symbol) return json(res, { error: "Symbol is required" }, 400);

    const item = db.scoredEvents.find((event) => event.symbol.toUpperCase() === symbol);
    return item
      ? json(res, {
          type: "stock_query",
          card: compactStockCard(item),
          webUrl: `/api/opportunities/${item.id}`
        })
      : json(res, { type: "stock_query", symbol, message: "最近7天暂无可用事件卡片。" }, 404);
  }

  if (req.method === "GET" && url.pathname === "/api/feishu/daily-preview") {
    const items = filterOpportunities(db.scoredEvents, new URL("/api/opportunities?grade=S", "http://local"))
      .concat(filterOpportunities(db.scoredEvents, new URL("/api/opportunities?grade=A", "http://local")))
      .slice(0, 10)
      .map((item) => ({
        symbol: item.symbol,
        stockName: item.stockName,
        grade: item.grade,
        score: item.score,
        reason: item.reasons[0],
        url: `/opportunities/${item.id}`
      }));
    return json(res, {
      title: "每日机会榜",
      count: items.length,
      items,
      note: "仅展示S/A级事件卡片。"
    });
  }

  if (req.method === "GET" && url.pathname === "/api/feishu/status") {
    const app = getFeishuAppConfig();
    return json(res, {
      configured: Boolean(getFeishuWebhookUrl()),
      appConfigured: Boolean(app.appId && app.appSecret),
      verificationTokenConfigured: Boolean(app.verificationToken),
      masked: {
        webhook: maskSecret(getFeishuWebhookUrl()),
        appId: maskSecret(app.appId),
        appSecret: maskSecret(app.appSecret),
        verificationToken: maskSecret(app.verificationToken)
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/config") {
    const body = await readBody(req);
    const result = await saveLocalEnvValues({
      FEISHU_WEBHOOK_URL: body.webhookUrl || "",
      FEISHU_APP_ID: body.appId || "",
      FEISHU_APP_SECRET: body.appSecret || "",
      FEISHU_VERIFICATION_TOKEN: body.verificationToken || ""
    });
    const app = getFeishuAppConfig();
    return json(res, {
      ...result,
      configured: Boolean(getFeishuWebhookUrl()),
      appConfigured: Boolean(app.appId && app.appSecret),
      verificationTokenConfigured: Boolean(app.verificationToken)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/brokers/status") {
    return json(res, await getBrokerStatus());
  }

  if (req.method === "POST" && url.pathname === "/api/brokers/config") {
    const body = await readBody(req);
    const result = await saveLocalEnvValues(buildBrokerEnvValues(body));
    return json(res, { ...result, status: await getBrokerStatus() });
  }

  if (req.method === "POST" && url.pathname === "/api/brokers/futu/test") {
    return json(res, await testFutuOpenD());
  }

  if (req.method === "POST" && url.pathname === "/api/brokers/tiger/test") {
    return json(res, await testTigerConfig());
  }

  if (req.method === "POST" && url.pathname === "/api/brokers/ibkr/test") {
    return json(res, await testIbkrGateway());
  }

  if (req.method === "POST" && url.pathname === "/api/brokers/chief/test") {
    return json(res, await testChiefConfig());
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/events") {
    const body = await readBody(req);
    const token = getFeishuAppConfig().verificationToken;
    const requestToken = body.token || body.header?.token || body.event?.token;
    const challenge = body.challenge || body.event?.challenge;

    if (body.type === "url_verification" || challenge) {
      await recordFeishuEvent({
        type: "url_verification",
        accepted: true,
        tokenMatched: !token || !requestToken || requestToken === token,
        hasChallenge: Boolean(challenge)
      });
      return json(res, { challenge });
    }

    if (token && requestToken && requestToken !== token) {
      await recordFeishuEvent({ type: "event", accepted: false, reason: "Invalid verification token", eventType: body.header?.event_type });
      return json(res, { error: "Invalid verification token" }, 403);
    }

    const eventType = body.header?.event_type;
    if (eventType !== "im.message.receive_v1") {
      await recordFeishuEvent({ type: "event", accepted: true, ignored: true, eventType });
      return json(res, { ok: true, ignored: true });
    }

    const message = body.event?.message;
    const messageId = message?.message_id;
    const content = (() => {
      try {
        return JSON.parse(message?.content || "{}").text || "";
      } catch {
        return "";
      }
    })();
    const command = parseFeishuCommand(content);
    const replyText = buildFeishuCommandReply(db, command);

    if (!messageId) {
      await recordFeishuEvent({ type: "message", accepted: true, ok: false, content, command, error: "message_id missing" });
      return json(res, { ok: false, error: "message_id missing" }, 400);
    }
    const result = await replyFeishuMessage({ messageId, text: replyText });
    await recordFeishuEvent({
      type: "message",
      accepted: true,
      ok: result.ok,
      messageId,
      content,
      command,
      replyError: result.error || "",
      replyStatus: result.status || null
    });
    return json(res, result, result.ok ? 200 : 502);
  }

  if (req.method === "GET" && url.pathname === "/api/feishu/events/logs") {
    return json(res, { items: db.feishuEvents.slice().reverse() });
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/test") {
    const result = await sendFeishuMessage(buildTextMessage("7D事件机会雷达：飞书机器人测试消息已发送。"));
    return json(res, result, result.ok || result.skipped ? 200 : 502);
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/push/daily") {
    const text = buildDailyDigestText(db.scoredEvents);
    const result = await sendFeishuMessage(buildTextMessage(text));
    return json(res, result, result.ok || result.skipped ? 200 : 502);
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/push/risk") {
    const items = db.watchlistEntries.map((entry) => ({
      ...entry,
      performance: db.performanceTracking.find((item) => item.watchlistId === entry.id) || null
    }));
    const text = buildRiskAlertText(items);
    const result = await sendFeishuMessage(buildTextMessage(text));
    return json(res, result, result.ok || result.skipped ? 200 : 502);
  }

  const feishuStockPushMatch = url.pathname.match(/^\/api\/feishu\/push\/stock\/([^/]+)$/);
  if (req.method === "POST" && feishuStockPushMatch) {
    const brief = buildStockBrief(db, decodeURIComponent(feishuStockPushMatch[1]));
    if (!brief) return json(res, { error: "Stock not found" }, 404);
    const result = await sendFeishuMessage(buildTextMessage(buildStockQueryText(brief)));
    return json(res, result, result.ok || result.skipped ? 200 : 502);
  }

  return json(res, { error: "API route not found" }, 404);
};

const buildFeishuCommandReply = (db, command) => {
  if (command.type === "daily") return buildDailyDigestText(db.scoredEvents);
  if (command.type === "risk") {
    const items = db.watchlistEntries.map((entry) => ({
      ...entry,
      performance: db.performanceTracking.find((item) => item.watchlistId === entry.id) || null
    }));
    return buildRiskAlertText(items);
  }
  if (command.type === "stock") {
    const brief = buildStockBrief(db, command.symbol);
    return brief ? buildStockQueryText(brief) : `未找到 ${command.symbol} 的7日事件卡。\n\n可先运行 npm run collect 和 npm run market。`;
  }
  if (command.type === "unknown") return `${command.raw} 暂不支持。\n\n${buildHelpText()}`;
  return buildHelpText();
};

const serveStatic = async (req, res, url) => {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname === "/mini" ? "/mini.html" : url.pathname;
  const requestedPath = path.normalize(path.join(publicDir, pathname));
  if (!requestedPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(requestedPath);
    const ext = path.extname(requestedPath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fallback);
  }
};

const requestListener = async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, { error: "Internal server error", detail: error.message }, 500);
  }
};

export const createServer = () => http.createServer(requestListener);

export default async function handler(req, res) {
  await loadLocalEnv();
  await requestListener(req, res);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await loadLocalEnv();
  const server = createServer();
  server.listen(port, () => {
    console.log(`7D event radar running at http://localhost:${port}`);
  });
}
