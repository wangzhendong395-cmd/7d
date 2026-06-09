export const daysAgoIso = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

export const toDateOnly = (value) => {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
};

export const isWithinDays = (dateValue, days) => {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return date >= new Date(daysAgoIso(days));
};

export const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export const inferEventType = (title = "") => {
  const text = title.toLowerCase();
  if (/(10-k|10-q|annual report|quarterly report|interim results|annual results|results announcement)/i.test(title)) {
    return "财报超预期";
  }
  if (/(8-k|current report|inside information|announcement)/i.test(title)) return "行业主题升温";
  if (/(repurchase|buy-back|buyback)/i.test(title)) return "股票回购";
  if (/(merger|acquisition|disposal|connected transaction)/i.test(title)) return "并购重组";
  if (/(approval|fda|regulatory)/i.test(title)) return "监管审批";
  if (/(investigation|probe|litigation|lawsuit)/i.test(title)) return "监管调查";
  if (text.includes("placing") || text.includes("subscription") || text.includes("offering")) return "融资摊薄";
  return "行业主题升温";
};

export const eventSourceId = (...parts) =>
  parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
