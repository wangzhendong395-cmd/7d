import assert from "node:assert/strict";
import test from "node:test";
import { collectHkexAnnouncements } from "../server/collectors/hkex.js";
import { collectRssNews } from "../server/collectors/rss.js";
import { collectSecFilings } from "../server/collectors/sec.js";

const mockResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => body
});

test("RSS collector matches news to tracked stocks", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const today = new Date().toUTCString();
  globalThis.fetch = async () =>
    mockResponse(`
      <rss>
        <channel>
          <item>
            <title>NVIDIA expands AI server partnership</title>
            <description>NVDA announced a new AI infrastructure collaboration.</description>
            <link>https://example.test/nvda</link>
            <pubDate>${today}</pubDate>
          </item>
          <item>
            <title>Untracked company headline</title>
            <description>No matching ticker.</description>
            <pubDate>${today}</pubDate>
          </item>
        </channel>
      </rss>
    `);

  const collected = await collectRssNews({
    feeds: [{ name: "Mock News", url: "https://example.test/rss", sourceCredibility: "B" }],
    config: {
      us: [{ symbol: "NVDA", stockName: "NVIDIA", industry: "AI算力" }],
      hk: []
    },
    days: 7
  });

  assert.equal(collected.errors.length, 0);
  assert.equal(collected.events.length, 1);
  assert.equal(collected.events[0].symbol, "NVDA");
  assert.equal(collected.events[0].source, "Mock News");
});

test("SEC collector maps recent filings to events", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /data\.sec\.gov/);
    return mockResponse({
      name: "NVIDIA CORP",
      filings: {
        recent: {
          form: ["8-K", "10-Q"],
          filingDate: [new Date().toISOString().slice(0, 10), "2020-01-01"],
          accessionNumber: ["0001045810-26-000001", "0001045810-20-000001"],
          primaryDocument: ["nvda-8k.htm", "nvda-10q.htm"]
        }
      }
    });
  };

  const events = await collectSecFilings({
    symbols: [{ symbol: "NVDA", cik: "0001045810", industry: "AI算力" }],
    days: 7
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].symbol, "NVDA");
  assert.equal(events[0].source, "SEC EDGAR");
});

test("HKEX collector parses announcement rows", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const today = new Date();
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = today.getUTCFullYear();

  globalThis.fetch = async (url) => {
    if (String(url).includes("activestock_sehk_e.json")) {
      return mockResponse([{ c: "00700", i: 100, n: "TENCENT" }]);
    }
    assert.match(String(url), /stockId=100/);
    return mockResponse(`
      <table>
        <tr>
          <td>${dd}/${mm}/${yyyy}</td>
          <td><a href="/listedco/listconews/sehk/${yyyy}/x.pdf">Monthly Return of Equity Issuer</a></td>
        </tr>
        <tr>
          <td>${dd}/${mm}/${yyyy}</td>
          <td class="stock-short-code"><span>Stock Code: </span>80700</td>
          <td class="stock-short-name"><span>Stock Short Name: </span>TENCENT-R</td>
          <td><a href="/listedco/listconews/sehk/${yyyy}/bad.pdf">Wrong counter</a></td>
        </tr>
      </table>
    `);
  };

  const events = await collectHkexAnnouncements({
    stocks: [{ code: "00700", symbol: "0700.HK", stockName: "腾讯控股", industry: "互联网平台" }],
    days: 7
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].symbol, "0700.HK");
  assert.equal(events[0].source, "HKEXnews");
});
