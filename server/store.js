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
  watchlistEntries: watchlistEntries.map(normalizeWatchEntry),
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

const defaultNewsFeeds = [
  {
    id: "feed-yahoo-finance",
    name: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
    enabled: true,
    sourceCredibility: "B",
    note: "公共财经新闻RSS，按采集池股票名称和代码匹配。"
  }
];

const isPriorityGrade = (grade) => ["S", "A"].includes(grade);
const isAutoWatchGrade = (grade) => ["S", "A", "B"].includes(grade);
const watchStatusForGrade = (grade) => (isPriorityGrade(grade) ? "重点关注" : "普通观察");

const buildWatchEntryFromOpportunity = (opportunity, entryPrice = null, existing = null) => {
  const now = new Date().toISOString();
  const entryDate = existing?.entryDate || now.slice(0, 10);
  const isPriorityWatch = isPriorityGrade(opportunity.grade);
  const trackingStatus = watchStatusForGrade(opportunity.grade);

  return {
    ...(existing || {}),
    id: existing?.id || `wl-${opportunity.symbol.toLowerCase().replace(".", "-")}-${opportunity.eventId || Date.now()}`,
    opportunityId: opportunity.id,
    symbol: opportunity.symbol,
    stockCode: opportunity.symbol,
    stockName: opportunity.stockName,
    market: opportunity.market,
    industry: opportunity.industry,
    entryDate,
    entryPrice: entryPrice ?? existing?.entryPrice ?? null,
    entryScore: existing?.entryScore ?? opportunity.score,
    entryGrade: existing?.entryGrade ?? opportunity.grade,
    entryLevel: existing?.entryLevel ?? opportunity.grade,
    eventType: opportunity.eventType,
    triggerEvent: existing?.triggerEvent ?? opportunity.event,
    entryReason: existing?.entryReason ?? opportunity.reasons ?? [],
    keyRisks: existing?.keyRisks ?? opportunity.risks ?? [],
    followUpPoints: existing?.followUpPoints ?? opportunity.watchSignals ?? [],
    status: existing?.status || "待验证",
    trackingStatus: existing?.trackingStatus ?? trackingStatus,
    isPriorityWatch: existing?.isPriorityWatch ?? isPriorityWatch,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
};

const normalizeWatchEntry = (entry) => ({
  ...entry,
  stockCode: entry.stockCode || entry.symbol,
  entryLevel: entry.entryLevel || entry.entryGrade,
  triggerEvent: entry.triggerEvent || entry.eventType,
  entryReason: entry.entryReason || [],
  keyRisks: entry.keyRisks || [],
  followUpPoints: entry.followUpPoints || [],
  trackingStatus: entry.trackingStatus || watchStatusForGrade(entry.entryGrade),
  isPriorityWatch: entry.isPriorityWatch ?? isPriorityGrade(entry.entryGrade),
  createdAt: entry.createdAt || `${entry.entryDate || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  updatedAt: entry.updatedAt || new Date().toISOString()
});

const syncWatchPoolForOpportunities = (db, opportunities) => {
  const synced = [];
  opportunities.forEach((opportunity) => {
    if (!opportunity || !isAutoWatchGrade(opportunity.grade)) return;
    const existing = db.watchlistEntries.find((item) => item.opportunityId === opportunity.id);
    const snapshot = db.marketSnapshots.find((item) => item.symbol === opportunity.symbol);
    const entryPrice = existing?.entryPrice ?? snapshot?.price ?? null;
    const entry = buildWatchEntryFromOpportunity(opportunity, entryPrice, existing);
    if (existing) Object.assign(existing, entry);
    else db.watchlistEntries.push(entry);
    synced.push(entry);
  });
  return synced;
};

const dayMs = 24 * 60 * 60 * 1000;
const daysSinceEntry = (entryDate, trackingDate) => {
  const start = new Date(`${entryDate}T00:00:00.000Z`);
  const end = new Date(trackingDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / dayMs);
};

const trackingBucketForDays = (days) => {
  if (days >= 20) return "t20";
  if (days >= 10) return "t10";
  if (days >= 5) return "t5";
  if (days >= 3) return "t3";
  if (days >= 1) return "t1";
  return null;
};

const roundPct = (value) => Number(value.toFixed(2));

const syncPerformanceFromSnapshots = (db, snapshots) => {
  const synced = [];
  snapshots.forEach((snapshot) => {
    const entries = db.watchlistEntries.filter((entry) => entry.symbol === snapshot.symbol);
    entries.forEach((entry) => {
      if (!entry.entryPrice && snapshot.price > 0) {
        entry.entryPrice = snapshot.price;
        entry.updatedAt = new Date().toISOString();
      }
      if (!entry.entryPrice || !snapshot.price) return;

      const bucket = trackingBucketForDays(daysSinceEntry(entry.entryDate, snapshot.capturedAt || new Date().toISOString()));
      if (!bucket) return;

      const existing = db.performanceTracking.find((item) => item.watchlistId === entry.id);
      const trackedReturn = roundPct(((snapshot.price - entry.entryPrice) / entry.entryPrice) * 100);
      const patch = {
        ...(existing || {}),
        watchlistId: entry.id,
        stockCode: entry.symbol,
        market: entry.market,
        entryDate: entry.entryDate,
        trackingDate: String(snapshot.capturedAt || new Date().toISOString()).slice(0, 10),
        price: snapshot.price,
        t1: existing?.t1 ?? null,
        t3: existing?.t3 ?? null,
        t5: existing?.t5 ?? null,
        t10: existing?.t10 ?? null,
        t20: existing?.t20 ?? null,
        relativeMarket: Number.isFinite(snapshot.relativeMarketPct) ? snapshot.relativeMarketPct : existing?.relativeMarket ?? null,
        relativeIndustry: Number.isFinite(snapshot.relativeIndustryPct) ? snapshot.relativeIndustryPct : existing?.relativeIndustry ?? null,
        maxDrawdown: Math.min(existing?.maxDrawdown ?? 0, trackedReturn),
        volumeChange: Number.isFinite(snapshot.volumeRatio) ? roundPct((snapshot.volumeRatio - 1) * 100) : existing?.volumeChange ?? null,
        followupCatalyst: existing?.followupCatalyst ?? false,
        riskTriggered: existing?.riskTriggered ?? (snapshot.changePct <= -2 || snapshot.relativeMarketPct <= -1.5),
        verdict: snapshot.relativeMarketPct > 0 && trackedReturn > 0 ? "自动验证：初步有效" : "自动验证：待确认",
        review: `行情自动跟踪：${snapshot.symbol} 当前价${snapshot.price}，${bucket.toUpperCase()} ${trackedReturn}%。`
      };
      patch[bucket] = trackedReturn;

      if (existing) Object.assign(existing, patch);
      else db.performanceTracking.push(patch);
      synced.push(patch);
    });
  });
  return synced;
};

const normalizeWeights = (weights) => {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (total === 100) return weights;
  const diff = 100 - total;
  return {
    ...weights,
    eventStrength: Math.max(0, Number(weights.eventStrength || 0) + diff)
  };
};

const buildModelSuggestionFromReview = (db, review, context) => {
  const current = db.modelVersion.weights;
  const hasEnoughSamples = Number(review.priorityEntryCount || 0) >= 2;
  if (!hasEnoughSamples) return null;

  const hasHighScoreFailures = review.failedHighScoreCases.length > 0;
  const hasLowScoreWinners = review.lowScoreWinners.length > 0;
  const weakMarketValidation = Number(review.marketWinRate ?? 1) < 0.5;
  const weakIndustryValidation = Number(review.industryWinRate ?? 1) < 0.5;
  const strongPriorityResult = Number(review.priorityAverageReturn ?? 0) > 0 && Number(review.marketWinRate ?? 0) >= 0.5;

  if (!hasHighScoreFailures && !hasLowScoreWinners && !weakMarketValidation && !weakIndustryValidation && !strongPriorityResult) return null;

  let suggestedWeights = { ...current };
  let reason = "重点关注池复盘建议微调模型权重。";

  if (hasHighScoreFailures || weakMarketValidation) {
    suggestedWeights = {
      ...suggestedWeights,
      marketValidation: Number(suggestedWeights.marketValidation || 0) + 2,
      riskCounter: Number(suggestedWeights.riskCounter || 0) + 1,
      eventStrength: Number(suggestedWeights.eventStrength || 0) - 2,
      trendFit: Number(suggestedWeights.trendFit || 0) - 1
    };
    reason = hasHighScoreFailures
      ? "高分失败样本出现，建议提高市场验证和风险反证权重。"
      : "S/A样本跑赢大盘比例偏低，建议提高市场验证权重。";
  } else if (hasLowScoreWinners) {
    suggestedWeights = {
      ...suggestedWeights,
      expectationGap: Number(suggestedWeights.expectationGap || 0) + 1,
      trendFit: Number(suggestedWeights.trendFit || 0) + 1,
      valuationSupport: Number(suggestedWeights.valuationSupport || 0) - 1,
      eventStrength: Number(suggestedWeights.eventStrength || 0) - 1
    };
    reason = "低分走强样本出现，建议提高预期差和产业趋势识别权重。";
  } else if (weakIndustryValidation) {
    suggestedWeights = {
      ...suggestedWeights,
      trendFit: Number(suggestedWeights.trendFit || 0) - 1,
      marketValidation: Number(suggestedWeights.marketValidation || 0) + 1
    };
    reason = "跑赢行业比例偏低，建议降低行业匹配加分、提高市场验证。";
  } else if (strongPriorityResult) {
    suggestedWeights = {
      ...suggestedWeights,
      expectationGap: Number(suggestedWeights.expectationGap || 0) + 1,
      catalystCertainty: Number(suggestedWeights.catalystCertainty || 0) + 1,
      valuationSupport: Number(suggestedWeights.valuationSupport || 0) - 1,
      eventStrength: Number(suggestedWeights.eventStrength || 0) - 1
    };
    reason = "S/A样本初步跑赢，建议小幅强化预期差和催化剂权重。";
  }

  return {
    id: `ms-review-${review.week}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    reason,
    evidence: {
      priorityEntryCount: review.priorityEntryCount,
      priorityAverageReturn: review.priorityAverageReturn,
      marketWinRate: review.marketWinRate,
      industryWinRate: review.industryWinRate,
      failedHighScoreCases: review.failedHighScoreCases,
      lowScoreWinners: review.lowScoreWinners,
      bestEventTypes: review.bestEventTypes,
      weakestEventTypes: review.weakestEventTypes,
      industryStats: review.industryStats,
      sampleSize: context.priorityPerformance.length
    },
    suggestedWeights: normalizeWeights(suggestedWeights)
  };
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
    watchlistEntries: (db.watchlistEntries || []).map(normalizeWatchEntry),
    performanceTracking: db.performanceTracking || [],
    customIndustries: db.customIndustries || [],
    weeklyReview: db.weeklyReview || weeklyReview,
    modelVersion: db.modelVersion || modelVersion,
    modelSuggestions: db.modelSuggestions || [],
    personalActions: db.personalActions || [],
    marketSnapshots: db.marketSnapshots || [],
    ingestionRuns: db.ingestionRuns || [],
    dataSourceConfig: db.dataSourceConfig || seedDataSourceConfig,
    newsFeeds: db.newsFeeds || defaultNewsFeeds,
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
    const db = ensureShape(seedDb());
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
  syncWatchPoolForOpportunities(db, [opportunity]);
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

  syncWatchPoolForOpportunities(
    db,
    results.filter((item) => item.opportunity).map((item) => item.opportunity)
  );

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
  syncWatchPoolForOpportunities(db, db.scoredEvents.filter((item) => item.symbol === snapshot.symbol));
  const performanceSynced = syncPerformanceFromSnapshots(db, [snapshot]);
  await writeDb(db);
  return { ...snapshot, performanceSynced: performanceSynced.length };
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
  syncWatchPoolForOpportunities(db, db.scoredEvents.filter((item) => changedSymbols.has(item.symbol)));
  const performanceSynced = syncPerformanceFromSnapshots(db, snapshots);
  snapshots.performanceSynced = performanceSynced.length;

  if (snapshots.length) {
    db.ingestionRuns.push({
      id: `run-${Date.now()}`,
      type: "market-snapshots",
      status: "success",
      createdAt: new Date().toISOString(),
      imported: snapshots.length,
      scored: db.scoredEvents.filter((item) => changedSymbols.has(item.symbol)).length,
      marketSignals: marketEvents.length,
      performanceSynced: performanceSynced.length
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
  const entry = db.watchlistEntries.find((item) => item.id === watchlistId);
  const patch = {
    watchlistId,
    stockCode: payload.stockCode || entry?.symbol || existing?.stockCode || "",
    market: payload.market || entry?.market || existing?.market || "",
    entryDate: payload.entryDate || entry?.entryDate || existing?.entryDate || "",
    trackingDate: payload.trackingDate || new Date().toISOString().slice(0, 10),
    price: payload.price ?? existing?.price ?? null,
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
  const priorityEntries = entries.filter((item) => item.isPriorityWatch);
  const performanceById = new Map(db.performanceTracking.map((item) => [item.watchlistId, item]));
  const latestTrackedReturn = (perf) => [perf?.t20, perf?.t10, perf?.t5, perf?.t3, perf?.t1].find((value) => Number.isFinite(value));
  const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const winRate = (values) => (values.length ? values.filter((value) => Number.isFinite(value) && value > 0).length / values.length : null);

  const grades = ["S", "A", "B", "C", "D"].map((grade) => {
    const gradeEntries = entries.filter((item) => item.entryGrade === grade);
    const values = gradeEntries
      .map((item) => latestTrackedReturn(performanceById.get(item.id)))
      .filter((value) => Number.isFinite(value));
    const avgReturn = average(values);
    return {
      grade,
      count: gradeEntries.length,
      avgT1: avgReturn,
      avgReturn,
      verdict: avgReturn === null ? "样本不足" : avgReturn > 0 ? "初步有效" : "待确认"
    };
  });

  const eventStats = entries.reduce((acc, entry) => {
    const perf = performanceById.get(entry.id);
    const trackedReturn = latestTrackedReturn(perf);
    if (!Number.isFinite(trackedReturn)) return acc;
    acc[entry.eventType] ||= [];
    acc[entry.eventType].push(trackedReturn);
    return acc;
  }, {});
  const rankedEvents = Object.entries(eventStats)
    .map(([eventType, values]) => ({
      eventType,
      count: values.length,
      avg: values.reduce((sum, value) => sum + value, 0) / values.length
    }))
    .sort((a, b) => b.avg - a.avg);

  const trackedEntries = entries.map((entry) => ({
    entry,
    perf: performanceById.get(entry.id),
    trackedReturn: latestTrackedReturn(performanceById.get(entry.id))
  }));
  const priorityPerformance = trackedEntries.filter((item) => item.entry.isPriorityWatch);
  const priorityReturns = priorityPerformance.map((item) => item.trackedReturn).filter((value) => Number.isFinite(value));
  const sReturns = priorityPerformance
    .filter((item) => item.entry.entryGrade === "S")
    .map((item) => item.trackedReturn)
    .filter((value) => Number.isFinite(value));
  const aReturns = priorityPerformance
    .filter((item) => item.entry.entryGrade === "A")
    .map((item) => item.trackedReturn)
    .filter((value) => Number.isFinite(value));
  const relativeMarketValues = priorityPerformance
    .map((item) => item.perf?.relativeMarket)
    .filter((value) => Number.isFinite(value));
  const relativeIndustryValues = priorityPerformance
    .map((item) => item.perf?.relativeIndustry)
    .filter((value) => Number.isFinite(value));
  const failedHighScoreCases = priorityPerformance
    .filter((item) => item.entry.entryScore >= 85 && Number.isFinite(item.trackedReturn) && item.trackedReturn < 0)
    .slice(0, 3)
    .map((item) => `${item.entry.symbol} ${item.entry.eventType}`);
  const lowScoreWinners = trackedEntries
    .filter((item) => item.entry.entryScore < 75 && Number.isFinite(item.trackedReturn) && item.trackedReturn > 3)
    .sort((a, b) => b.trackedReturn - a.trackedReturn)
    .slice(0, 3)
    .map((item) => `${item.entry.symbol} ${item.entry.eventType} ${item.trackedReturn.toFixed(1)}%`);
  const industryStats = Object.values(
    trackedEntries.reduce((acc, item) => {
      if (!Number.isFinite(item.trackedReturn)) return acc;
      const key = item.entry.industry || "未分类";
      acc[key] ||= { industry: key, count: 0, avgReturn: 0, winCount: 0 };
      acc[key].count += 1;
      acc[key].avgReturn += item.trackedReturn;
      if (item.trackedReturn > 0) acc[key].winCount += 1;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      avgReturn: item.avgReturn / item.count,
      winRate: item.count ? item.winCount / item.count : null
    }))
    .sort((a, b) => b.avgReturn - a.avgReturn)
    .slice(0, 6);

  db.weeklyReview = {
    id: `review-${new Date().toISOString().slice(0, 10)}`,
    week: new Date().toISOString().slice(0, 10),
    entryCount: entries.length,
    priorityEntryCount: priorityEntries.length,
    sAverageReturn: average(sReturns),
    aAverageReturn: average(aReturns),
    priorityAverageReturn: average(priorityReturns),
    marketWinRate: winRate(relativeMarketValues),
    industryWinRate: winRate(relativeIndustryValues),
    gradePerformance: grades,
    eventTypeStats: rankedEvents,
    industryStats,
    bestEventTypes: rankedEvents.slice(0, 2).map((item) => item.eventType),
    weakestEventTypes: rankedEvents.slice(-2).map((item) => item.eventType),
    effectiveDimensions: ["事件强度", "预期差", "市场验证"],
    failedHighScoreCases,
    lowScoreWinners,
    weightSuggestions: [
      rankedEvents.length ? "优先复核表现分化最大的事件类型。" : "样本不足，暂不建议调整权重。",
      failedHighScoreCases.length ? "高分失败样本出现，建议提高风险反证和追高风险复核权重。" : "暂无明显高分失败样本。",
      lowScoreWinners.length ? "低分走强样本出现，建议复核预期差或行业趋势识别是否偏保守。" : "暂无明显低分走强遗漏样本。",
      "保持用户确认后再更新模型权重。"
    ]
  };
  const modelSuggestion = buildModelSuggestionFromReview(db, db.weeklyReview, { priorityPerformance });
  if (modelSuggestion) {
    const existing = db.modelSuggestions.find((item) => item.id === modelSuggestion.id);
    if (!existing) db.modelSuggestions.push(modelSuggestion);
    else if (existing.status === "pending") Object.assign(existing, modelSuggestion);
    db.weeklyReview.modelSuggestionId = modelSuggestion.id;
  }
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

export const getNewsFeeds = async () => {
  const db = await readDb();
  return db.newsFeeds || [];
};

export const upsertNewsFeed = async (payload) => {
  const db = await readDb();
  const feed = {
    id: payload.id || `feed-${Date.now()}`,
    name: payload.name || "RSS",
    url: payload.url || "",
    enabled: payload.enabled ?? true,
    sourceCredibility: payload.sourceCredibility || "B",
    note: payload.note || ""
  };
  if (!feed.url) return { error: "url is required" };
  db.newsFeeds = (db.newsFeeds || []).filter((item) => item.id !== feed.id && item.url !== feed.url);
  db.newsFeeds.push(feed);
  await writeDb(db);
  return feed;
};

export const removeNewsFeed = async (id) => {
  const db = await readDb();
  const before = (db.newsFeeds || []).length;
  db.newsFeeds = (db.newsFeeds || []).filter((item) => item.id !== id);
  await writeDb(db);
  return { removed: before - db.newsFeeds.length };
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
      marketSnapshots: db.marketSnapshots.length,
      newsFeeds: db.newsFeeds.length
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
  const entry = buildWatchEntryFromOpportunity(opportunity, entryPrice, existing);

  if (existing) Object.assign(existing, entry);
  else db.watchlistEntries.push(entry);
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
