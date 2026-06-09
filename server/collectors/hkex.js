import { eventSourceId, inferEventType, isWithinDays, stripTags, toDateOnly } from "./utils.js";

const formatHkexDate = (date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

const dateRange = (days) => {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(to.getUTCDate() - days);
  return { from: formatHkexDate(from), to: formatHkexDate(to) };
};

const fetchActiveStocks = async () => {
  const response = await fetch("https://www.hkexnews.hk/ncms/script/eds/activestock_sehk_e.json", {
    headers: { "user-agent": "7D Event Radar", accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HKEX stock list request failed ${response.status}`);
  return response.json();
};

const resolveStockId = async (code, configuredStockId) => {
  if (configuredStockId) return configuredStockId;
  const stocks = await fetchActiveStocks();
  const row = stocks.find((item) => item.c === code.padStart(5, "0"));
  if (!row) throw new Error(`HKEX stockId not found for ${code}`);
  return String(row.i);
};

const buildSearchUrl = ({ code, stockId, lang = "EN", days = 7 }) => {
  const range = dateRange(days);
  const url = new URL("https://www1.hkexnews.hk/search/titlesearch.xhtml");
  url.searchParams.set("lang", lang);
  url.searchParams.set("market", "SEHK");
  url.searchParams.set("category", "0");
  url.searchParams.set("stockId", stockId);
  url.searchParams.set("stockCode", code.padStart(5, "0"));
  url.searchParams.set("from", range.from);
  url.searchParams.set("to", range.to);
  return url.toString();
};

const parseAnnouncementRows = (html, stock) => {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const events = [];

  rows.forEach((row, index) => {
    const hrefMatch = row.match(/href=["']([^"']+\.pdf[^"']*)["']/i);
    if (!hrefMatch) return;

    const plain = stripTags(row);
    const codeSection = /Stock Code:\s*([\s\S]*?)Stock Short Name:/i.exec(plain)?.[1] || "";
    const rowCodes = codeSection.match(/\d{5}/g) || [];
    if (rowCodes.length && !rowCodes.includes(stock.code.padStart(5, "0"))) return;

    const dateMatch = plain.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
    const dateText = dateMatch?.[1];
    const publishedAt = dateText?.includes("/")
      ? `${dateText.slice(6, 10)}-${dateText.slice(3, 5)}-${dateText.slice(0, 2)}T00:00:00.000Z`
      : `${dateText}T00:00:00.000Z`;
    const headline = stripTags(row.match(/<div class="headline">([\s\S]*?)<\/div>/i)?.[1] || "");
    const linkText = stripTags(row.match(/<div class="doc-link">([\s\S]*?)<\/div>/i)?.[1] || "");
    const title = headline || linkText || plain.replace(dateText || "", "").replace(stock.code, "").trim() || `${stock.code} HKEX announcement`;
    const href = hrefMatch[1].startsWith("http") ? hrefMatch[1] : `https://www1.hkexnews.hk${hrefMatch[1]}`;

    events.push({
      id: `hkex-${eventSourceId(stock.symbol || stock.code, toDateOnly(publishedAt), index, title)}`,
      symbol: stock.symbol || `${stock.code}.HK`,
      stockName: stock.stockName || stock.name || stock.code,
      market: "HK",
      industry: stock.industry || "未分类",
      eventType: inferEventType(title),
      source: "HKEXnews",
      sourceCredibility: "A",
      publishedAt,
      title,
      summary: `${stock.symbol || stock.code} 最近7天发布港交所公告：${title}`,
      url: href,
      isNewInfo: true,
      followupSignals: ["阅读公告核心条款", "观察公告后成交量变化", "观察是否出现后续补充公告"]
    });
  });

  return events;
};

export const collectHkexAnnouncements = async ({ stocks, days = 7 }) => {
  const events = [];

  for (const stock of stocks) {
    const stockId = await resolveStockId(stock.code, stock.stockId);
    const response = await fetch(buildSearchUrl({ ...stock, stockId, days }), {
      headers: {
        "user-agent": "7D Event Radar",
        accept: "text/html"
      }
    });
    if (!response.ok) throw new Error(`HKEX request failed ${response.status}: ${stock.code}`);
    const html = await response.text();
    const parsed = parseAnnouncementRows(html, stock).filter((event) => isWithinDays(event.publishedAt, days));
    events.push(...parsed);
  }

  return events;
};

export const __private__ = { buildSearchUrl, dateRange, parseAnnouncementRows, resolveStockId };
