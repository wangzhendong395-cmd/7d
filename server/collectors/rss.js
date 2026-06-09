import { eventSourceId, isWithinDays, toDateOnly } from "./utils.js";

const decodeXml = (value = "") =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const firstTag = (xml, tags) => {
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
};

const parseEntries = (xml) => {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((block) => ({
    title: firstTag(block, ["title"]),
    summary: firstTag(block, ["description", "summary", "content"]),
    url: firstTag(block, ["link", "guid"]) || (block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1] || ""),
    publishedAt: firstTag(block, ["pubDate", "published", "updated"])
  }));
};

const stockUniverse = (config = {}) => [
  ...(config.us || []).map((item) => ({ ...item, market: "US" })),
  ...(config.hk || []).map((item) => ({ ...item, market: "HK" }))
];

const normalizeSymbolAliases = (stock) =>
  [
    stock.symbol,
    stock.stockName,
    stock.code,
    stock.symbol?.replace(".HK", ""),
    stock.stockName?.replace(/-W$/, "")
  ]
    .filter(Boolean)
    .map((item) => String(item).toLowerCase());

const matchStock = (entry, stocks) => {
  const text = `${entry.title} ${entry.summary}`.toLowerCase();
  return stocks.find((stock) => normalizeSymbolAliases(stock).some((alias) => alias && text.includes(alias)));
};

const classifyNewsEvent = (text) => {
  const lower = text.toLowerCase();
  if (/ai|gpu|chip|semiconductor|cloud|data center|server|artificial intelligence/i.test(text)) return "行业主题升温";
  if (/order|partnership|collaboration|contract|deal|合作|订单|协议/.test(lower)) return "订单/合作";
  if (/launch|product|release|发布|产品/.test(lower)) return "产品发布";
  if (/buyback|repurchase|回购/.test(lower)) return "股票回购";
  if (/investigation|lawsuit|probe|监管|诉讼|调查/.test(lower)) return "监管调查";
  return "公司新闻";
};

export const collectRssNews = async ({ feeds = [], config, days = 7 }) => {
  const events = [];
  const errors = [];
  const stocks = stockUniverse(config);

  for (const feed of feeds.filter((item) => item.enabled !== false && item.url)) {
    try {
      const response = await fetch(feed.url, {
        headers: { "user-agent": process.env.NEWS_USER_AGENT || "7D Event Radar contact@example.com" }
      });
      if (!response.ok) throw new Error(`RSS request failed ${response.status}`);
      const entries = parseEntries(await response.text());

      entries.forEach((entry, index) => {
        const publishedAt = entry.publishedAt ? new Date(entry.publishedAt).toISOString() : new Date().toISOString();
        if (!isWithinDays(publishedAt, days)) return;
        const stock = matchStock(entry, stocks);
        if (!stock) return;
        const eventType = classifyNewsEvent(`${entry.title} ${entry.summary}`);
        events.push({
          id: `rss-${eventSourceId(stock.symbol, toDateOnly(publishedAt), index, entry.title)}`,
          symbol: stock.symbol,
          stockName: stock.stockName || stock.symbol,
          market: stock.market,
          industry: stock.industry || feed.industry || "未分类",
          eventType,
          source: feed.name || "RSS",
          sourceCredibility: feed.sourceCredibility || "B",
          publishedAt,
          title: entry.title,
          summary: `${stock.symbol} 最近7天出现相关新闻：${entry.title}`,
          url: entry.url,
          followupSignals: ["观察是否有公司公告确认", "观察股价和成交量是否验证", "观察新闻是否被更多来源跟进"]
        });
      });
    } catch (error) {
      errors.push({ source: feed.name || feed.url, message: error.message });
    }
  }

  return { events, errors };
};

export const __private__ = { classifyNewsEvent, decodeXml, matchStock, parseEntries };
