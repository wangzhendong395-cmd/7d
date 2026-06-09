const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const benchmarkByMarket = {
  US: "QQQ",
  HK: "^HSI"
};

const yahooSymbol = (symbol) => {
  if (/^\d{3,5}\.HK$/i.test(symbol)) return symbol.padStart(symbol.includes(".") ? symbol.length : 7, "0");
  return symbol;
};

const fetchYahooChart = async (symbol) => {
  const url = new URL(`${YAHOO_CHART_BASE}/${encodeURIComponent(yahooSymbol(symbol))}`);
  url.searchParams.set("range", "1mo");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "history");

  const response = await fetch(url, {
    headers: {
      "user-agent": "7D Event Radar",
      accept: "application/json"
    }
  });
  if (!response.ok) throw new Error(`Yahoo chart request failed ${response.status}: ${symbol}`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo chart result for ${symbol}`);
  return result;
};

const latestQuote = (chart) => {
  const quote = chart.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const timestamps = chart.timestamp || [];
  const rows = closes
    .map((close, index) => ({
      close,
      volume: volumes[index],
      timestamp: timestamps[index]
    }))
    .filter((row) => Number.isFinite(row.close));

  if (rows.length < 2) throw new Error("Not enough chart rows");
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const lookbackVolumes = rows
    .slice(Math.max(0, rows.length - 21), -1)
    .map((row) => row.volume)
    .filter((volume) => Number.isFinite(volume) && volume > 0);
  const avgVolume = lookbackVolumes.length
    ? lookbackVolumes.reduce((sum, volume) => sum + volume, 0) / lookbackVolumes.length
    : null;

  return {
    price: latest.close,
    changePct: previous.close ? ((latest.close - previous.close) / previous.close) * 100 : 0,
    volume: latest.volume || 0,
    volumeRatio: avgVolume && latest.volume ? latest.volume / avgVolume : 1,
    capturedAt: latest.timestamp ? new Date(latest.timestamp * 1000).toISOString() : new Date().toISOString()
  };
};

export const collectMarketSnapshots = async ({ stocks }) => {
  const benchmarks = new Map();
  const snapshots = [];
  const errors = [];

  for (const market of ["US", "HK"]) {
    try {
      benchmarks.set(market, latestQuote(await fetchYahooChart(benchmarkByMarket[market])));
    } catch (error) {
      errors.push({ source: "Yahoo Finance", symbol: benchmarkByMarket[market], message: error.message });
    }
  }

  for (const stock of stocks) {
    try {
      const quote = latestQuote(await fetchYahooChart(stock.symbol));
      const benchmark = benchmarks.get(stock.market);
      snapshots.push({
        symbol: stock.symbol,
        price: Number(quote.price.toFixed(4)),
        changePct: Number(quote.changePct.toFixed(2)),
        relativeMarketPct: benchmark ? Number((quote.changePct - benchmark.changePct).toFixed(2)) : 0,
        relativeIndustryPct: 0,
        volumeRatio: Number(quote.volumeRatio.toFixed(2)),
        volume: quote.volume,
        benchmarkSymbol: benchmarkByMarket[stock.market],
        capturedAt: quote.capturedAt
      });
    } catch (error) {
      errors.push({ source: "Yahoo Finance", symbol: stock.symbol, message: error.message });
    }
  }

  return { snapshots, errors };
};
