import net from "node:net";
import { access } from "node:fs/promises";
import { maskSecret } from "./env.js";

const boolEnv = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const numberEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getBrokerConfig = () => ({
  futu: {
    enabled: boolEnv(process.env.FUTU_ENABLED),
    host: process.env.FUTU_OPEND_HOST || "127.0.0.1",
    port: numberEnv(process.env.FUTU_OPEND_PORT, 11111),
    unlockTrade: false
  },
  tiger: {
    enabled: boolEnv(process.env.TIGER_ENABLED),
    clientId: process.env.TIGER_CLIENT_ID || "",
    account: process.env.TIGER_ACCOUNT || "",
    privateKeyPath: process.env.TIGER_PRIVATE_KEY_PATH || "",
    license: process.env.TIGER_LICENSE || "",
    sandbox: boolEnv(process.env.TIGER_SANDBOX)
  },
  ibkr: {
    enabled: boolEnv(process.env.IBKR_ENABLED),
    host: process.env.IBKR_TWS_HOST || "127.0.0.1",
    port: numberEnv(process.env.IBKR_TWS_PORT, 7497),
    mode: process.env.IBKR_MODE || "paper"
  },
  chief: {
    enabled: boolEnv(process.env.CHIEF_ENABLED),
    officialApiUrl: process.env.CHIEF_OFFICIAL_API_URL || "",
    note: process.env.CHIEF_API_NOTE || ""
  }
});

const testTcpConnection = ({ host, port, timeoutMs = 1500 }) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, error: "connection timeout" }));
    socket.once("error", (error) => finish({ ok: false, error: error.message }));
  });

export const testFutuOpenD = async () => {
  const config = getBrokerConfig().futu;
  if (!config.enabled) return { ok: false, skipped: true, error: "FUTU_ENABLED is not configured" };
  const result = await testTcpConnection(config);
  return {
    broker: "futu",
    host: config.host,
    port: config.port,
    mode: "read-only",
    ...result
  };
};

export const testTigerConfig = async () => {
  const config = getBrokerConfig().tiger;
  const missing = [];
  if (!config.enabled) missing.push("TIGER_ENABLED");
  if (!config.clientId) missing.push("TIGER_CLIENT_ID");
  if (!config.account) missing.push("TIGER_ACCOUNT");
  if (!config.privateKeyPath) missing.push("TIGER_PRIVATE_KEY_PATH");
  if (!config.license) missing.push("TIGER_LICENSE");

  let keyFileReadable = false;
  if (config.privateKeyPath) {
    try {
      await access(config.privateKeyPath);
      keyFileReadable = true;
    } catch {
      missing.push("readable private key file");
    }
  }

  return {
    broker: "tiger",
    ok: missing.length === 0,
    mode: config.sandbox ? "sandbox read-only" : "live read-only",
    missing,
    keyFileReadable
  };
};

export const testIbkrGateway = async () => {
  const config = getBrokerConfig().ibkr;
  if (!config.enabled) return { ok: false, skipped: true, error: "IBKR_ENABLED is not configured" };
  const result = await testTcpConnection(config);
  return {
    broker: "ibkr",
    host: config.host,
    port: config.port,
    mode: `${config.mode} read-only`,
    ...result
  };
};

export const testChiefConfig = async () => {
  const config = getBrokerConfig().chief;
  return {
    broker: "chief",
    ok: false,
    skipped: true,
    enabled: config.enabled,
    officialApiUrl: config.officialApiUrl,
    error: "未发现致富证券面向个人投资者的公开 OpenAPI 文档；系统不会接入 App 私有接口或抓包接口。",
    mode: "official-api-only"
  };
};

export const getBrokerStatus = async () => {
  const config = getBrokerConfig();
  return {
    futu: {
      enabled: config.futu.enabled,
      host: config.futu.host,
      port: config.futu.port,
      readOnly: true,
      masked: {}
    },
    tiger: {
      enabled: config.tiger.enabled,
      configured: Boolean(config.tiger.clientId && config.tiger.account && config.tiger.privateKeyPath && config.tiger.license),
      sandbox: config.tiger.sandbox,
      readOnly: true,
      masked: {
        clientId: maskSecret(config.tiger.clientId),
        account: maskSecret(config.tiger.account),
        privateKeyPath: config.tiger.privateKeyPath ? `${config.tiger.privateKeyPath.slice(0, 3)}****${config.tiger.privateKeyPath.slice(-12)}` : "",
        license: maskSecret(config.tiger.license)
      }
    },
    ibkr: {
      enabled: config.ibkr.enabled,
      host: config.ibkr.host,
      port: config.ibkr.port,
      mode: config.ibkr.mode,
      readOnly: true,
      masked: {}
    },
    chief: {
      enabled: config.chief.enabled,
      configured: Boolean(config.chief.officialApiUrl),
      officialApiUrl: config.chief.officialApiUrl,
      readOnly: true,
      unsupported: true,
      note: config.chief.note || "未发现官方公开 OpenAPI；禁用 App 私有接口接入。"
    },
    note: "Broker API integration is read-only in this phase. Trading endpoints are intentionally disabled."
  };
};

export const buildBrokerEnvValues = (body = {}) => ({
  FUTU_ENABLED: body.futuEnabled ? "true" : "",
  FUTU_OPEND_HOST: body.futuHost || "127.0.0.1",
  FUTU_OPEND_PORT: body.futuPort || "11111",
  TIGER_ENABLED: body.tigerEnabled ? "true" : "",
  TIGER_CLIENT_ID: body.tigerClientId || "",
  TIGER_ACCOUNT: body.tigerAccount || "",
  TIGER_PRIVATE_KEY_PATH: body.tigerPrivateKeyPath || "",
  TIGER_LICENSE: body.tigerLicense || "",
  TIGER_SANDBOX: body.tigerSandbox ? "true" : "",
  IBKR_ENABLED: body.ibkrEnabled ? "true" : "",
  IBKR_TWS_HOST: body.ibkrHost || "127.0.0.1",
  IBKR_TWS_PORT: body.ibkrPort || "7497",
  IBKR_MODE: body.ibkrMode || "paper",
  CHIEF_ENABLED: body.chiefEnabled ? "true" : "",
  CHIEF_OFFICIAL_API_URL: body.chiefOfficialApiUrl || "",
  CHIEF_API_NOTE: body.chiefApiNote || ""
});
