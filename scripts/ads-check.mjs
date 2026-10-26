// Checks that Google Ads Keyword Planner answers, using the `google-ads-api`
// library and the login that `gsc-mcp` already saved under ~/.gsc-mcp.
//
//   GOOGLE_ADS_DEVELOPER_TOKEN=... node scripts/ads-check.mjs [seed keyword]
//
// ADS_CLIENT_ID / ADS_CLIENT_SECRET are read from the environment, or from
// ~/.gsc-mcp/ads-credentials.json when unset. Optional: ADS_LOGIN_CUSTOMER_ID
// (the manager account id) if the account is reached through a manager.
// Nothing secret is printed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleAdsApi, enums } from "google-ads-api";

const dir = path.join(os.homedir(), ".gsc-mcp");
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const login = readJson(path.join(dir, "ads-tokens", "default.json"));
const creds = readJson(path.join(dir, "ads-credentials.json"));
const clientId = process.env.ADS_CLIENT_ID || creds?.clientId || creds?.client_id;
const clientSecret = process.env.ADS_CLIENT_SECRET || creds?.clientSecret || creds?.client_secret;
const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

const missing = [];
if (!login?.tokens?.refresh_token) missing.push("saved login (~/.gsc-mcp/ads-tokens/default.json)");
if (!login?.customerId) missing.push("customer id in that login");
if (!clientId || !clientSecret) missing.push("ADS_CLIENT_ID / ADS_CLIENT_SECRET");
if (!developerToken) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
if (missing.length) {
  console.error("Missing: " + missing.join(", "));
  process.exit(2);
}

const api = new GoogleAdsApi({
  client_id: clientId,
  client_secret: clientSecret,
  developer_token: developerToken,
});
const customer = api.Customer({
  customer_id: String(login.customerId).replace(/\D/g, ""),
  refresh_token: login.tokens.refresh_token,
  ...(process.env.ADS_LOGIN_CUSTOMER_ID
    ? { login_customer_id: process.env.ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, "") }
    : {}),
});

const seed = process.argv[2] || "seo";
try {
  const res = await customer.keywordPlanIdeas.generateKeywordIdeas({
    customer_id: String(login.customerId).replace(/\D/g, ""),
    language: "languageConstants/1000",
    geo_target_constants: ["geoTargetConstants/2840"],
    keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
    include_adult_keywords: false,
    page_size: 10,
    keyword_seed: { keywords: [seed] },
  });
  const rows = res.results ?? res;
  console.log(`OK: Keyword Planner returned ${rows.length} ideas for "${seed}".`);
  for (const r of rows.slice(0, 5)) {
    const m = r.keyword_idea_metrics ?? {};
    console.log(`  ${r.text}  ${m.avg_monthly_searches ?? 0}/month  competition ${m.competition ?? "?"}`);
  }
} catch (err) {
  const e = err?.errors?.[0];
  console.error("FAILED: " + (e?.message ?? err?.message ?? String(err)));
  process.exit(1);
}
