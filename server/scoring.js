const positiveEventBase = {
  财报超预期: 17,
  指引上调: 18,
  "订单/合作": 16,
  产品发布: 13,
  监管审批: 16,
  并购重组: 15,
  股票回购: 12,
  管理层增持: 13,
  分析师上调评级: 11,
  行业政策利好: 14,
  行业主题升温: 12,
  空头回补可能: 12
};

const riskEventBase = {
  业绩下修: 7,
  监管调查: 7,
  诉讼风险: 6,
  融资摊薄: 6,
  流动性风险: 5
};

const sourceBonus = { A: 3, B: 2, C: 1, D: 0 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const gradeFromScore = (score) => {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
};

const conclusionFromGrade = (grade) => {
  if (grade === "S") return "纳入观察池";
  if (grade === "A" || grade === "B") return "继续跟踪";
  if (grade === "C") return "信息不足";
  return "风险偏高";
};

const unique = (items) => [...new Set(items.filter(Boolean))];

const matchCustomIndustry = (event, industries) =>
  industries.find((industry) => {
    if (!industry.enabled) return false;
    const text = [event.industry, event.title, event.summary, event.symbol, event.stockName].join(" ");
    return (
      industry.stockPool?.includes(event.symbol) ||
      industry.keywords?.some((keyword) => text.includes(keyword)) ||
      industry.eventKeywords?.some((keyword) => text.includes(keyword))
    );
  });

const hasRiskKeyword = (event, industries) => {
  const text = [event.title, event.summary].join(" ");
  return industries.some((industry) => industry.excludedKeywords?.some((keyword) => text.includes(keyword)));
};

const marketValidationScore = (snapshot) => {
  if (!snapshot) return { score: 7, reason: "暂无行情快照，市场验证保持中性。" };
  let score = 7;
  if (snapshot.changePct > 2) score += 3;
  if (snapshot.changePct > 5) score += 2;
  if (snapshot.relativeMarketPct > 1) score += 2;
  if (snapshot.volumeRatio > 1.5) score += 2;
  if (snapshot.changePct < -2) score -= 3;
  if (snapshot.relativeMarketPct < -1) score -= 2;
  return {
    score: clamp(score, 0, 15),
    reason: snapshot.changePct >= 0 ? "价格或成交量存在正向验证。" : "价格验证偏弱，需要继续观察。"
  };
};

export const buildOpportunityFromEvent = (event, db) => {
  const eventBase = positiveEventBase[event.eventType] ?? riskEventBase[event.eventType] ?? 10;
  const isRiskEvent = Boolean(riskEventBase[event.eventType]);
  const industryMatch = matchCustomIndustry(event, db.customIndustries || []);
  const riskKeywordMatched = hasRiskKeyword(event, db.customIndustries || []);
  const snapshot = (db.marketSnapshots || []).find((item) => item.symbol === event.symbol);
  const market = marketValidationScore(snapshot);

  const eventStrength = clamp(eventBase + (sourceBonus[event.sourceCredibility] || 0), 0, 20);
  const expectationGap = clamp((isRiskEvent ? 7 : 13) + (event.isNewInfo === false ? -4 : 3), 0, 20);
  const catalystCertainty = clamp(event.catalystDate ? 13 : event.followupSignals?.length ? 11 : 8, 0, 15);
  const trendFit = clamp((industryMatch ? 9 : 5) + (industryMatch?.priority === "高" ? 1 : 0), 0, 10);
  const valuationSupport = clamp(isRiskEvent ? 5 : 7 + (event.fundamentalSupport === "strong" ? 2 : 0), 0, 10);
  const riskCounter = clamp(isRiskEvent || riskKeywordMatched ? 4 : 8, 0, 10);
  const score = Math.round(
    eventStrength +
      expectationGap +
      catalystCertainty +
      market.score +
      trendFit +
      valuationSupport +
      riskCounter
  );
  const grade = gradeFromScore(score);

  const reasons = unique([
    eventStrength >= 16 ? "事件影响收入、利润、估值或业务预期。" : "事件存在边际变化但强度仍需确认。",
    expectationGap >= 15 ? "信息增量可能改变市场预期。" : "预期差仍需后续数据验证。",
    market.score >= 11 ? "价格、成交量或相对表现已有市场验证。" : null,
    industryMatch ? `匹配自定义行业：${industryMatch.name}。` : null
  ]).slice(0, 3);

  const risks = unique([
    isRiskEvent ? "事件本身带有负向反证，需要降低观察优先级。" : null,
    market.score <= 6 ? "市场验证偏弱，可能只是信息噪音。" : null,
    riskKeywordMatched ? "命中自定义排除词，需复核信息质量。" : null,
    "后续催化不兑现会削弱事件逻辑。"
  ]).slice(0, 3);

  const watchSignals = unique([
    ...(event.followupSignals || []),
    event.catalystDate ? `观察${event.catalystDate}前后的催化进展。` : null,
    "观察成交量能否维持高于20日均量。",
    "观察是否出现风险反证或信息修正。"
  ]).slice(0, 3);

  return {
    id: `opp-${event.symbol.toLowerCase().replace(".", "-")}-${event.id}`,
    eventId: event.id,
    symbol: event.symbol,
    stockName: event.stockName,
    market: event.market,
    industry: industryMatch?.name || event.industry,
    eventType: event.eventType,
    score,
    grade,
    conclusion: conclusionFromGrade(grade),
    event: event.summary || event.title,
    reasons,
    risks,
    watchSignals,
    dimensions: {
      eventStrength: { score: eventStrength, reason: "按事件类型和来源可信度评分。" },
      expectationGap: { score: expectationGap, reason: "按是否为7日新增信息和预期影响评分。" },
      catalystCertainty: { score: catalystCertainty, reason: "按后续时间窗口和可跟踪信号评分。" },
      marketValidation: market,
      trendFit: { score: trendFit, reason: industryMatch ? "命中自定义重点行业。" : "未命中自定义重点行业。" },
      valuationSupport: { score: valuationSupport, reason: "内测版使用基础支撑假设，后续接财务数据。" },
      riskCounter: { score: riskCounter, reason: riskKeywordMatched ? "命中风险排除词。" : "暂无重大风险反证。" }
    }
  };
};

export const normalizeRawEvent = (payload) => ({
  id: payload.id || `evt-${Date.now()}`,
  symbol: String(payload.symbol || "").trim().toUpperCase(),
  stockName: String(payload.stockName || "").trim(),
  market: payload.market || "US",
  industry: payload.industry || "未分类",
  eventType: payload.eventType || "行业主题升温",
  source: payload.source || "Manual input",
  sourceCredibility: payload.sourceCredibility || "B",
  publishedAt: payload.publishedAt || new Date().toISOString(),
  title: payload.title || payload.summary || "未命名事件",
  summary: payload.summary || payload.title || "暂无摘要",
  url: payload.url || "",
  isNewInfo: payload.isNewInfo ?? true,
  catalystDate: payload.catalystDate || "",
  followupSignals: payload.followupSignals || [],
  fundamentalSupport: payload.fundamentalSupport || "normal"
});
