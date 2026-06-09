import { collectHkexAnnouncements } from "./hkex.js";
import { collectSecFilings } from "./sec.js";

export const collectOfficialDisclosures = async ({ config, markets = ["US", "HK"], days = 7 }) => {
  const events = [];
  const errors = [];

  if (markets.includes("US") && config.us?.length) {
    try {
      events.push(...(await collectSecFilings({ symbols: config.us, days })));
    } catch (error) {
      errors.push({ source: "SEC EDGAR", message: error.message });
    }
  }

  if (markets.includes("HK") && config.hk?.length) {
    try {
      events.push(...(await collectHkexAnnouncements({ stocks: config.hk, days })));
    } catch (error) {
      errors.push({ source: "HKEXnews", message: error.message });
    }
  }

  return { events, errors };
};
