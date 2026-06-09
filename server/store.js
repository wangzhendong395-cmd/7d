import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataSourceConfig as seedDataSourceConfig, sourceCoverageVersion } from "./data-source-config.js";
import {
  customIndustries,
  modelVersion,
  performanceTracking,
  rawEvents,
  scoredEvents,
  watchlistEntries,
  weeklyReview
} from "./data.js";
import { buildOpportunityFromEvent, normalizeRawEvent } from "./scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const getDbPath = () =>
  process.env.RADAR_DB_PATH ||
  (process.env.VERCEL ? path.join(tmpdir(), "radar-db.json") : path.join(rootDir, "data", "radar-db.json"));
const getDataDir = () => path.dirname(getDbPath());

const seedDb = () => ({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  rawEvents,
  scoredEvents,
  watchlistEntries,
  performanceTracking,
  customIndustries: customIndustries.some((item) => item.id === defaultTechFocusIndustry.id)
    ? customIndustries
    : [...customIndustries, defaultTechFocusIndustry],
  weeklyReview,
  modelVersion,
  dataSourceConfig: seedDataSourceConfig,
  sourceCoverageVersion,
  modelSuggestions: [
    {
      id: "ms-product-validation-v1",
      status: "pending",
      createdAt: "2026-06-08T00:00:00.000Z",
      reason: "产品发布类样本的短期表现偏弱，建议提高市场验证权重观察。",
      suggestedWeights: {
        eventStrength: 18,
        expectationGap: 20,
        catalystCertainty: 15,
        marketValidation: 17,
        trendFit: 10,
        valuationSupport: 10,
        riskCounter: 10
      }
    }
  ],
  personalActions: []
});

const mergeStockList = (existing = [], defaults = [], key) => {
  const byKey = new Map();
  existing.forEach((item) => byKey.set(String(item[key] || "").toUpperCase(), item));
  defaults.forEach((item) => {
    const id = String(item[key] || "").toUpperCase();
    if (!byKey.has(id)) byKey.set(id, item);
  });
  return [...byKey.values()];
};

const pruneLegacyDataSourceConfig = (config = {}) => ({
  us: config.us || [],
  hk: (config.hk || []).filter((item) => item.code !== "01211")
});

const defaultTechFocusIndustry = {
  id: "ci-ai-tech-semi",
  name: "AI与半导体",
  keywords: ["AI", "半导体", "芯片", "GPU", "算力", "云计算", "光模块", "AI服务器", "AI网络"],
  stockPool: [
    ...seedDataSourceConfig.us.map((item) => item.symbol),
    ...seedDataSourceConfig.hk.map((item) => item.symbol)
  ],
  eventKeywords: ["订单", "扩产", "指引上调", "合作", "新产品", "放量", "跑赢", "审批"],
  excludedKeywords: ["监管调查", "诉讼", "融资摊薄", "减持"],
  priority: "高",
  enabled: true,
  pushEnabled: true,
  note: "覆盖科技、AI、半导体和AI终端链条，作为事件筛选的行业加分项。"
};

const migrateDataSourceCoverage = (db) => {
  const hasTechFocus = db.customIndustries?.some((item) => item.id === defaultTechFocusIndustry.id);
  if (db.sourceCoverageVersion === sourceCoverageVersion && hasTechFocus) return db;
  const customIndustries = hasTechFocus ? db.customIndustries : [...(db.customIndustries || []), defaultTechFocusIndustry];
  return {
    ...db,
    dataSourceConfig: {
      us: mergeStockList(pruneLegacyDataSourceConfig(db.dataSourceConfig).us, seedDataSourceConfig.us, "symbol"),
      hk: mergeStockList(pruneLegacyDataSourceConfig(db.dataSourceConfig).hk, seedDataSourceConfig.hk, "code")
    },
    customIndustries,
    sourceCoverageVersion
  };
};

const ensureShape = (db) => ({
  ...migrateDataSourceCoverage({
    ...db,
    rawEvents: db.rawEvents || [],
    scoredEvents: db.scoredEvents || [],
    watchlistEntries: db.watchlistEntries || [],
    performanceTracking: db.performanceTracking || [],
    customIndustries: db.customIndustries || [],
    weeklyReview: db.weeklyReview || weeklyReview,
    modelVersion: db.modelVersion || modelVersion,
    modelSuggestions: db.modelSuggestions || [],
    personalActions: db.personalActions || [],
    marketSnapshots: db.marketSnapshots || [],
    ingestionRuns: db.ingestionRuns || [],
    dataSourceConfig: db.dataSourceConfig || seedDataSourceConfig,
    feishuEvents: db.feishuEvents || []
  })
});

export const readDb = async () => {
  await mkdir(getDataDir(), { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(getDbPath(), "utf8"));
    const db = ensureShape(parsed);
    const shouldPersistMigration =
      db.sourceCoverageVersion !== parsed.sourceCoverageVersion ||
      db.customIndustries.length !== (parsed.customIndustries || []).length ||
      db.dataSourceConfig.us.length !== (parsed.dataSourceConfig?.us || []).length ||
      db.dataSourceConfig.hk.length !== (parsed.dataSourceConfig?.hk || []).length;
    if (shouldPersistMigration) await writeDb(db);
    return db;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const db = seedDb();
    await writeDb(db);
    return db;
  }
};

export const addEventAndScore = async (payload) => {
  const db = await readDb();
  const event = normalizeRawEvent(payload);
  if (!event.symbol || !event.stockName) {
    return { error: "symbol and stockName are required" };
  }

  db.rawEvents = db.rawEvents.filter((item) => item.id !== event.id);
  db.rawEvents.push(event);
  const opportunity = buildOpportunityFromEvent(event, db);
  db.scoredEvents = db.scoredEvents.filter((item) => item.eventId !== event.id);
  db.scoredEvents.push(opportunity);
  db.ingestionRuns.push({
    id: `run-${Date.now()}`,
    type: "manual-event",
    status: "success",
    createdAt: new Date().toISOString(),
    imported: 1,
    scored: 1
  });
  await writeDb(db);
  return { event, opportunity };
};

export const addEventsAndScore = async (payloads) => {
  const db = await readDb();
  const results = [];

  for (const payload of payloads) {
    const event = normalizeRawEvent(payload);
    if (!event.symbol || !event.stockName) {
      results.push({ error: "symbol and stockName are required", payload });
      continue;
    }
    db.rawEvents = db.rawEvents.filter((item) => item.id !== event.id);
    db.rawEvents.push(event);
    const opportunity = buildOpportunityFromEvent(event, db);
    db.scoredEvents = db.scoredEvents.filter((item) => item.eventId !== event.id);
    db.scoredEvents.push(opportunity);
    results.push({ event, opportunity });
  }

  db.ingestionRuns.push({
    id: `run-${Date.now()}`,
    type: "bulk-events",
    status: "success",
    createdAt: new Date().toISOString(),
    imported: results.filter((item) => !item.error).length,
    failed: results.filter((item) => item.error).length,
    scored: results.filter((item) => item.opportunity).length
  });
  await writeDb(db);
  return results;
};

export const recordIngestionRun = async (run) => {
  const db = await readDb();
  db.ingestionRuns.push({
    id: `run-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...run
  });
  await writeDb(db);
  return db.ingestionRuns.at(-1);
};

export const addMarketSnapshot = async (payload) => {
  const db = await readDb();
  const snapshot = {
    id: payload.id || `mkt-${Date.now()}`,
    symbol: String(payload.symbol || "").trim().toUpperCase(),
    price: Number(payload.price || 0),
    changePct: Number(payload.changePct || 0),
    relativeMarketPct: Number(payload.relativeMarketPct || 0),
    relativeIndustryPct: Number(payload.relativeIndustryPct || 0),
    volumeRatio: Number(payload.volumeRatio || 1),
    capturedAt: payload.capturedAt || new Date().toISOString()
  };
  if (!snapshot.symbol) return { error: "symbol is required" };

  db.marketSnapshots = db.marketSnapshots.filter((item) => item.symbol !== snapshot.symbol);
  db.marketSnapshots.push(snapshot);
  db.scoredEvents = db.scoredEvents.map((opportunity) => {
    if (opportunity.symbol !== snapshot.symbol) return opportunity;
    const event = db.rawEvents.find((item) => item.id === opportunity.eventId);
    return event ? buildOpportunityFromEvent(event, db) : opportunity;
  });
  await writeDb(db);
  return snapshot;
};

const formatPct = (value) => `${Number(value || 0).toFixed(2)}%`;

const classifyMarketSnapshotEvent = (snapshot) => {
  if (snapshot.changePct >= 1.5 || snapshot.relativeMarketPct >= 1 || snapshot.volumeRatio >= 1.25) {
    return "股价和成交量异动";
  }
  if (snapshot.changePct <= -2 || snapshot.relativeMarketPct <= -1.5) return "风险反证";
  return "行情快照更新";
};

const buildMarketSignalEvent = (snapshot, stock) =>
  normalizeRawEvent({
    id: `mkt-signal-${snapshot.symbol}-${String(snapshot.capturedAt || "").slice(0, 10)}`,
    symbol: snapshot.symbol,
    stockName: stock?.stockName || snapshot.symbol,
    market: stock?.market || (snapshot.symbol.endsWith(".HK") ? "HK" : "US"),
    industry: stock?.industry || "未分类",
    eventType: classifyMarketSnapshotEvent(snapshot),
    source: "Yahoo Finance Market Snapshot",
    sourceCredibility: "B",
    publishedAt: snapshot.capturedAt,
    title: `${snapshot.symbol} market signal`,
    summary: `${snapshot.symbol} 近端行情快照：涨跌幅${formatPct(snapshot.changePct)}，相对基准${formatPct(snapshot.relativeMarketPct)}，成交量倍数${Number(snapshot.volumeRatio || 1).toFixed(2)}。`,
    followupSignals: ["观察能否继续跑赢基准", "观察成交量是否维持放大", "观察是否出现公告或新闻催化"]
  });

export const addMarketSnapshots = async (payloads) => {
  const db = await readDb();
  const snapshots = [];
  const stockBySymbol = new Map();

  db.scoredEvents.forEach((item) => stockBySymbol.set(item.symbol.toUpperCase(), item));
  db.dataSourceConfig.us.forEach((item) =>
    stockBySymbol.set(item.symbol.toUpperCase(), { ...item, market: "US" })
  );
  db.dataSourceConfig.hk.forEach((item) =>
    stockBySymbol.set(item.symbol.toUpperCase(), { ...item, market: "HK" })
  );

  for (const payload of payloads) {
    const snapshot = {
      id: payload.id || `mkt-${payload.symbol}-${Date.now()}`,
      symbol: String(payload.symbol || "").trim().toUpperCase(),
      price: Number(payload.price || 0),
      changePct: Number(payload.changePct || 0),
      relativeMarketPct: Number(payload.relativeMarketPct || 0),
      relativeIndustryPct: Number(payload.relativeIndustryPct || 0),
      volumeRatio: Number(payload.volumeRatio || 1),
      volume: Number(payload.volume || 0),
      benchmarkSymbol: payload.benchmarkSymbol || "",
      capturedAt: payload.capturedAt || new Date().toISOString()
    };
    if (!snapshot.symbol) continue;
    db.marketSnapshots = db.marketSnapshots.filter((item) => item.symbol !== snapshot.symbol);
    db.marketSnapshots.push(snapshot);
    snapshots.push(snapshot);
  }

  const marketEvents = snapshots
    .filter((snapshot) => snapshot.price > 0)
    .map((snapshot) => buildMarketSignalEvent(snapshot, stockBySymbol.get(snapshot.symbol.toUpperCase())));

  marketEvents.forEach((event) => {
    db.rawEvents = db.rawEvents.filter((item) => item.id !== event.id);
    db.rawEvents.push(event);
    const opportunity = buildOpportunityFromEvent(event, db);
    db.scoredEvents = db.scoredEvents.filter((item) => item.eventId !== event.id);
    db.scoredEvents.push(opportunity);
  });

  const changedSymbols = new Set(snapshots.map((item) => item.symbol));
  db.scoredEvents = db.scoredEvents.map((opportunity) => {
    if (!changedSymbols.has(opportunity.symbol)) return opportunity;
    const event = db.rawEvents.find((item) => item.id === opportunity.eventId);
    return event ? buildOpportunityFromEvent(event, db) : opportunity;
  });

  if (snapshots.length) {
    db.ingestionRuns.push({
      id: `run-${Date.now()}`,
      type: "market-snapshots",
      status: "success",
      createdAt: new Date().toISOString(),
      imported: snapshots.length,
      scored: db.scoredEvents.filter((item) => changedSymbols.has(item.symbol)).length,
      marketSignals: marketEvents.length
    });
  }

  await writeDb(db);
  return snapshots;
};

export const getTrackedMarketStocks = async () => {
  const db = await readDb();
  const bySymbol = new Map();

  db.scoredEvents.forEach((item) => {
    bySymbol.set(item.symbol, {
      symbol: item.symbol,
      market: item.market,
      stockName: item.stockName,
      industry: item.industry
    });
  });
  db.dataSourceConfig.us.forEach((item) => {
    bySymbol.set(item.symbol, {
      symbol: item.symbol,
      market: "US",
      stockName: item.stockName,
      industry: item.industry
    });
  });
  db.dataSourceConfig.hk.forEach((item) => {
    bySymbol.set(item.symbol, {
      symbol: item.symbol,
      market: "HK",
      stockName: item.stockName,
      industry: item.industry
    });
  });

  return [...bySymbol.values()];
};

export const updatePerformance = async (watchlistId, payload) => {
  const db = await readDb();
  const existing = db.performanceTracking.find((item) => item.watchlistId === watchlistId);
  const patch = {
    watchlistId,
    t1: payload.t1 ?? null,
    t3: payload.t3 ?? null,
    t5: payload.t5 ?? null,
    t10: payload.t10 ?? null,
    t20: payload.t20 ?? null,
    relativeMarket: payload.relativeMarket ?? null,
    relativeIndustry: payload.relativeIndustry ?? null,
    maxDrawdown: payload.maxDrawdown ?? null,
    volumeChange: payload.volumeChange ?? null,
    followupCatalyst: payload.followupCatalyst ?? false,
    riskTriggered: payload.riskTriggered ?? false,
    verdict: payload.verdict || "待验证",
    review: payload.review || ""
  };

  if (existing) Object.assign(existing, patch);
  else db.performanceTracking.push(patch);
  await writeDb(db);
  return existing || patch;
};

export const regenerateWeeklyReview = async () => {
  const db = await readDb();
  const entries = db.watchlistEntries;
  const performanceById = new Map(db.performanceTracking.map((item) => [item.watchlistId, item]));
  const grades = ["S", "A", "B", "C", "D"].map((grade) => {
    const gradeEntries = entries.filter((item) => item.entryGrade === grade);
    const values = gradeEntries
      .map((item) => performanceById.get(item.id)?.t1)
      .filter((value) => Number.isFinite(value));
    const avgT1 = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      grade,
      count: gradeEntries.length,
      avgT1,
      verdict: avgT1 === null ? "样本不足" : avgT1 > 0 ? "初步有效" : "待确认"
    };
  });

  const eventStats = entries.reduce((acc, entry) => {
    const perf = performanceById.get(entry.id);
    if (!perf || !Number.isFinite(perf.t1)) return acc;
    acc[entry.eventType] ||= [];
    acc[entry.eventType].push(perf.t1);
    return acc;
  }, {});
  const rankedEvents = Object.entries(eventStats)
    .map(([eventType, values]) => ({
      eventType,
      avg: values.reduce((sum, value) => sum + value, 0) / values.length
    }))
    .sort((a, b) => b.avg - a.avg);

  db.weeklyReview = {
    id: `review-${new Date().toISOString().slice(0, 10)}`,
    week: new Date().toISOString().slice(0, 10),
    entryCount: entries.length,
    gradePerformance: grades,
    bestEventTypes: rankedEvents.slice(0, 2).map((item) => item.eventType),
    weakestEventTypes: rankedEvents.slice(-2).map((item) => item.eventType),
    effectiveDimensions: ["事件强度", "预期差", "市场验证"],
    failedHighScoreCases: [],
    lowScoreWinners: [],
    weightSuggestions: [
      rankedEvents.length ? "优先复核表现分化最大的事件类型。" : "样本不足，暂不建议调整权重。",
      "保持用户确认后再更新模型权重。"
    ]
  };
  await writeDb(db);
  return db.weeklyReview;
};

export const writeDb = async (db) => {
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(getDbPath(), `${JSON.stringify(db, null, 2)}\n`, "utf8");
};

export const getDataSourceConfig = async () => {
  const db = await readDb();
  return db.dataSourceConfig;
};

export const upsertDataSourceStock = async (market, payload) => {
  const db = await readDb();
  const key = market.toLowerCase();
  if (!["us", "hk"].includes(key)) return { error: "market must be US or HK" };

  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const code = String(payload.code || "").trim().padStart(key === "hk" && payload.code ? 5 : 0, "0");
  if (key === "us" && !symbol) return { error: "symbol is required" };
  if (key === "hk" && !code) return { error: "code is required" };

  const stock =
    key === "us"
      ? {
          symbol,
          stockName: payload.stockName || symbol,
          cik: payload.cik || "",
          industry: payload.industry || "未分类"
        }
      : {
          code,
          symbol: payload.symbol || `${code.replace(/^0+/, "")}.HK`,
          stockName: payload.stockName || payload.name || code,
          industry: payload.industry || "未分类"
        };

  db.dataSourceConfig[key] = (db.dataSourceConfig[key] || []).filter((item) =>
    key === "us" ? item.symbol.toUpperCase() !== stock.symbol.toUpperCase() : item.code !== stock.code
  );
  db.dataSourceConfig[key].push(stock);
  await writeDb(db);
  return stock;
};

export const removeDataSourceStock = async (market, symbolOrCode) => {
  const db = await readDb();
  const key = market.toLowerCase();
  if (!["us", "hk"].includes(key)) return { error: "market must be US or HK" };
  const target = String(symbolOrCode || "").trim().toUpperCase();
  const before = db.dataSourceConfig[key].length;
  db.dataSourceConfig[key] = db.dataSourceConfig[key].filter((item) => {
    if (key === "us") return item.symbol.toUpperCase() !== target;
    return item.code !== target.padStart(5, "0") && item.symbol.toUpperCase() !== target;
  });
  await writeDb(db);
  return { removed: before - db.dataSourceConfig[key].length };
};

export const createBackup = async () => {
  const db = await readDb();
  const backupDir = path.join(getDataDir(), "backups");
  await mkdir(backupDir, { recursive: true });
  const safeDate = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `radar-db-${safeDate}.json`);
  await writeFile(backupPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  return {
    path: backupPath,
    createdAt: new Date().toISOString(),
    records: {
      rawEvents: db.rawEvents.length,
      opportunities: db.scoredEvents.length,
      watchlist: db.watchlistEntries.length,
      personalActions: db.personalActions.length
    }
  };
};

export const getSystemStatus = async () => {
  const db = await readDb();
  const lastRun = db.ingestionRuns.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const symbols = new Set(db.scoredEvents.map((item) => item.symbol));
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    dbPath: getDbPath(),
    lastRun,
    records: {
      rawEvents: db.rawEvents.length,
      opportunities: db.scoredEvents.length,
      groupedStocks: symbols.size,
      watchlist: db.watchlistEntries.length,
      customIndustries: db.customIndustries.length,
      marketSnapshots: db.marketSnapshots.length
    },
    dataSources: {
      us: db.dataSourceConfig.us.length,
      hk: db.dataSourceConfig.hk.length
    }
  };
};

export const recordFeishuEvent = async (event) => {
  const db = await readDb();
  const entry = {
    id: `feishu-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...event
  };
  db.feishuEvents.push(entry);
  db.feishuEvents = db.feishuEvents.slice(-100);
  await writeDb(db);
  return entry;
};

export const addWatchlistEntry = async ({ opportunityId, entryPrice = null }) => {
  const db = await readDb();
  const opportunity = db.scoredEvents.find((item) => item.id === opportunityId);
  if (!opportunity) return null;

  const existing = db.watchlistEntries.find((item) => item.opportunityId === opportunity.id);
  if (existing) return existing;

  const entry = {
    id: `wl-${opportunity.symbol.toLowerCase().replace(".", "-")}-${Date.now()}`,
    opportunityId: opportunity.id,
    symbol: opportunity.symbol,
    stockName: opportunity.stockName,
    market: opportunity.market,
    industry: opportunity.industry,
    entryDate: new Date().toISOString().slice(0, 10),
    entryPrice,
    entryScore: opportunity.score,
    entryGrade: opportunity.grade,
    eventType: opportunity.eventType,
    status: "待验证"
  };

  db.watchlistEntries.push(entry);
  await writeDb(db);
  return entry;
};

export const addCustomIndustry = async (payload) => {
  const db = await readDb();
  const industry = {
    id: `ci-${Date.now()}`,
    name: payload.name,
    keywords: payload.keywords || [],
    stockPool: payload.stockPool || [],
    eventKeywords: payload.eventKeywords || [],
    excludedKeywords: payload.excludedKeywords || [],
    priority: payload.priority || "中",
    enabled: payload.enabled ?? true,
    pushEnabled: payload.pushEnabled ?? false,
    note: payload.note || ""
  };

  db.customIndustries.push(industry);
  await writeDb(db);
  return industry;
};

export const updateCustomIndustry = async (id, payload) => {
  const db = await readDb();
  const index = db.customIndustries.findIndex((item) => item.id === id);
  if (index < 0) return null;

  db.customIndustries[index] = {
    ...db.customIndustries[index],
    ...payload,
    id
  };
  await writeDb(db);
  return db.customIndustries[index];
};

export const removeCustomIndustry = async (id) => {
  const db = await readDb();
  const before = db.customIndustries.length;
  db.customIndustries = db.customIndustries.filter((item) => item.id !== id);
  await writeDb(db);
  return { removed: before - db.customIndustries.length };
};

export const addPersonalAction = async (payload) => {
  const db = await readDb();
  const opportunity = db.scoredEvents.find((item) => item.id === payload.opportunityId);
  const action = {
    id: `pa-${Date.now()}`,
    opportunityId: payload.opportunityId || null,
    symbol: payload.symbol || opportunity?.symbol || null,
    eventId: payload.eventId || opportunity?.eventId || null,
    actionType: payload.actionType || "重点跟踪",
    recordPrice: payload.recordPrice ?? null,
    recordedAt: new Date().toISOString(),
    note: payload.note || "",
    reviewResult: payload.reviewResult || ""
  };

  db.personalActions.push(action);
  await writeDb(db);
  return action;
};

export const confirmModelSuggestion = async (id) => {
  const db = await readDb();
  const suggestion = db.modelSuggestions.find((item) => item.id === id);
  if (!suggestion) return null;

  suggestion.status = "confirmed";
  suggestion.confirmedAt = new Date().toISOString();
  db.modelVersion = {
    ...db.modelVersion,
    id: `${db.modelVersion.id}+${id}`,
    effectiveDate: new Date().toISOString().slice(0, 10),
    weights: suggestion.suggestedWeights
  };

  await writeDb(db);
  return { suggestion, modelVersion: db.modelVersion };
};
