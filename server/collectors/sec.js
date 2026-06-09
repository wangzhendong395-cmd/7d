import { eventSourceId, inferEventType, isWithinDays } from "./utils.js";

const SEC_HEADERS = {
  "user-agent": process.env.SEC_USER_AGENT || "7D Event Radar contact@example.com",
  accept: "application/json"
};

const secJson = async (url) => {
  const response = await fetch(url, { headers: SEC_HEADERS });
  if (!response.ok) throw new Error(`SEC request failed ${response.status}: ${url}`);
  return response.json();
};

export const resolveCik = async (symbol, configuredCik) => {
  if (configuredCik) return String(configuredCik).padStart(10, "0");
  const data = await secJson("https://www.sec.gov/files/company_tickers_exchange.json");
  const fields = data.fields || [];
  const tickerIndex = fields.indexOf("ticker");
  const cikIndex = fields.indexOf("cik");
  const row = (data.data || []).find((item) => String(item[tickerIndex]).toUpperCase() === symbol.toUpperCase());
  if (!row) throw new Error(`CIK not found for ${symbol}`);
  return String(row[cikIndex]).padStart(10, "0");
};

export const collectSecFilings = async ({ symbols, days = 7 }) => {
  const events = [];

  for (const stock of symbols) {
    const cik = await resolveCik(stock.symbol, stock.cik);
    const submissions = await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const recent = submissions.filings?.recent || {};
    const forms = recent.form || [];
    const dates = recent.filingDate || [];
    const accessionNumbers = recent.accessionNumber || [];
    const primaryDocuments = recent.primaryDocument || [];

    forms.forEach((form, index) => {
      const filedAt = dates[index];
      if (!isWithinDays(`${filedAt}T00:00:00.000Z`, days)) return;
      const accession = accessionNumbers[index];
      const document = primaryDocuments[index];
      const accessionPath = accession.replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}/${document}`;
      const title = `${stock.symbol} ${form} filed on ${filedAt}`;

      events.push({
        id: `sec-${eventSourceId(stock.symbol, accession, form)}`,
        symbol: stock.symbol.toUpperCase(),
        stockName: stock.stockName || submissions.name || stock.symbol.toUpperCase(),
        market: "US",
        industry: stock.industry || "未分类",
        eventType: inferEventType(form),
        source: "SEC EDGAR",
        sourceCredibility: "A",
        publishedAt: `${filedAt}T00:00:00.000Z`,
        title,
        summary: `${stock.symbol.toUpperCase()} 最近7天提交 ${form} 文件，需结合披露内容判断预期差和催化剂。`,
        url,
        isNewInfo: true,
        followupSignals: ["阅读文件核心披露变化", "观察公告后价格和成交量验证", "观察是否出现后续公司说明"]
      });
    });
  }

  return events;
};
