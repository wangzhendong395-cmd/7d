import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const parseEnvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index < 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
};

export const loadLocalEnv = async () => {
  const file = envFilePath();
  try {
    const text = await readFile(file, "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const parsed = parseEnvLine(line);
      if (!parsed || process.env[parsed.key]) return;
      process.env[parsed.key] = parsed.value;
    });
    return { loaded: true, file };
  } catch (error) {
    if (error.code === "ENOENT") return { loaded: false, file };
    throw error;
  }
};

const envFilePath = () => process.env.RADAR_ENV_PATH || path.join(rootDir, ".env.local");

export const saveLocalEnvValues = async (values) => {
  const existing = {};
  try {
    const text = await readFile(envFilePath(), "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const parsed = parseEnvLine(line);
      if (parsed) existing[parsed.key] = parsed.value;
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const next = {
    ...existing,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  };

  const orderedKeys = [
    "FEISHU_WEBHOOK_URL",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_VERIFICATION_TOKEN",
    "FUTU_ENABLED",
    "FUTU_OPEND_HOST",
    "FUTU_OPEND_PORT",
    "TIGER_ENABLED",
    "TIGER_CLIENT_ID",
    "TIGER_ACCOUNT",
    "TIGER_PRIVATE_KEY_PATH",
    "TIGER_LICENSE",
    "TIGER_SANDBOX",
    "IBKR_ENABLED",
    "IBKR_TWS_HOST",
    "IBKR_TWS_PORT",
    "IBKR_MODE",
    "CHIEF_ENABLED",
    "CHIEF_OFFICIAL_API_URL",
    "CHIEF_API_NOTE",
    "SEC_USER_AGENT"
  ];
  const keys = [...orderedKeys, ...Object.keys(next).filter((key) => !orderedKeys.includes(key))];
  const lines = keys
    .filter((key) => next[key] !== undefined)
    .map((key) => `${key}=${next[key] || ""}`);

  await writeFile(envFilePath(), `${lines.join("\n")}\n`, "utf8");
  Object.entries(next).forEach(([key, value]) => {
    process.env[key] = value;
  });
  return { saved: true, file: envFilePath() };
};

export const maskSecret = (value = "") => {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};
