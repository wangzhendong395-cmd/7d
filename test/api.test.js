import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const startServer = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "radar-test-"));
  process.env.RADAR_DB_PATH = path.join(dir, "radar-db.json");
  process.env.RADAR_ENV_PATH = path.join(dir, ".env.local");
  const { createServer } = await import(`../server/index.js?test=${Date.now()}`);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, server };
};

const requestJson = async (baseUrl, path, options) => {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
};

test("core API returns opportunities and persisted user actions", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const health = await requestJson(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.records.opportunities, 5);

  const opportunities = await requestJson(baseUrl, "/api/opportunities?grade=A");
  assert.equal(opportunities.response.status, 200);
  assert.equal(opportunities.body.items.length, 2);

  const priority = await requestJson(baseUrl, "/api/watch-pool/priority");
  assert.equal(priority.response.status, 200);
  assert.ok(priority.body.items.some((item) => item.stockCode === "NVDA" && item.isPriorityWatch));

  const action = await requestJson(baseUrl, "/api/personal-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opportunityId: "opp-nvda", actionType: "重点跟踪" })
  });
  assert.equal(action.response.status, 201);
  assert.equal(action.body.symbol, "NVDA");

  const actions = await requestJson(baseUrl, "/api/personal-actions");
  assert.equal(actions.body.items.length, 1);
});

test("custom industry and feishu query endpoints work", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const industry = await requestJson(baseUrl, "/api/custom-industries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "机器人",
      keywords: ["机器人", "自动化"],
      stockPool: ["ISRG", "0988.HK"],
      priority: "高"
    })
  });
  assert.equal(industry.response.status, 201);
  assert.equal(industry.body.name, "机器人");

  const updated = await requestJson(baseUrl, `/api/custom-industries/${industry.body.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "AI infra",
      keywords: ["AI", "GPU"],
      stockPool: ["NVDA"],
      priority: "High"
    })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.name, "AI infra");
  assert.deepEqual(updated.body.stockPool, ["NVDA"]);

  const removed = await requestJson(baseUrl, `/api/custom-industries/${industry.body.id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.removed, 1);

  const feishu = await requestJson(baseUrl, "/api/feishu/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: "NVDA" })
  });
  assert.equal(feishu.response.status, 200);
  assert.equal(feishu.body.card.grade, "S");
});

test("manual event ingest, market snapshot, and review regeneration work", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const event = await requestJson(baseUrl, "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "TEST",
      stockName: "Test Corp",
      market: "US",
      industry: "AI算力",
      eventType: "订单/合作",
      sourceCredibility: "A",
      title: "Test Corp announced a large AI infrastructure order",
      summary: "公司披露AI基础设施大单，后续交付节奏成为核心验证点。",
      followupSignals: ["观察订单交付节奏", "观察毛利率变化"]
    })
  });
  assert.equal(event.response.status, 201);
  assert.equal(event.body.opportunity.symbol, "TEST");

  const snapshot = await requestJson(baseUrl, "/api/market-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "TEST",
      price: 12.3,
      changePct: 4.2,
      relativeMarketPct: 2.1,
      volumeRatio: 1.8
    })
  });
  assert.equal(snapshot.response.status, 201);

  const opportunities = await requestJson(baseUrl, "/api/opportunities?q=TEST");
  assert.equal(opportunities.body.items.length, 1);
  assert.ok(opportunities.body.items[0].score >= event.body.opportunity.score);
  assert.equal(opportunities.body.items[0].stockCode, "TEST");
  assert.equal(opportunities.body.items[0].poolStatus, "重点关注");

  const watch = await requestJson(baseUrl, "/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opportunityId: opportunities.body.items[0].id, entryPrice: 12.3 })
  });
  assert.equal(watch.response.status, 201);

  const performance = await requestJson(baseUrl, `/api/watchlist/${watch.body.id}/performance`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      t1: 2.4,
      t3: 4.1,
      t5: 5.2,
      relativeMarket: 1.1,
      relativeIndustry: 0.7,
      maxDrawdown: -0.8,
      volumeChange: 33,
      followupCatalyst: true,
      riskTriggered: false,
      verdict: "初步有效"
    })
  });
  assert.equal(performance.body.t1, 2.4);
  assert.equal(performance.body.t5, 5.2);
  assert.equal(performance.body.relativeIndustry, 0.7);
  assert.equal(performance.body.stockCode, "TEST");

  const autoTracked = await requestJson(baseUrl, "/api/market-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "TEST",
      price: 11.07,
      changePct: -3.1,
      relativeMarketPct: -1.9,
      relativeIndustryPct: 1.2,
      volumeRatio: 1.5,
      capturedAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    })
  });
  assert.equal(autoTracked.response.status, 201);
  assert.ok(autoTracked.body.performanceSynced >= 1);

  const priority = await requestJson(baseUrl, "/api/watch-pool/priority");
  assert.equal(priority.response.status, 200);
  assert.ok(priority.body.items.some((item) => item.stockCode === "TEST" && item.isPriorityWatch));
  const testPriority = priority.body.items.find((item) => item.stockCode === "TEST");
  assert.equal(testPriority.performance.t3, -10);
  assert.equal(testPriority.performance.relativeMarket, -1.9);
  assert.equal(testPriority.performance.volumeChange, 50);

  const review = await requestJson(baseUrl, "/api/reviews/weekly/regenerate", { method: "POST" });
  assert.ok(review.body.entryCount >= 1);
  assert.ok(review.body.priorityEntryCount >= 1);
  assert.ok("marketWinRate" in review.body);
  assert.ok(review.body.modelSuggestionId);

  const model = await requestJson(baseUrl, "/api/model/config");
  const suggestion = model.body.suggestions.find((item) => item.id === review.body.modelSuggestionId);
  assert.equal(suggestion.status, "pending");
  assert.ok(suggestion.evidence.priorityEntryCount >= 1);

  const confirmed = await requestJson(baseUrl, `/api/model/suggestions/${suggestion.id}/confirm`, { method: "POST" });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.suggestion.status, "confirmed");

  const daily = await requestJson(baseUrl, "/api/feishu/daily-preview");
  assert.equal(daily.response.status, 200);
  assert.ok(Array.isArray(daily.body.items));
  assert.ok(daily.body.items.every((item) => item.stockCode && item.poolStatus === "重点关注"));
});

test("official disclosure collection endpoint records ingestion run", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, options);
    const today = new Date().toISOString().slice(0, 10);
    if (String(url).includes("data.sec.gov")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: "NVIDIA CORP",
          filings: {
            recent: {
              form: ["8-K"],
              filingDate: [today],
              accessionNumber: ["0001045810-26-000001"],
              primaryDocument: ["nvda-8k.htm"]
            }
          }
        })
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const collect = await requestJson(baseUrl, "/api/collect/disclosures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markets: ["US"], days: 7 })
  });

  assert.equal(collect.response.status, 200);
  assert.ok(collect.body.run.imported >= 1);
  assert.equal(collect.body.run.status, "success");
});

test("RSS news collection endpoint records matched stock events", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, options);
    return {
      ok: true,
      text: async () => `
        <rss><channel>
          <item>
            <title>NVIDIA wins AI platform order</title>
            <description>NVDA data center demand remains strong.</description>
            <pubDate>${new Date().toUTCString()}</pubDate>
            <link>https://example.test/nvda</link>
          </item>
        </channel></rss>
      `
    };
  };

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const feed = await requestJson(baseUrl, "/api/news-feeds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mock RSS", url: "https://example.test/rss", sourceCredibility: "B" })
  });
  assert.equal(feed.response.status, 201);

  const collect = await requestJson(baseUrl, "/api/collect/news", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days: 7 })
  });
  assert.equal(collect.response.status, 200);
  assert.ok(collect.body.run.imported >= 1);

  const removed = await requestJson(baseUrl, `/api/news-feeds/${feed.body.id}`, { method: "DELETE" });
  assert.equal(removed.body.removed, 1);
});

test("opportunity list groups by stock and stock brief exposes all events", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  await requestJson(baseUrl, "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "DUPL",
      stockName: "Duplicate Test",
      market: "US",
      industry: "AI算力",
      eventType: "订单/合作",
      sourceCredibility: "A",
      title: "First event",
      summary: "第一条事件。"
    })
  });
  await requestJson(baseUrl, "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "DUPL",
      stockName: "Duplicate Test",
      market: "US",
      industry: "AI算力",
      eventType: "产品发布",
      sourceCredibility: "B",
      title: "Second event",
      summary: "第二条事件。"
    })
  });

  const grouped = await requestJson(baseUrl, "/api/opportunities?q=DUPL");
  assert.equal(grouped.body.items.length, 1);
  assert.equal(grouped.body.items[0].eventCount, 2);

  const eventLevel = await requestJson(baseUrl, "/api/opportunities?q=DUPL&group=event");
  assert.equal(eventLevel.body.items.length, 2);

  const brief = await requestJson(baseUrl, "/api/stocks/DUPL/brief");
  assert.equal(brief.response.status, 200);
  assert.equal(brief.body.events.length, 2);
  assert.equal(brief.body.opportunities.length, 2);
});

test("production maintenance APIs manage source pool, status, and backups", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const status = await requestJson(baseUrl, "/api/system/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.ok, true);
  assert.ok(status.body.dataSources.us >= 1);

  const addedUs = await requestJson(baseUrl, "/api/data-sources/us/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: "META", stockName: "Meta Platforms", cik: "0001326801", industry: "互联网平台" })
  });
  assert.equal(addedUs.response.status, 201);
  assert.equal(addedUs.body.symbol, "META");

  const addedHk = await requestJson(baseUrl, "/api/data-sources/hk/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "01024", symbol: "1024.HK", stockName: "快手-W", industry: "互联网平台" })
  });
  assert.equal(addedHk.response.status, 201);
  assert.equal(addedHk.body.code, "01024");

  const config = await requestJson(baseUrl, "/api/data-sources/config");
  assert.ok(config.body.us.some((item) => item.symbol === "META"));
  assert.ok(config.body.hk.some((item) => item.code === "01024"));

  const removed = await requestJson(baseUrl, "/api/data-sources/us/stocks/META", { method: "DELETE" });
  assert.equal(removed.body.removed, 1);

  const backup = await requestJson(baseUrl, "/api/system/backup", { method: "POST" });
  assert.equal(backup.response.status, 201);
  assert.ok(backup.body.path.endsWith(".json"));
});

test("market refresh endpoint updates snapshots", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const chart = (symbol, closes) => ({
    chart: {
      result: [
        {
          meta: { symbol },
          timestamp: [1780000000, 1780086400],
          indicators: { quote: [{ close: closes, volume: [100, 200] }] }
        }
      ]
    }
  });

  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, options);
    if (String(url).includes("/QQQ")) return { ok: true, json: async () => chart("QQQ", [100, 101]) };
    if (String(url).includes("%5EHSI")) return { ok: true, json: async () => chart("^HSI", [200, 202]) };
    return { ok: true, json: async () => chart("STOCK", [50, 55]) };
  };

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const refreshed = await requestJson(baseUrl, "/api/market/refresh", { method: "POST" });
  assert.equal(refreshed.response.status, 200);
  assert.ok(refreshed.body.imported >= 1);

  const snapshots = await requestJson(baseUrl, "/api/market-snapshots");
  assert.ok(snapshots.body.items.length >= 1);
});

test("feishu APIs report skipped when webhook is not configured", async (t) => {
  const original = process.env.FEISHU_WEBHOOK_URL;
  delete process.env.FEISHU_WEBHOOK_URL;
  t.after(() => {
    process.env.FEISHU_WEBHOOK_URL = original;
  });

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const status = await requestJson(baseUrl, "/api/feishu/status");
  assert.equal(status.body.configured, false);

  const pushed = await requestJson(baseUrl, "/api/feishu/push/daily", { method: "POST" });
  assert.equal(pushed.response.status, 200);
  assert.equal(pushed.body.skipped, true);
});

test("broker config APIs save read-only connection settings", async (t) => {
  const originalFutu = process.env.FUTU_ENABLED;
  const originalTiger = process.env.TIGER_ENABLED;
  delete process.env.FUTU_ENABLED;
  delete process.env.TIGER_ENABLED;
  t.after(() => {
    if (originalFutu === undefined) delete process.env.FUTU_ENABLED;
    else process.env.FUTU_ENABLED = originalFutu;
    if (originalTiger === undefined) delete process.env.TIGER_ENABLED;
    else process.env.TIGER_ENABLED = originalTiger;
  });

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const saved = await requestJson(baseUrl, "/api/brokers/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      futuEnabled: true,
      futuHost: "127.0.0.1",
      futuPort: "11111",
      tigerEnabled: true,
      tigerClientId: "client",
      tigerAccount: "account",
      tigerPrivateKeyPath: "C:/missing/tiger.pem",
      tigerLicense: "license",
      tigerSandbox: true,
      ibkrEnabled: true,
      ibkrHost: "127.0.0.1",
      ibkrPort: "7497",
      ibkrMode: "paper",
      chiefEnabled: true,
      chiefOfficialApiUrl: "",
      chiefApiNote: "official only"
    })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.status.futu.enabled, true);
  assert.equal(saved.body.status.tiger.enabled, true);
  assert.equal(saved.body.status.ibkr.enabled, true);
  assert.equal(saved.body.status.chief.unsupported, true);

  const status = await requestJson(baseUrl, "/api/brokers/status");
  assert.equal(status.body.futu.readOnly, true);
  assert.equal(status.body.tiger.readOnly, true);
  assert.equal(status.body.ibkr.readOnly, true);
  assert.equal(status.body.chief.readOnly, true);
});

test("feishu config can be saved without restarting server", async (t) => {
  const originalWebhook = process.env.FEISHU_WEBHOOK_URL;
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalSecret = process.env.FEISHU_APP_SECRET;
  const originalToken = process.env.FEISHU_VERIFICATION_TOKEN;
  delete process.env.FEISHU_WEBHOOK_URL;
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  delete process.env.FEISHU_VERIFICATION_TOKEN;
  t.after(() => {
    process.env.FEISHU_WEBHOOK_URL = originalWebhook;
    process.env.FEISHU_APP_ID = originalAppId;
    process.env.FEISHU_APP_SECRET = originalSecret;
    process.env.FEISHU_VERIFICATION_TOKEN = originalToken;
  });

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const saved = await requestJson(baseUrl, "/api/feishu/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookUrl: "https://example.test/webhook",
      appId: "cli_test",
      appSecret: "secret",
      verificationToken: "verify"
    })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.appConfigured, true);

  const status = await requestJson(baseUrl, "/api/feishu/status");
  assert.equal(status.body.configured, true);
  assert.equal(status.body.appConfigured, true);
  assert.equal(status.body.verificationTokenConfigured, true);
});

test("feishu event callback verifies challenge and parses commands", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.FEISHU_VERIFICATION_TOKEN;
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_VERIFICATION_TOKEN = "token";
  process.env.FEISHU_APP_ID = "app";
  process.env.FEISHU_APP_SECRET = "secret";
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env.FEISHU_VERIFICATION_TOKEN = originalToken;
    process.env.FEISHU_APP_ID = originalAppId;
    process.env.FEISHU_APP_SECRET = originalSecret;
  });

  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, options);
    if (String(url).includes("tenant_access_token")) {
      return { ok: true, json: async () => ({ code: 0, tenant_access_token: "tenant", expire: 7200 }) };
    }
    if (String(url).includes("/reply")) {
      return { ok: true, status: 200, json: async () => ({ code: 0, msg: "ok" }) };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const { baseUrl, server } = await startServer();
  t.after(() => server.close());

  const challenge = await requestJson(baseUrl, "/api/feishu/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", token: "token", challenge: "abc" })
  });
  assert.equal(challenge.body.challenge, "abc");

  const v2Challenge = await requestJson(baseUrl, "/api/feishu/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "2.0",
      header: { token: "token" },
      event: { challenge: "v2abc" }
    })
  });
  assert.equal(v2Challenge.body.challenge, "v2abc");

  const command = await requestJson(baseUrl, "/api/feishu/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      header: { event_type: "im.message.receive_v1", token: "token" },
      event: {
        message: {
          message_id: "msg_1",
          content: JSON.stringify({ text: "机会榜" })
        }
      }
    })
  });
  assert.equal(command.response.status, 200);
  assert.equal(command.body.ok, true);
});

test("mini page is served", async (t) => {
  const { baseUrl, server } = await startServer();
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/mini`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /7D雷达小程序/);
});
