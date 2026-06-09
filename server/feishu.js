const disclaimer = "本系统为个人研究和复盘工具，内容仅用于信息整理、事件跟踪和模型验证。";

const gradeRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };

export const getFeishuWebhookUrl = () => process.env.FEISHU_WEBHOOK_URL || "";
export const getFeishuAppConfig = () => ({
  appId: process.env.FEISHU_APP_ID || "",
  appSecret: process.env.FEISHU_APP_SECRET || "",
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || ""
});

export const buildTextMessage = (text) => ({
  msg_type: "text",
  content: { text }
});

export const buildDailyDigestText = (opportunities, limit = 10) => {
  const items = opportunities
    .filter((item) => item.grade === "S" || item.grade === "A")
    .sort((a, b) => gradeRank[b.grade] - gradeRank[a.grade] || b.score - a.score)
    .slice(0, limit);

  if (!items.length) return `7D事件机会雷达\n今日暂无S/A级观察卡片。\n\n${disclaimer}`;

  const lines = [
    "7D事件机会雷达｜每日S/A观察",
    `数量：${items.length}`,
    "",
    ...items.map((item, index) => `${index + 1}. ${item.symbol} ${item.stockName}｜${item.grade}/${item.score}\n${item.reasons[0] || item.event}`),
    "",
    disclaimer
  ];
  return lines.join("\n");
};

export const buildStockQueryText = (brief) => {
  const item = brief.primaryOpportunity;
  return [
    `7D个股查询｜${brief.symbol} ${brief.stockName}`,
    `等级：${item.grade} / ${item.score}`,
    `事件：${item.event}`,
    "",
    "主要原因：",
    ...item.reasons.slice(0, 3).map((text, index) => `${index + 1}. ${text}`),
    "",
    "主要风险：",
    ...item.risks.slice(0, 3).map((text, index) => `${index + 1}. ${text}`),
    "",
    "后续观察：",
    ...item.watchSignals.slice(0, 3).map((text, index) => `${index + 1}. ${text}`),
    "",
    disclaimer
  ].join("\n");
};

export const buildRiskAlertText = (watchlistItems) => {
  const risky = watchlistItems.filter((item) => item.performance?.riskTriggered);
  if (!risky.length) return `7D风险提醒\n当前观察池暂无风险反证触发。\n\n${disclaimer}`;
  return [
    "7D风险提醒｜观察池风险反证",
    `数量：${risky.length}`,
    "",
    ...risky.map((item, index) => `${index + 1}. ${item.symbol} ${item.stockName}｜${item.eventType}\n${item.performance?.review || "风险反证已触发，需复核事件逻辑。"}`),
    "",
    disclaimer
  ].join("\n");
};

export const sendFeishuMessage = async (message, webhookUrl = getFeishuWebhookUrl()) => {
  if (!webhookUrl) return { ok: false, skipped: true, error: "FEISHU_WEBHOOK_URL is not configured" };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message)
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, body };
  }

  const code = body.code ?? body.StatusCode ?? 0;
  return {
    ok: code === 0,
    status: response.status,
    body
  };
};

export const getTenantAccessToken = async () => {
  const { appId, appSecret } = getFeishuAppConfig();
  if (!appId || !appSecret) return { ok: false, error: "FEISHU_APP_ID or FEISHU_APP_SECRET is not configured" };

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) {
    return { ok: false, status: response.status, body, error: body.msg || "Failed to get tenant_access_token" };
  }
  return { ok: true, tenantAccessToken: body.tenant_access_token, expire: body.expire };
};

export const replyFeishuMessage = async ({ messageId, text }) => {
  const token = await getTenantAccessToken();
  if (!token.ok) return token;

  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.tenantAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });
  const body = await response.json();
  return {
    ok: response.ok && body.code === 0,
    status: response.status,
    body,
    error: body.msg
  };
};

export const parseFeishuCommand = (text = "") => {
  const normalized = text.replace(/<at[^>]*>.*?<\/at>/g, "").trim();
  if (!normalized || normalized === "帮助" || normalized === "/帮助" || normalized.toLowerCase() === "help") {
    return { type: "help" };
  }
  if (/^(机会榜|\/机会榜|榜单|\/榜单)$/i.test(normalized)) return { type: "daily" };
  if (/^(风险|\/风险|风险提醒|\/风险提醒)$/i.test(normalized)) return { type: "risk" };
  const queryMatch = normalized.match(/^(查|\/查|query)\s*([A-Za-z0-9.^-]+(?:\.HK)?)$/i);
  if (queryMatch) return { type: "stock", symbol: queryMatch[2].toUpperCase() };
  if (/^[A-Za-z]{1,6}$/.test(normalized) || /^\d{3,5}\.HK$/i.test(normalized)) {
    return { type: "stock", symbol: normalized.toUpperCase() };
  }
  return { type: "unknown", raw: normalized };
};

export const buildHelpText = () =>
  [
    "7D事件机会雷达｜群指令",
    "机会榜：查看S/A级观察清单",
    "风险：查看观察池风险提醒",
    "查 NVDA：查询个股7日事件卡",
    "直接发送 NVDA / 0700.HK 也可以查询",
    "",
    disclaimer
  ].join("\n");
