import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyDigestText, buildTextMessage, sendFeishuMessage } from "../server/feishu.js";

test("daily digest keeps S/A cards concise", () => {
  const text = buildDailyDigestText([
    { symbol: "AAA", stockName: "Alpha", grade: "S", score: 90, reasons: ["预期差明显。"], event: "事件A" },
    { symbol: "BBB", stockName: "Beta", grade: "B", score: 70, reasons: ["待确认。"], event: "事件B" }
  ]);
  assert.match(text, /AAA/);
  assert.doesNotMatch(text, /BBB/);
  assert.match(text, /个人研究和复盘工具/);
});

test("sendFeishuMessage skips safely without webhook", async () => {
  const original = process.env.FEISHU_WEBHOOK_URL;
  delete process.env.FEISHU_WEBHOOK_URL;
  const result = await sendFeishuMessage(buildTextMessage("hello"));
  process.env.FEISHU_WEBHOOK_URL = original;
  assert.equal(result.skipped, true);
});

test("sendFeishuMessage posts text payload", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let payload;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://example.test/webhook");
    payload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 0, msg: "ok" })
    };
  };

  const result = await sendFeishuMessage(buildTextMessage("hello"), "https://example.test/webhook");
  assert.equal(result.ok, true);
  assert.equal(payload.msg_type, "text");
  assert.equal(payload.content.text, "hello");
});
