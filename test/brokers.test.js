import assert from "node:assert/strict";
import test from "node:test";
import { buildBrokerEnvValues, getBrokerStatus, testChiefConfig, testFutuOpenD, testIbkrGateway, testTigerConfig } from "../server/brokers.js";

test("broker status is read-only and safe when not configured", async (t) => {
  const original = {
    FUTU_ENABLED: process.env.FUTU_ENABLED,
    IBKR_ENABLED: process.env.IBKR_ENABLED,
    TIGER_ENABLED: process.env.TIGER_ENABLED,
    TIGER_CLIENT_ID: process.env.TIGER_CLIENT_ID
  };
  delete process.env.FUTU_ENABLED;
  delete process.env.IBKR_ENABLED;
  delete process.env.TIGER_ENABLED;
  delete process.env.TIGER_CLIENT_ID;
  t.after(() => {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const status = await getBrokerStatus();
  assert.equal(status.futu.enabled, false);
  assert.equal(status.ibkr.enabled, false);
  assert.equal(status.chief.unsupported, true);
  assert.equal(status.tiger.enabled, false);
  assert.equal(status.futu.readOnly, true);

  const futu = await testFutuOpenD();
  assert.equal(futu.skipped, true);

  const tiger = await testTigerConfig();
  assert.equal(tiger.ok, false);
  assert.ok(tiger.missing.includes("TIGER_ENABLED"));

  const ibkr = await testIbkrGateway();
  assert.equal(ibkr.skipped, true);

  const chief = await testChiefConfig();
  assert.equal(chief.skipped, true);
  assert.match(chief.error, /OpenAPI/);
});

test("broker config payload maps to env values", () => {
  const values = buildBrokerEnvValues({
    futuEnabled: true,
    futuHost: "127.0.0.1",
    futuPort: "11111",
    tigerEnabled: true,
    tigerClientId: "client",
    tigerAccount: "account",
    tigerPrivateKeyPath: "C:/keys/tiger.pem",
    tigerLicense: "license",
    tigerSandbox: true,
    ibkrEnabled: true,
    ibkrHost: "127.0.0.1",
    ibkrPort: "7497",
    ibkrMode: "paper",
    chiefEnabled: true,
    chiefOfficialApiUrl: "",
    chiefApiNote: "official only"
  });

  assert.equal(values.FUTU_ENABLED, "true");
  assert.equal(values.FUTU_OPEND_PORT, "11111");
  assert.equal(values.TIGER_ENABLED, "true");
  assert.equal(values.TIGER_SANDBOX, "true");
  assert.equal(values.IBKR_ENABLED, "true");
  assert.equal(values.IBKR_TWS_PORT, "7497");
  assert.equal(values.CHIEF_ENABLED, "true");
});
