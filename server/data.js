export const modelVersion = {
  id: "v0.1-mvp",
  effectiveDate: "2026-06-08",
  weights: {
    eventStrength: 20,
    expectationGap: 20,
    catalystCertainty: 15,
    marketValidation: 15,
    trendFit: 10,
    valuationSupport: 10,
    riskCounter: 10
  }
};

export const customIndustries = [
  {
    id: "ci-ai-infra",
    name: "AI算力",
    keywords: ["AI", "GPU", "数据中心", "算力", "液冷", "光模块"],
    stockPool: ["NVDA", "AMD", "AVGO", "1810.HK"],
    eventKeywords: ["订单", "扩产", "指引上调", "合作", "新品"],
    excludedKeywords: ["监管调查", "减持", "诉讼"],
    priority: "高",
    enabled: true,
    pushEnabled: true,
    note: "重点跟踪AI基础设施链条的信息增量。"
  },
  {
    id: "ci-biotech",
    name: "创新药",
    keywords: ["FDA", "临床", "获批", "适应症", "BD", "药物"],
    stockPool: ["VRTX", "MRNA", "2269.HK", "6160.HK"],
    eventKeywords: ["获批", "临床数据", "授权合作", "里程碑"],
    excludedKeywords: ["失败", "暂停", "安全性"],
    priority: "中",
    enabled: true,
    pushEnabled: false,
    note: "关注审批、临床数据和商业化拐点。"
  }
];

export const rawEvents = [
  {
    id: "evt-nvda-001",
    symbol: "NVDA",
    stockName: "NVIDIA",
    market: "US",
    industry: "AI算力",
    eventType: "指引上调",
    source: "Company earnings release",
    sourceCredibility: "A",
    publishedAt: "2026-06-05T21:30:00Z",
    title: "NVIDIA raised near-term revenue guidance on data center demand",
    summary: "公司上调短期收入指引，核心驱动来自数据中心需求。"
  },
  {
    id: "evt-1810-001",
    symbol: "1810.HK",
    stockName: "小米集团",
    market: "HK",
    industry: "智能硬件",
    eventType: "产品发布",
    source: "Company announcement",
    sourceCredibility: "A",
    publishedAt: "2026-06-04T10:00:00Z",
    title: "Xiaomi announced product and delivery updates",
    summary: "公司发布新品与交付进展，市场关注硬件生态协同。"
  },
  {
    id: "evt-vrtx-001",
    symbol: "VRTX",
    stockName: "Vertex Pharmaceuticals",
    market: "US",
    industry: "创新药",
    eventType: "监管审批",
    source: "FDA update",
    sourceCredibility: "A",
    publishedAt: "2026-06-03T14:00:00Z",
    title: "Vertex received regulatory progress on pipeline asset",
    summary: "核心管线取得监管进展，后续商业化节奏成为验证点。"
  },
  {
    id: "evt-0700-001",
    symbol: "0700.HK",
    stockName: "腾讯控股",
    market: "HK",
    industry: "互联网平台",
    eventType: "股票回购",
    source: "HKEX announcement",
    sourceCredibility: "A",
    publishedAt: "2026-06-02T09:30:00Z",
    title: "Tencent continued share repurchases",
    summary: "公司持续回购，释放资本配置和股东回报信号。"
  },
  {
    id: "evt-tsla-001",
    symbol: "TSLA",
    stockName: "Tesla",
    market: "US",
    industry: "智能汽车",
    eventType: "监管调查",
    source: "Financial media",
    sourceCredibility: "B",
    publishedAt: "2026-06-06T16:20:00Z",
    title: "Tesla faces renewed regulatory scrutiny",
    summary: "公司相关业务面临监管审查，短期反证风险升高。"
  }
];

export const scoredEvents = [
  {
    id: "opp-nvda",
    eventId: "evt-nvda-001",
    symbol: "NVDA",
    stockName: "NVIDIA",
    market: "US",
    industry: "AI算力",
    eventType: "指引上调",
    score: 88,
    grade: "S",
    conclusion: "纳入观察池",
    event: "最近7天公司上调短期收入指引，数据中心需求仍是核心增量。",
    reasons: [
      "指引变化直接影响收入预期。",
      "AI算力需求与用户重点行业高度匹配。",
      "价格与成交量已有初步正向验证。"
    ],
    risks: [
      "估值可能已反映较高乐观预期。",
      "供应链或出口限制可能影响兑现。",
      "高位波动会放大回撤风险。"
    ],
    watchSignals: [
      "观察后续订单和交付节奏。",
      "观察成交量能否持续高于20日均量。",
      "观察行业链公司是否同步走强。"
    ],
    dimensions: {
      eventStrength: { score: 18, reason: "指引上调影响核心收入变量。" },
      expectationGap: { score: 18, reason: "需求韧性可能继续上修预期。" },
      catalystCertainty: { score: 13, reason: "后续财报和供应链数据可验证。" },
      marketValidation: { score: 13, reason: "价格和成交量已有初步确认。" },
      trendFit: { score: 10, reason: "匹配AI算力自定义重点行业。" },
      valuationSupport: { score: 7, reason: "基本面强但估值容错较低。" },
      riskCounter: { score: 9, reason: "主要风险可跟踪但需警惕高位波动。" }
    }
  },
  {
    id: "opp-1810",
    eventId: "evt-1810-001",
    symbol: "1810.HK",
    stockName: "小米集团",
    market: "HK",
    industry: "智能硬件",
    eventType: "产品发布",
    score: 79,
    grade: "A",
    conclusion: "继续跟踪",
    event: "最近7天公司发布新品与交付进展，硬件生态协同成为核心观察点。",
    reasons: [
      "新品和交付数据带来边际变化。",
      "智能硬件主题关注度上升。",
      "后续销量数据具备继续发酵空间。"
    ],
    risks: [
      "新品热度可能无法转化为利润。",
      "竞争加剧可能压缩毛利率。",
      "市场验证仍需持续确认。"
    ],
    watchSignals: [
      "观察订单和交付数据。",
      "观察毛利率相关表述。",
      "观察港股科技板块相对表现。"
    ],
    dimensions: {
      eventStrength: { score: 15, reason: "事件影响收入预期但仍需验证。" },
      expectationGap: { score: 16, reason: "交付进展可能改善市场认知。" },
      catalystCertainty: { score: 12, reason: "销量数据是短期催化。" },
      marketValidation: { score: 11, reason: "验证已有但强度一般。" },
      trendFit: { score: 8, reason: "匹配智能硬件与AI终端趋势。" },
      valuationSupport: { score: 8, reason: "基本面支撑中等。" },
      riskCounter: { score: 9, reason: "主要风险尚未明显恶化。" }
    }
  },
  {
    id: "opp-vrtx",
    eventId: "evt-vrtx-001",
    symbol: "VRTX",
    stockName: "Vertex Pharmaceuticals",
    market: "US",
    industry: "创新药",
    eventType: "监管审批",
    score: 76,
    grade: "A",
    conclusion: "继续跟踪",
    event: "最近7天核心管线取得监管进展，后续审批和商业化节奏是关键。",
    reasons: [
      "监管进展对管线价值有直接影响。",
      "事件具备明确后续时间窗口。",
      "创新药自定义行业匹配度较高。"
    ],
    risks: [
      "审批结果仍有不确定性。",
      "商业化兑现节奏可能慢于预期。",
      "单一管线事件容易带来波动。"
    ],
    watchSignals: [
      "观察正式审批节点。",
      "观察医生和支付端反馈。",
      "观察同类药物竞争动态。"
    ],
    dimensions: {
      eventStrength: { score: 16, reason: "监管进展影响管线价值。" },
      expectationGap: { score: 15, reason: "边际变化清晰但非最终结果。" },
      catalystCertainty: { score: 13, reason: "后续审批节点明确。" },
      marketValidation: { score: 10, reason: "市场验证仍需增强。" },
      trendFit: { score: 9, reason: "匹配创新药关注方向。" },
      valuationSupport: { score: 8, reason: "基本面质量较强。" },
      riskCounter: { score: 5, reason: "审批失败是主要反证。" }
    }
  },
  {
    id: "opp-0700",
    eventId: "evt-0700-001",
    symbol: "0700.HK",
    stockName: "腾讯控股",
    market: "HK",
    industry: "互联网平台",
    eventType: "股票回购",
    score: 68,
    grade: "B",
    conclusion: "继续跟踪",
    event: "最近7天公司持续回购，股东回报信号延续。",
    reasons: [
      "回购提供资本配置边际信号。",
      "大盘权重股具备市场验证价值。",
      "事件稳定但预期差有限。"
    ],
    risks: [
      "回购可能已被市场充分预期。",
      "核心业务增速仍是主要约束。",
      "政策和竞争风险仍需观察。"
    ],
    watchSignals: [
      "观察回购规模是否扩大。",
      "观察广告和游戏业务数据。",
      "观察恒生科技指数相对表现。"
    ],
    dimensions: {
      eventStrength: { score: 13, reason: "回购对股东回报有支撑。" },
      expectationGap: { score: 10, reason: "持续回购的新增预期差有限。" },
      catalystCertainty: { score: 9, reason: "短期催化不够集中。" },
      marketValidation: { score: 10, reason: "市场验证中等。" },
      trendFit: { score: 7, reason: "平台经济景气度温和改善。" },
      valuationSupport: { score: 10, reason: "估值与现金流支撑较好。" },
      riskCounter: { score: 9, reason: "风险可跟踪且未显著恶化。" }
    }
  },
  {
    id: "opp-tsla",
    eventId: "evt-tsla-001",
    symbol: "TSLA",
    stockName: "Tesla",
    market: "US",
    industry: "智能汽车",
    eventType: "监管调查",
    score: 42,
    grade: "D",
    conclusion: "风险偏高",
    event: "最近7天公司相关业务面临监管审查，短期风险反证升高。",
    reasons: [
      "事件对估值情绪有直接压制。",
      "监管变量可能影响后续催化节奏。",
      "市场验证偏弱。"
    ],
    risks: [
      "监管进展可能继续发酵。",
      "高估值状态下负面事件影响更大。",
      "成交量放大下跌会强化反证。"
    ],
    watchSignals: [
      "观察监管口径是否缓和。",
      "观察交付数据能否对冲风险。",
      "观察股价能否重新站回关键均线。"
    ],
    dimensions: {
      eventStrength: { score: 9, reason: "监管审查影响风险偏好。" },
      expectationGap: { score: 6, reason: "负向预期差更明显。" },
      catalystCertainty: { score: 6, reason: "监管节点不确定。" },
      marketValidation: { score: 5, reason: "市场验证偏弱。" },
      trendFit: { score: 7, reason: "行业仍有趋势但事件负面。" },
      valuationSupport: { score: 4, reason: "估值容错较低。" },
      riskCounter: { score: 5, reason: "反证风险较高。" }
    }
  }
];

export const watchlistEntries = [
  {
    id: "wl-nvda",
    opportunityId: "opp-nvda",
    symbol: "NVDA",
    stockName: "NVIDIA",
    market: "US",
    industry: "AI算力",
    entryDate: "2026-06-08",
    entryPrice: 124.5,
    entryScore: 88,
    entryGrade: "S",
    eventType: "指引上调",
    status: "有效待验证"
  },
  {
    id: "wl-1810",
    opportunityId: "opp-1810",
    symbol: "1810.HK",
    stockName: "小米集团",
    market: "HK",
    industry: "智能硬件",
    entryDate: "2026-06-08",
    entryPrice: 18.76,
    entryScore: 79,
    entryGrade: "A",
    eventType: "产品发布",
    status: "待确认"
  }
];

export const performanceTracking = [
  {
    watchlistId: "wl-nvda",
    t1: 1.8,
    t3: null,
    t5: null,
    t10: null,
    t20: null,
    relativeMarket: 1.1,
    relativeIndustry: 0.4,
    maxDrawdown: -1.2,
    volumeChange: 42,
    followupCatalyst: false,
    riskTriggered: false,
    verdict: "待验证",
    review: "初步市场验证存在，等待T+3和供应链信号。"
  },
  {
    watchlistId: "wl-1810",
    t1: -0.6,
    t3: null,
    t5: null,
    t10: null,
    t20: null,
    relativeMarket: -0.2,
    relativeIndustry: -0.4,
    maxDrawdown: -2.1,
    volumeChange: 18,
    followupCatalyst: false,
    riskTriggered: false,
    verdict: "待确认",
    review: "事件仍需销量和毛利率信号确认。"
  }
];

export const weeklyReview = {
  id: "review-2026-w23",
  week: "2026-W23",
  entryCount: 2,
  gradePerformance: [
    { grade: "S", count: 1, avgT1: 1.8, verdict: "初步有效" },
    { grade: "A", count: 1, avgT1: -0.6, verdict: "待确认" }
  ],
  bestEventTypes: ["指引上调"],
  weakestEventTypes: ["产品发布"],
  effectiveDimensions: ["事件强度", "预期差", "市场验证"],
  failedHighScoreCases: [],
  lowScoreWinners: [],
  weightSuggestions: [
    "若S级样本继续跑赢，可维持事件强度和预期差权重。",
    "产品发布类需提高市场验证门槛。",
    "样本不足，暂不建议自动调整权重。"
  ]
};
