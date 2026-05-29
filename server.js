const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const Module = require("module");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const REPORTS_DIR = path.join(ROOT, "reports");
const LATEST_REPORT_FILE = "report-latest.json";
const LATEST_SCREENSHOT_FILE = "screenshot-latest.png";
const LATEST_DESKTOP_SCREENSHOT_FILE = "screenshot-desktop-latest.png";
const BUNDLED_NODE_MODULES =
  "/Users/kefei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const COMPETITOR_SEARCH_CACHE = new Map();
const COMPETITOR_CACHE_TTL_MS = 1000 * 60 * 30;
const CLERK_EMAIL_CACHE = new Map();
const CLERK_EMAIL_CACHE_TTL_MS = 1000 * 60 * 60;

fs.mkdirSync(REPORTS_DIR, { recursive: true });

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function cleanupReportCache() {
  for (const file of fs.readdirSync(REPORTS_DIR)) {
    if (file === LATEST_REPORT_FILE || file === LATEST_SCREENSHOT_FILE || file === LATEST_DESKTOP_SCREENSHOT_FILE) continue;
    if (!/^report-|^screenshot-/.test(file)) continue;
    fs.rmSync(path.join(REPORTS_DIR, file), { force: true });
  }
}

cleanupReportCache();

function tryRequirePlaywright() {
  for (const name of ["playwright-core", "playwright"]) {
    try {
      return require(name);
    } catch (_) {}
  }
  try {
    const req = Module.createRequire(path.join(BUNDLED_NODE_MODULES, "package.json"));
    return req("playwright");
  } catch (_) {
    return null;
  }
}

function requireDiagnostics(name) {
  try {
    return { available: true, path: require.resolve(name) };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function findBundledChromiumExecutable() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/ms-playwright"].filter(Boolean);
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const dirs = fs.readdirSync(root).filter((name) => /^chromium/.test(name)).sort().reverse();
      for (const dir of dirs) {
        const candidates = [
          path.join(root, dir, "chrome-linux", "chrome"),
          path.join(root, dir, "chrome-linux", "headless_shell"),
          path.join(root, dir, "chrome-linux", "chrome-wrapper"),
          path.join(root, dir, "chrome-linux", "chromium"),
          path.join(root, dir, "chromium-linux", "chrome"),
          path.join(root, dir, "chromium-linux", "headless_shell")
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch (_) {}
  }
  return "";
}

function chromiumLaunchOptions() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findBundledChromiumExecutable();
  return {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    ...(executablePath ? { executablePath } : {})
  };
}

function playwrightRuntimeDiagnostics(extra = {}) {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/ms-playwright"].filter(Boolean);
  const browserRoots = roots.map((root) => {
    let exists = false;
    let entries = [];
    try {
      exists = fs.existsSync(root);
      entries = exists ? fs.readdirSync(root).slice(0, 20) : [];
    } catch (error) {
      entries = [`read error: ${error.message}`];
    }
    return { root, exists, entries };
  });
  return {
    ...extra,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    playwrightCore: requireDiagnostics("playwright-core"),
    playwright: requireDiagnostics("playwright"),
    chromiumExecutablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findBundledChromiumExecutable(),
    browserRoots
  };
}

async function gotoForScreenshot(page, targetUrl, timeout = 18000) {
  const result = { response: null, error: "", committed: false };
  try {
    result.response = await page.goto(targetUrl, { waitUntil: "commit", timeout });
    result.committed = true;
  } catch (error) {
    result.error = error.message;
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 3500 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 800 }).catch(() => {});
  return result;
}

function isSkippableRequest(request) {
  const type = request.resourceType();
  if (["media", "font"].includes(type)) return true;
  const url = request.url();
  return /googletagmanager|google-analytics|doubleclick|facebook\.net|connect\.facebook|tiktok|hotjar|clarity\.ms|pinterest|snapchat|redditstatic|klaviyo|yotpo|attentive|postscript|gorgias|intercom|zendesk|criteo/i.test(url);
}

async function speedUpPage(page) {
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(18000);
  await page.route("**/*", (route) => {
    const request = route.request();
    if (isSkippableRequest(request)) return route.abort().catch(() => {});
    return route.continue().catch(() => {});
  }).catch(() => {});
}

async function safeScreenshot(page, options, timeout = 4500) {
  return Promise.race([
    page.screenshot(options),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Screenshot timed out.")), timeout))
  ]);
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(payload);
}

function hasRealEnvValue(value) {
  return Boolean(value && !/粘贴|your_|xxx|^\s*$/i.test(String(value)));
}

function clerkAuthEnabled() {
  return hasRealEnvValue(process.env.CLERK_SECRET_KEY) && hasRealEnvValue(process.env.CLERK_PUBLISHABLE_KEY);
}

function desktopScreenshotEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DESKTOP_SCREENSHOT || ""));
}

function allowedEmails() {
  return String(process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function primaryEmailFromClerkPayload(payload) {
  const direct = payload && (payload.email || payload.email_address || payload.emailAddress);
  if (direct) return String(direct).toLowerCase();
  const claims = payload && payload.claims && typeof payload.claims === "object" ? payload.claims : {};
  const claimEmail = claims.email || claims.email_address || claims.emailAddress;
  if (claimEmail) return String(claimEmail).toLowerCase();
  return "";
}

async function fetchClerkUserPrimaryEmail(userId) {
  if (!userId || !hasRealEnvValue(process.env.CLERK_SECRET_KEY)) return "";
  const cached = CLERK_EMAIL_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.email;
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` }
    });
    if (!response.ok) return "";
    const user = await response.json();
    const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
    const primary = emails.find((item) => item.id === user.primary_email_address_id) || emails[0];
    const email = String(primary && primary.email_address || "").toLowerCase();
    if (email) CLERK_EMAIL_CACHE.set(userId, { email, expiresAt: Date.now() + CLERK_EMAIL_CACHE_TTL_MS });
    return email;
  } catch (_) {
    return "";
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyClerkRequest(req) {
  if (!clerkAuthEnabled()) return { ok: true, userId: "local-dev", disabled: true };
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, error: "需要登录后才能使用分析接口。" };
  try {
    const { verifyToken } = await import("@clerk/backend");
    const authorizedParties = String(process.env.CLERK_AUTHORIZED_PARTIES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      ...(authorizedParties.length ? { authorizedParties } : {})
    });
    let email = primaryEmailFromClerkPayload(payload);
    const allowlist = allowedEmails();
    if (allowlist.length && !email) {
      email = await fetchClerkUserPrimaryEmail(payload.sub);
    }
    if (allowlist.length && !email) {
      return { ok: false, status: 403, error: "后端没有从 Clerk 读取到登录邮箱，请检查 CLERK_SECRET_KEY。" };
    }
    if (allowlist.length && !allowlist.includes(email)) {
      return { ok: false, status: 403, error: `邮箱 ${email} 不在访问白名单里。` };
    }
    return { ok: true, userId: payload.sub, email, payload };
  } catch (error) {
    return { ok: false, status: 401, error: "登录状态无效，请重新登录。" };
  }
}

async function requireApiAuth(req, res) {
  const auth = await verifyClerkRequest(req);
  if (!auth.ok) {
    jsonResponse(res, auth.status || 401, { error: auth.error || "Unauthorized" });
    return null;
  }
  return auth;
}

function publicRuntimeConfig() {
  const allowlist = allowedEmails();
  return {
    authEnabled: clerkAuthEnabled(),
    clerkPublishableKey: clerkAuthEnabled() ? process.env.CLERK_PUBLISHABLE_KEY : "",
    allowlistEnabled: allowlist.length > 0,
    allowedEmailDomains: Array.from(new Set(allowlist.map((email) => email.split("@")[1]).filter(Boolean))).slice(0, 8)
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function normalizeKeywords(input) {
  if (Array.isArray(input)) {
    return input.map(String).map((item) => item.trim()).filter(Boolean);
  }
  return String(input || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCountryInput(input) {
  const raw = String(input || "AUTO").trim();
  if (!raw || /^auto|自动|自动识别$/i.test(raw)) return "AUTO";
  const key = raw.toLowerCase().replace(/[._]/g, "-").replace(/\s+/g, " ").trim();
  const aliases = {
    us: "US", usa: "US", "u.s.": "US", "united states": "US", america: "US", "美国": "US",
    uk: "UK", gb: "UK", "great britain": "UK", "united kingdom": "UK", "英国": "UK",
    ca: "CA", canada: "CA", "加拿大": "CA",
    au: "AU", australia: "AU", "澳大利亚": "AU",
    de: "DE", germany: "DE", deutschland: "DE", "德国": "DE",
    fr: "FR", france: "FR", "法国": "FR",
    es: "ES", spain: "ES", "西班牙": "ES",
    it: "IT", italy: "IT", "意大利": "IT",
    jp: "JP", japan: "JP", "日本": "JP",
    kr: "KR", korea: "KR", "south korea": "KR", "韩国": "KR",
    sg: "SG", singapore: "SG", "新加坡": "SG",
    ae: "AE", uae: "AE", "united arab emirates": "AE", "阿联酋": "AE",
    sa: "SA", "saudi arabia": "SA", "沙特": "SA",
    mx: "MX", mexico: "MX", "墨西哥": "MX",
    br: "BR", brazil: "BR", brasil: "BR", "巴西": "BR",
    nl: "NL", netherlands: "NL", holland: "NL", "荷兰": "NL",
    se: "SE", sweden: "SE", "瑞典": "SE",
    hk: "HK", "hong kong": "HK", "中国香港": "HK", "香港": "HK",
    tw: "TW", taiwan: "TW", "中国台湾": "TW", "台湾": "TW",
    mo: "MO", macau: "MO", "macao": "MO", "中国澳门": "MO", "澳门": "MO",
    ch: "CH", switzerland: "CH", "瑞士": "CH",
    at: "AT", austria: "AT", "奥地利": "AT",
    be: "BE", belgium: "BE", "比利时": "BE",
    pl: "PL", poland: "PL", "波兰": "PL",
    pt: "PT", portugal: "PT", "葡萄牙": "PT",
    no: "NO", norway: "NO", "挪威": "NO",
    dk: "DK", denmark: "DK", "丹麦": "DK",
    fi: "FI", finland: "FI", "芬兰": "FI",
    nz: "NZ", "new zealand": "NZ", "新西兰": "NZ",
    in: "IN", india: "IN", "印度": "IN",
    th: "TH", thailand: "TH", "泰国": "TH",
    vn: "VN", vietnam: "VN", "越南": "VN",
    my: "MY", malaysia: "MY", "马来西亚": "MY",
    ph: "PH", philippines: "PH", "菲律宾": "PH",
    id: "ID", indonesia: "ID", "印度尼西亚": "ID",
    za: "ZA", "south africa": "ZA", "南非": "ZA"
  };
  return aliases[key] || raw.toUpperCase().slice(0, 32);
}

function countryRules(country) {
  const rules = {
    US: { currency: ["$", "USD"], locale: "en-US", languageHint: "English", market: "United States", privacy: "standard" },
    UK: { currency: ["£", "GBP"], locale: "en-GB", languageHint: "English", market: "United Kingdom", privacy: "gdpr" },
    CA: { currency: ["$", "CAD"], locale: "en-CA", languageHint: "English/French", market: "Canada", privacy: "standard" },
    AU: { currency: ["$", "AUD"], locale: "en-AU", languageHint: "English", market: "Australia", privacy: "standard" },
    DE: { currency: ["€", "EUR"], locale: "de-DE", languageHint: "German", market: "Germany", privacy: "gdpr" },
    FR: { currency: ["€", "EUR"], locale: "fr-FR", languageHint: "French", market: "France", privacy: "gdpr" },
    ES: { currency: ["€", "EUR"], locale: "es-ES", languageHint: "Spanish", market: "Spain", privacy: "gdpr" },
    IT: { currency: ["€", "EUR"], locale: "it-IT", languageHint: "Italian", market: "Italy", privacy: "gdpr" },
    JP: { currency: ["¥", "JPY"], locale: "ja-JP", languageHint: "Japanese", market: "Japan", privacy: "standard" },
    KR: { currency: ["₩", "KRW"], locale: "ko-KR", languageHint: "Korean", market: "South Korea", privacy: "standard" },
    SG: { currency: ["S$", "SGD"], locale: "en-SG", languageHint: "English", market: "Singapore", privacy: "standard" },
    AE: { currency: ["AED"], locale: "en-AE", languageHint: "English/Arabic", market: "United Arab Emirates", privacy: "standard" },
    SA: { currency: ["SAR"], locale: "en-SA", languageHint: "English/Arabic", market: "Saudi Arabia", privacy: "standard" },
    MX: { currency: ["MXN", "$"], locale: "es-MX", languageHint: "Spanish", market: "Mexico", privacy: "standard" },
    BR: { currency: ["R$", "BRL"], locale: "pt-BR", languageHint: "Portuguese", market: "Brazil", privacy: "standard" },
    NL: { currency: ["€", "EUR"], locale: "nl-NL", languageHint: "Dutch", market: "Netherlands", privacy: "gdpr" },
    SE: { currency: ["SEK", "kr"], locale: "sv-SE", languageHint: "Swedish", market: "Sweden", privacy: "gdpr" },
    HK: { currency: ["HK$", "HKD"], locale: "zh-HK", languageHint: "Traditional Chinese/English", market: "Hong Kong", privacy: "standard" },
    TW: { currency: ["NT$", "TWD"], locale: "zh-TW", languageHint: "Traditional Chinese", market: "Taiwan", privacy: "standard" },
    MO: { currency: ["MOP"], locale: "zh-MO", languageHint: "Traditional Chinese/Portuguese", market: "Macau", privacy: "standard" },
    CH: { currency: ["CHF"], locale: "de-CH", languageHint: "German/French/Italian", market: "Switzerland", privacy: "gdpr" },
    AT: { currency: ["€", "EUR"], locale: "de-AT", languageHint: "German", market: "Austria", privacy: "gdpr" },
    BE: { currency: ["€", "EUR"], locale: "nl-BE", languageHint: "Dutch/French", market: "Belgium", privacy: "gdpr" },
    PL: { currency: ["PLN", "zł"], locale: "pl-PL", languageHint: "Polish", market: "Poland", privacy: "gdpr" },
    PT: { currency: ["€", "EUR"], locale: "pt-PT", languageHint: "Portuguese", market: "Portugal", privacy: "gdpr" },
    NO: { currency: ["NOK", "kr"], locale: "nb-NO", languageHint: "Norwegian", market: "Norway", privacy: "gdpr" },
    DK: { currency: ["DKK", "kr"], locale: "da-DK", languageHint: "Danish", market: "Denmark", privacy: "gdpr" },
    FI: { currency: ["€", "EUR"], locale: "fi-FI", languageHint: "Finnish", market: "Finland", privacy: "gdpr" },
    NZ: { currency: ["NZ$", "NZD"], locale: "en-NZ", languageHint: "English", market: "New Zealand", privacy: "standard" },
    IN: { currency: ["₹", "INR"], locale: "en-IN", languageHint: "English/Hindi", market: "India", privacy: "standard" },
    TH: { currency: ["฿", "THB"], locale: "th-TH", languageHint: "Thai", market: "Thailand", privacy: "standard" },
    VN: { currency: ["₫", "VND"], locale: "vi-VN", languageHint: "Vietnamese", market: "Vietnam", privacy: "standard" },
    MY: { currency: ["RM", "MYR"], locale: "en-MY", languageHint: "Malay/English", market: "Malaysia", privacy: "standard" },
    PH: { currency: ["₱", "PHP"], locale: "en-PH", languageHint: "English/Filipino", market: "Philippines", privacy: "standard" },
    ID: { currency: ["Rp", "IDR"], locale: "id-ID", languageHint: "Indonesian", market: "Indonesia", privacy: "standard" },
    ZA: { currency: ["R", "ZAR"], locale: "en-ZA", languageHint: "English", market: "South Africa", privacy: "standard" }
  };
  return rules[country] || { currency: [], locale: "en-US", languageHint: "Unknown", market: country || "Auto", privacy: "standard" };
}

function inferCountry(text, targetUrl, structured = {}) {
  const clean = String(text || "");
  const score = {};
  const add = (country, points) => {
    if (!country) return;
    score[country] = (score[country] || 0) + points;
  };
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    const pathSegments = parsed.pathname
      .split("/")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const firstMarketSegment = pathSegments[0] || "";
    const localeSegment = firstMarketSegment.replace("_", "-");
    const pathCountryMap = {
      us: "US", ca: "CA", "en-ca": "CA", "fr-ca": "CA",
      uk: "UK", gb: "UK", "en-gb": "UK",
      au: "AU", "en-au": "AU",
      de: "DE", "de-de": "DE", fr: "FR", "fr-fr": "FR", es: "ES", "es-es": "ES", it: "IT", "it-it": "IT",
      jp: "JP", "ja-jp": "JP", kr: "KR", "ko-kr": "KR", sg: "SG", "en-sg": "SG", ae: "AE", "ar-ae": "AE",
      mx: "MX", "es-mx": "MX", br: "BR", "pt-br": "BR", nl: "NL", "nl-nl": "NL", se: "SE", "sv-se": "SE"
    };
    if (host.endsWith(".co.uk") || host.endsWith(".uk")) add("UK", 80);
    if (host.endsWith(".ca")) add("CA", 80);
    if (host.endsWith(".com.au") || host.endsWith(".au")) add("AU", 80);
    if (host.endsWith(".de")) add("DE", 80);
    if (host.endsWith(".fr")) add("FR", 80);
    if (host.endsWith(".es")) add("ES", 80);
    if (host.endsWith(".it")) add("IT", 80);
    if (host.endsWith(".jp")) add("JP", 80);
    if (host.endsWith(".kr")) add("KR", 80);
    if (host.endsWith(".sg")) add("SG", 80);
    if (host.endsWith(".ae")) add("AE", 80);
    if (host.endsWith(".mx")) add("MX", 80);
    if (host.endsWith(".br")) add("BR", 80);
    if (host.endsWith(".nl")) add("NL", 80);
    if (host.endsWith(".se")) add("SE", 80);
    if (pathCountryMap[localeSegment]) add(pathCountryMap[localeSegment], 90);
  } catch (_) {}

  const meta = structured && structured.meta ? structured.meta : {};
  const currency = String(
    structured.productCurrency ||
    meta["product:price:currency"] ||
    meta["og:price:currency"] ||
    meta["twitter:data2"] ||
    ""
  ).toUpperCase();
  if (currency === "USD") add("US", 75);
  if (currency === "CAD") add("CA", 75);
  if (currency === "AUD") add("AU", 75);
  if (currency === "GBP") add("UK", 75);
  if (currency === "JPY") add("JP", 75);
  if (currency === "KRW") add("KR", 75);
  if (currency === "SGD") add("SG", 75);
  if (currency === "MXN") add("MX", 75);
  if (currency === "BRL") add("BR", 75);
  if (currency === "EUR") add("DE", 35);

  const priceText = [structured.offerPrice, structured.metaPrice, structured.shopifyPrice, meta["product:price:amount"], meta["og:price:amount"]]
    .filter(Boolean)
    .join(" ");
  if (/\$\s?\d|\bUSD\b/i.test(priceText)) add("US", 65);
  if (/\bCAD\b/i.test(priceText)) add("CA", 65);
  if (/\bAUD\b/i.test(priceText)) add("AU", 65);
  if (/£|\bGBP\b/i.test(priceText)) add("UK", 65);
  if (/€|\bEUR\b/i.test(priceText)) add("DE", 30);

  if (/\bUSD\b/i.test(clean)) add("US", 45);
  if (/\$\s?\d/.test(clean)) add("US", 25);
  if (/\bCAD\b/i.test(clean)) add("CA", 45);
  if (/\bAUD\b/i.test(clean)) add("AU", 45);
  if (/£|\bGBP\b/i.test(clean)) add("UK", 45);
  if (/¥|\bJPY\b/i.test(clean)) add("JP", 45);
  if (/₩|\bKRW\b/i.test(clean)) add("KR", 45);
  if (/\bSGD\b|S\$/i.test(clean)) add("SG", 45);
  if (/\bAED\b/i.test(clean)) add("AE", 45);
  if (/\bSAR\b/i.test(clean)) add("SA", 45);
  if (/\bMXN\b/i.test(clean)) add("MX", 45);
  if (/\bBRL\b|R\$/i.test(clean)) add("BR", 45);
  if (/\bSEK\b/i.test(clean)) add("SE", 45);
  if (/€|\bEUR\b/i.test(clean)) add("DE", 20);

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return ranked[0] ? ranked[0][0] : "US";
}

function textIncludes(text, needle) {
  return text.toLowerCase().includes(String(needle).toLowerCase());
}

function compactText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickNearbyLines(lines, pattern, limit = 4) {
  const matches = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      matches.push(line.replace(/\s+/g, " ").trim());
    }
  }
  return uniqueItems(matches).slice(0, limit);
}

function splitUsefulLines(text) {
  return compactText(text)
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 180);
}

function extractChineseSnippets(text, structured = {}) {
  const visible = Array.isArray(structured.visibleBlocks)
    ? structured.visibleBlocks.map((block) => block.text)
    : [];
  const source = visible.length ? visible : splitUsefulLines(text);
  const snippets = [];
  for (const line of source) {
    const clean = String(line || "").replace(/\s+/g, " ").trim();
    if (!/[\u4e00-\u9fff]/.test(clean)) continue;
    snippets.push(clean.length > 80 ? `${clean.slice(0, 80)}...` : clean);
  }
  return uniqueItems(snippets).slice(0, 8);
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s+[|–—-]\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productNameFromUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return last
      .replace(/\.(html?|php)$/i, "")
      .replace(/-\d+$/g, "")
      .split("-")
      .filter((part) => part && !/^(products?|collections?|pdp|shop|buy)$/i.test(part))
      .slice(0, 18)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
      .trim();
  } catch (_) {
    return "";
  }
}

function extractStructuredTextFromHtml(html) {
  const meta = {};
  for (const match of html.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attrs = match[1];
    const name = (attrs.match(/\b(?:name|property)=["']([^"']+)["']/i) || [])[1];
    const content = (attrs.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (name && content) meta[name.toLowerCase()] = content.replace(/\s+/g, " ").trim();
  }
  const pickTags = (tag) => {
    const out = [];
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    for (const match of html.matchAll(re)) {
      const value = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (value) out.push(value);
    }
    return uniqueItems(out).slice(0, 12);
  };
  return {
    meta,
    h1: pickTags("h1"),
    h2: pickTags("h2"),
    h3: pickTags("h3"),
    buttons: pickTags("button")
  };
}

function isGenericName(name) {
  const value = String(name || "").trim();
  return /^(home|shop|store|official|welcome|example domain|untitled|landing page|your connection needs to be verified before you can proceed|there was a problem loading this website)$/i.test(value) ||
    /^[\d-]{8,}(?:-[a-z_]+)?$/i.test(value);
}

function isSitewidePromo(line) {
  return /\b(unlock|first order|email|subscribe|newsletter|sms|get code|welcome|sign up|spin|wheel|select models|mother's day|sitewide)\b/i.test(String(line || ""));
}

function isTrustOrServiceLine(line) {
  return /\b(24\/7|phone support|always-on service|service is here|customer service|reviews?|warranty|returns?|certified|secure|protection|support service|support you|sgs|aig)\b/i.test(String(line || ""));
}

function isLogisticsOrPolicyLine(line) {
  return /\b(free shipping|shipping|delivery|deliver|returns?|refund|exchange|guarantee|warranty|privacy|cookie|terms|support|customer service|customers?\s+say|reviews?|rated|stars?|click to scroll|country\/region|select your country|cart)\b/i.test(String(line || ""));
}

function isRecommendationLine(line) {
  return /\b(you may also like|related|recommended|complete your routine|build your ritual|add on|add ons|popular add ons|blog|review|never heard of|versus|which ebike|better than|helmet|bag|seat|accessor(?:y|ies)|replacement parts|sold separately|not for sale|non-delivery|shop all|about us|open navigation)\b/i.test(String(line || ""));
}

function isGenericUiLine(line) {
  const value = String(line || "").trim();
  return /^(cart|menu|search|account|products?|categories|we suggest|open media .*|select your country\/region|country\/region|learn more|read more|click to expand.*|previous|next|close|continue)$/i.test(value) ||
    /\b(decrease quantity|increase quantity|quantity for|open media|rediscover the joy|explore ebikes built|memorial day special offer|special offer|select your country\/region)\b/i.test(value) ||
    /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(value);
}

function isBareLabel(line) {
  const value = String(line || "").trim();
  if (!value || value.length > 34) return false;
  if (/\d/.test(value)) return false;
  if (/\b(with|for|without|built|designed|featuring|includes)\b/i.test(value)) return false;
  return /^[A-Z0-9\s/&+-]+$/.test(value) || value.split(/\s+/).length <= 2;
}

function isProductOfferLine(line) {
  const value = String(line || "");
  if (isSitewidePromo(value) || isRecommendationLine(value)) return false;
  if (/\b(not for sale|non-delivery|sold separately|free\/not for sale)\b/i.test(value)) return false;
  return true;
}

function isPurchaseCta(line) {
  return /\b(add to cart|add to bag|buy now|buy with|checkout|order now|select size|select options|choose options|shop now)\b/i.test(String(line || ""));
}

function isNonPurchaseCta(line) {
  return /\b(terms of sale|payment options|privacy|cookie|size guide|reviews?|learn more|read more|subscribe|sign up|newsletter|get code|copy code|close|continue|menu|search)\b/i.test(String(line || ""));
}

function isOfferNoise(line) {
  return /\b(terms of sale|payment options|privacy|cookie|reviews?|review|subscribe|newsletter|sign up|email|size guide|learn more|read more|copy code|get code)\b/i.test(String(line || ""));
}

function extractCouponCodes(line) {
  const value = String(line || "");
  const candidates = [];
  for (const match of value.matchAll(/\b(?:code|coupon|promo code|discount code|with code|use code)\s*[:：]?\s*([A-Z0-9][A-Z0-9_-]{3,})\b/gi)) {
    candidates.push(match[1]);
  }
  if (/\b(code|coupon|promo|discount|with code|use code)\b/i.test(value)) {
    for (const match of value.matchAll(/\b[A-Z]{2,}[A-Z0-9_-]*\d+[A-Z0-9_-]*\b/g)) {
      candidates.push(match[0]);
    }
  }
  return uniqueItems(candidates)
    .filter((code) => !/^(COPY|CODE|PROMO|COUPON|DISCOUNT|SALE|SAVE|GET|WITH)$/i.test(code))
    .slice(0, 4);
}

function isSellingPointNoise(line) {
  return isGenericUiLine(line) ||
    isRecommendationLine(line) ||
    isSitewidePromo(line) ||
    isLogisticsOrPolicyLine(line) ||
    isOfferNoise(line) ||
    /\b(men|women|kids|sale|price|cart|bag|terms|payment|reviews?\s*\(?\d*\)?|free delivery|free shipping)\b/i.test(String(line || ""));
}

function extractMoneyValues(line) {
  return uniqueItems(String(line || "").match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)/gi) || []);
}

function parsePriceNumber(value) {
  const raw = String(value || "").replace(/[^0-9.]/g, "");
  const num = Number.parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

function itemText(item) {
  if (item && typeof item === "object") return String(item.text || item.value || "");
  return String(item || "");
}

function itemZh(item) {
  if (item && typeof item === "object") return String(item.zh || item.translation || "");
  return "";
}

function findEvidenceBlock(line, blocks) {
  const text = itemText(line).toLowerCase();
  if (!text) return null;
  return (blocks || []).find((block) => {
    const blockText = String(block.text || "").toLowerCase();
    return blockText === text || blockText.includes(text) || text.includes(blockText);
  }) || null;
}

function sourceLabelForBlock(block) {
  if (!block) return "全页";
  if (block.inViewport || (Number.isFinite(block.top) && block.top >= 0 && block.top <= 780)) return "首屏";
  if (block.zone === "product") return "产品区";
  if (Number.isFinite(block.top) && block.top > 1600) return "页面下方";
  return "全页";
}

function evidenceForLine(line, blocks, reason = "文本命中") {
  const text = itemText(line).replace(/\s+/g, " ").trim();
  if (/结构化/.test(reason)) {
    return { text, zh: "", source: "结构化数据", confidence: "high", reason };
  }
  const block = findEvidenceBlock(text, blocks);
  const source = sourceLabelForBlock(block);
  const confidence = source === "首屏" ? "high" : source === "产品区" ? "medium" : "low";
  return { text, zh: "", source, confidence, reason };
}

function evidenceList(lines, blocks, reason) {
  return uniqueItems(lines.map(itemText).filter(Boolean))
    .map((line) => evidenceForLine(line, blocks, reason));
}

function scoreSellingPointCandidate(line, block, productName = "") {
  const value = String(line || "").replace(/\s+/g, " ").trim();
  if (value.length < 8 || value.length > 180) return -100;
  if (productName && value.toLowerCase() === productName.toLowerCase()) return -100;
  if (isGenericUiLine(value) || isRecommendationLine(value) || isSitewidePromo(value)) return -100;
  if (/^["“”']/.test(value) || /\b(shop extra|shop now|shop women's sale|shop men's sale|sale price|regular price|add to cart|subscribe|sign up|supplier code|code of conduct|users frequently mention|i reached my floor|you smell good|buy now, pay later|interest-free|affirm)\b/i.test(value)) return -100;
  if (/\b(sale|discount|off)\b/i.test(value) && !/\bsoft|comfortable|durable|breathable|carbon|motor|battery|pressure|support|relief|compact|lightweight\b/i.test(value)) return -90;
  if (/^[A-Z][A-Za-z0-9®™ ]+\s+-\s+[A-Z][A-Za-z0-9®™ -]+$/.test(value) && value.split(/\s+/).length <= 7) return -90;
  if (isLogisticsOrPolicyLine(value) || /%|coupon|code|[$€£]\s?\d/i.test(value)) return -80;

  const productAttribute = /\b(hospital-?grade|hands-?free|wearable|portable|wireless|foldable|long-?range|belt drive|hydraulic|brake|motor|battery|range|speed|lightweight|quiet|compact|comfortable|comfort|suction|extraction|leak|spill|waterproof|durable|adjustable|rechargeable|reusable|skin-friendly|silicone|flange|collection cup|carbon|stability|storage|commuter|performance|power|capacity|safe|natural|breathable|organic|vegan|smart|automatic)\b/i.test(value);
  const outcomeBenefit = /\b(reduce|improve|protect|prevent|faster|fast|easy|easier|relief|boost|save time|without|no more|empowering|designed|built|engineered|helps?|enables?|supports?)\b/i.test(value);
  const hasSpec = /\b\d+(?:\.\d+)?\s?(?:mah|wh|w|v|mile|miles|km|lbs?|pounds|oz|hours?|levels?|mode|mph|kg|ml|mm|inch|inches|%)\b/i.test(value);
  let score = 0;
  if (block && block.inViewport) score += 35;
  if (block && block.zone === "product") score += 25;
  if (block && /^h[1-3]$/i.test(block.tag || "")) score += 12;
  if (block && /li|p|strong/i.test(block.tag || "")) score += 8;
  if (productAttribute) score += 36;
  if (outcomeBenefit) score += 18;
  if (hasSpec) score += 14;
  if (value.length >= 18 && value.length <= 120) score += 10;
  if (isBareLabel(value)) return -80;
  if (/^(motor power|foldable|range|battery|comfort|performance)$/i.test(value)) score -= 20;
  return score;
}

function extractSellingPointEvidence({ headingLines, visibleLines, lines, blocks, description, productName }) {
  const descriptionLines = splitUsefulLines(description || "");
  const candidates = uniqueItems([...descriptionLines, ...headingLines, ...visibleLines, ...lines])
    .map((line) => {
      const block = findEvidenceBlock(line, blocks);
      return {
        line,
        block,
        score: scoreSellingPointCandidate(line, block, productName)
      };
    })
    .filter((item) => item.score >= 24)
    .sort((a, b) => b.score - a.score);
  return candidates.slice(0, 7).map((item) => {
    const evidence = evidenceForLine(item.line, blocks, "卖点候选评分");
    return {
      ...evidence,
      confidence: item.score >= 75 ? "high" : item.score >= 48 ? "medium" : "low"
    };
  });
}

function priceExclusionReason(line) {
  const value = String(line || "");
  if (/\b(as low as|\/mo|affirm|klarna|afterpay|interest-free|pay in|installment)\b/i.test(value)) return "分期/BNPL 价格，不当作主商品售价";
  if (/\b(refer|get \$|away from free shipping|gift card|reward|points?)\b/i.test(value)) return "营销门槛或奖励金额，不是商品价格";
  if (/\b(supplier code|sku|style code|item code)\b/i.test(value)) return "商品代码/供应商信息，不是售价";
  if (/\b(accessor(?:y|ies)|add on|add-on|helmet|bag|replacement|spare|sold separately|not for sale)\b/i.test(value)) return "配件/加购/不可售价格，避免污染主商品";
  if (isSitewidePromo(value) || isRecommendationLine(value)) return "站点活动、推荐位或弹窗价格，不属于当前主商品";
  return "低相关价格噪音，未作为主价格证据";
}

function extractPriceInfo(lines, structured = {}) {
  const sourceCandidates = uniqueItems(lines.filter(isProductOfferLine));
  const priceNoiseRe = /\b(refer|get \$|away from free shipping|as low as|\/mo|affirm|klarna|afterpay|interest-free|supplier code|gift card|reward|points?|sold separately|not for sale)\b/i;
  const source = sourceCandidates.filter((line) => !priceNoiseRe.test(line));
  const excluded = sourceCandidates
    .filter((line) => extractMoneyValues(line).length)
    .filter((line) => !source.includes(line))
    .map((line) => ({ text: line.slice(0, 160), reason: priceExclusionReason(line) }))
    .slice(0, 8);
  const signals = [];
  const moneyValues = uniqueItems(source.flatMap(extractMoneyValues));
  const prices = moneyValues
    .map((value) => ({ value, number: parsePriceNumber(value) }))
    .filter((item) => item.number !== null && item.number > 0);
  const saleLine = source.find((line) => /\b(total|price|sale price|now|today|special|current price|add to cart|buy now|queen|king|default title)\b/i.test(line) && extractMoneyValues(line).length) || "";
  const compareLine = source.find((line) => /\bregular price|compare|was|list price|original/i.test(line)) || "";
  const structuredCurrent = structured.offerPrice || structured.metaPrice || structured.shopifyPrice || "";
  if (structuredCurrent) signals.push("structured price");
  const compareValue = structured.compareAtPrice || extractMoneyValues(compareLine)[0] || "";
  if (compareValue) signals.push("compare-at price");
  const salePrices = extractMoneyValues(saleLine)
    .map((value) => ({ value, number: parsePriceNumber(value) }))
    .filter((item) => item.number !== null && item.number > 0);
  const maxSalePrice = salePrices.length ? Math.max(...salePrices.map((item) => item.number)) : 0;
  const saleCurrent = salePrices.length > 1
    ? salePrices
      .filter((item) => item.number < maxSalePrice * 0.99 && item.number > maxSalePrice * 0.2)
      .sort((a, b) => b.number - a.number)[0]
    : salePrices[0];
  if (saleLine) signals.push("sale line");
  const provisionalCurrent = structuredCurrent || (saleCurrent ? saleCurrent.value : "") || "";
  const currentNumber = parsePriceNumber(provisionalCurrent);
  const higherThanCurrent = currentNumber !== null
    ? prices.filter((item) => item.number > currentNumber * 1.03).sort((a, b) => b.number - a.number)[0]
    : null;
  const original = compareValue || (higherThanCurrent ? higherThanCurrent.value : "");
  const originalNumber = parsePriceNumber(original);
  const originalAwareCurrent = !structuredCurrent && originalNumber
    ? prices
      .filter((item) => item.number < originalNumber * 0.99 && item.number > originalNumber * 0.2)
      .sort((a, b) => b.number - a.number)[0]
    : null;
  let current = structuredCurrent || (originalAwareCurrent ? originalAwareCurrent.value : provisionalCurrent) || (prices.length ? prices.reduce((a, b) => (a.number < b.number ? a : b)).value : "");
  const finalCurrentNumber = parsePriceNumber(current);
  const largestPrice = prices.length ? [...prices].sort((a, b) => b.number - a.number)[0] : null;
  if (!structuredCurrent && finalCurrentNumber !== null && finalCurrentNumber < 100 && largestPrice && largestPrice.number > finalCurrentNumber * 10) {
    excluded.push({ text: current, reason: "疑似配件/低价噪音，已用主商品高价替代" });
    const mainSalePrice = prices
      .filter((item) => item.number < largestPrice.number * 0.99 && item.number > largestPrice.number * 0.2)
      .sort((a, b) => b.number - a.number)[0];
    current = (mainSalePrice || largestPrice).value;
    signals.push("low-price guard");
  }
  const savings = uniqueItems([
    ...source.flatMap((line) => line.match(/\bsave\s*(?:up to\s*)?\d{1,2}%/gi) || []),
    ...source.flatMap((line) => line.match(/\bsave\s*[$€£]?\s?\d[\d,]*(?:\.\d{2})?/gi) || []),
    ...source.flatMap((line) => line.match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?\s*off/gi) || []),
    ...source.flatMap((line) => line.match(/\d{1,2}%\s*off/gi) || [])
  ]).filter((line) => !isSitewidePromo(line));
  const cleanSavings = savings.filter((item) => !savings.some((other) => other !== item && other.toLowerCase().startsWith(item.toLowerCase()) && /%/.test(other)));
  if (cleanSavings.length) signals.push("savings detected");
  const confidence = structuredCurrent && current
    ? "high"
    : current && (saleLine || compareValue || prices.length >= 2)
      ? "medium"
      : current
        ? "low"
        : "low";
  return {
    current,
    original: original && original !== current ? original : "",
    savings: cleanSavings.slice(0, 3),
    source: structuredCurrent ? "structured" : "dom-text",
    confidence,
    signals: uniqueItems(signals).slice(0, 6),
    excluded: uniqueItems(excluded.map((item) => `${item.text}|||${item.reason}`))
      .map((item) => {
        const [text, reason] = item.split("|||");
        return { text, reason };
      })
      .slice(0, 8),
    raw: uniqueItems([structuredCurrent, original, ...source.filter((line) => extractMoneyValues(line).length)]).filter(Boolean).slice(0, 5)
  };
}

function productZoneBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => (a.top - b.top) || (b.size - a.size));
  const firstProductIndex = sorted.findIndex((block) => (
    /^h1$/i.test(block.tag) ||
    /\b(add to cart|add to bag|buy now|sale price|regular price|quantity|color|model|variant|specification)\b/i.test(block.text || "")
  ));
  if (firstProductIndex < 0) return sorted.slice(0, 45);
  const startTop = Math.max(0, sorted[firstProductIndex].top - 220);
  return sorted
    .filter((block) => block.top >= startTop && block.top <= startTop + 1150)
    .map((block) => ({ ...block, zone: "product" }))
    .slice(0, 56);
}

function inferPageType({ targetUrl, finalUrl, title, text, structured = {} }) {
  const clean = compactText(text).slice(0, 5000);
  const h1 = (structured.h1 || []).join(" ");
  const urlText = `${targetUrl || ""} ${finalUrl || ""}`.toLowerCase();
  const titleText = String(title || "").toLowerCase();
  const hasPrice = Boolean((structured.offerPrice || structured.metaPrice || structured.shopifyPrice) || extractMoneyValues(clean).length);
  const hasPurchaseCta = (structured.ctaCandidates || []).some((item) => isPurchaseCta(item.text)) || isPurchaseCta(clean);
  const productSignals = [
    /\/(?:products?|p|t)\//i.test(urlText),
    Boolean(structured.productName),
    hasPrice,
    hasPurchaseCta,
    /\b(add to cart|add to bag|select size|select color|quantity|sku|variant)\b/i.test(clean)
  ].filter(Boolean).length;
  if (/\b(access denied|verify|captcha|problem loading|blocked|forbidden|not found|404)\b/i.test(`${titleText} ${h1} ${clean.slice(0, 800)}`)) return "error_or_verification";
  if (productSignals >= 3) return "pdp";
  if (/\b(collection|collections|category|categories|search results|shop all)\b/i.test(`${urlText} ${titleText} ${h1}`)) return "collection";
  if (/\/(?:pages?|landing|lp|campaign|sale)\//i.test(urlText) || /\b(memorial day|black friday|cyber monday|sale|campaign|offer)\b/i.test(`${titleText} ${h1}`)) return "campaign";
  if (/^\/?$/.test((() => { try { return new URL(finalUrl || targetUrl).pathname; } catch (_) { return ""; } })())) return "home";
  return "unknown";
}

function inferFallbackCategory({ title, text, productName, structured = {} }) {
  const source = compactText([
    title,
    productName,
    structured.productName,
    ...(structured.h1 || []),
    ...(structured.h2 || []),
    structured.meta && (structured.meta.description || structured.meta["og:description"])
  ].filter(Boolean).join(" ")).toLowerCase();
  const rules = [
    { pattern: /\b(football|soccer).*\b(shirt|jersey)|\b(shirt|jersey).*\b(football|soccer)\b/, name: "Sportswear > Football Shirt", zh: "运动服饰 / 足球球衣" },
    { pattern: /\b(ebike|e-bike|electric bike|electric trike|trike)\b/, name: "Mobility > Electric Bike", zh: "出行工具 / 电动自行车" },
    { pattern: /\b(breast pump|wearable pump|milk pump)\b/, name: "Mom & Baby > Breast Pump", zh: "母婴用品 / 吸奶器" },
    { pattern: /\b(cleanser|serum|moisturizer|cream|skincare|sunscreen)\b/, name: "Beauty > Skincare", zh: "美妆个护 / 护肤" },
    { pattern: /\b(mattress|pillow|bed frame)\b/, name: "Home > Sleep", zh: "家居睡眠 / 床垫寝具" },
    { pattern: /\b(ring|watch|tracker|smart wearable)\b/, name: "Wearables > Smart Device", zh: "智能穿戴 / 智能设备" },
    { pattern: /\b(phone case|iphone case|case)\b/, name: "Accessories > Phone Case", zh: "数码配件 / 手机壳" },
    { pattern: /\b(wallet|card holder)\b/, name: "Accessories > Wallet", zh: "配饰 / 钱包卡包" },
    { pattern: /\b(shoe|sneaker|runner|loafer|boot)\b/, name: "Footwear", zh: "鞋履" },
    { pattern: /\b(dress|romper|set|top|shirt|hoodie|jacket|pants)\b/, name: "Apparel", zh: "服饰" }
  ];
  const matched = rules.find((rule) => rule.pattern.test(source));
  if (matched) {
    return { name: matched.name, zh: matched.zh, confidence: "medium", reason: "规则命中标题、产品名或描述中的品类关键词" };
  }
  return { name: "Unclassified Product", zh: "未识别品类", confidence: "low", reason: "页面可用的品类信号不足" };
}

function filterEvidenceItems(items, predicate, excluded, bucket) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const text = itemText(item);
    const keep = predicate(text, item);
    if (!keep && text) excluded.push({ bucket, text });
    return keep;
  });
}

function applySmartReview({ targetUrl, finalUrl, title, text, structured, productAnalysis, localizationAnalysis, checks }) {
  const excluded = [];
  const pageType = inferPageType({ targetUrl, finalUrl, title, text, structured });
  const next = { ...productAnalysis };
  if (!next.productCategory || !next.productCategory.name) {
    next.productCategory = inferFallbackCategory({ title, text, productName: next.productName, structured });
  }
  if (!next.competitorSearch || !Array.isArray(next.competitorSearch.queries) || !next.competitorSearch.queries.length) {
    next.competitorSearch = generateFallbackCompetitorSearch({ productAnalysis: next, localizationAnalysis, targetUrl });
  }

  next.sellingPoints = filterEvidenceItems(
    next.sellingPoints,
    (line) => !isSellingPointNoise(line) && !/^\w{1,2}$/.test(String(line || "").trim()),
    excluded,
    "sellingPoints"
  ).slice(0, 6);

  next.trustSignals = filterEvidenceItems(
    next.trustSignals,
    (line) => !/\b(click to scroll|reviews?\s*\(0\)|terms of sale|payment options)\b/i.test(String(line || "")),
    excluded,
    "trustSignals"
  ).slice(0, 6);

  next.callsToAction = filterEvidenceItems(
    next.callsToAction,
    (line) => isPurchaseCta(line) && !isNonPurchaseCta(line),
    excluded,
    "callsToAction"
  ).slice(0, 8);

  const offer = next.offer && typeof next.offer === "object" ? { ...next.offer } : { items: [] };
  offer.items = (Array.isArray(offer.items) ? offer.items : [])
    .map((group) => {
      const type = group.type || "";
      const values = filterEvidenceItems(
        group.values,
        (line) => {
          if (isOfferNoise(line)) return false;
          if (type === "折扣") return /\b(save|off|discount|sale|deal|promo|coupon)\b|[$€£]\s?\d/i.test(String(line || ""));
          if (type === "价格") return extractMoneyValues(line).length > 0 || /\b当前价|划线价|original|regular|price\b/i.test(String(line || ""));
          if (type === "配送") return /\bshipping|delivery|returns?|free delivery|free shipping\b/i.test(String(line || ""));
          if (type === "优惠码") return extractCouponCodes(line).length > 0 || (/^[A-Z0-9][A-Z0-9_-]{3,}$/.test(String(line || "").trim()) && !isOfferNoise(line));
          return true;
        },
        excluded,
        `offer:${type}`
      );
      return { ...group, values };
    })
    .filter((group) => group.values && group.values.length);
  offer.headline = offer.items.length
    ? offer.items.map((item) => `${item.type}：${itemText(item.values[0])}`).join("；")
    : "未识别到明确促销/价格信息";
  next.offer = offer;

  const reviewIssues = [];
  if (pageType !== "pdp" && /\/(?:products?|p|t)\//i.test(String(targetUrl || ""))) {
    reviewIssues.push("输入看起来像 PDP，但页面内容没有足够产品详情信号，可能抓错页或被验证页拦截。");
  }
  if (checks && checks.urlChanged) reviewIssues.push("最终 URL 与输入 URL 不一致，建议人工确认是否跳转到首页/地区页。");
  if (localizationAnalysis && localizationAnalysis.status !== "ok") reviewIssues.push(...(localizationAnalysis.gaps || []).slice(0, 2));
  if (!next.callsToAction.length && pageType === "pdp") reviewIssues.push("PDP 未识别到明确购买 CTA，可能需要选择尺码/规格后才出现，或首屏按钮被遮挡。");

  return {
    productAnalysis: next,
    smartReview: {
      pageType,
      confidence: pageType === "pdp" && next.productName !== "未识别" && next.callsToAction.length ? "high" : "medium",
      issues: uniqueItems(reviewIssues).slice(0, 5),
      excluded: excluded.slice(0, 12)
    }
  };
}

function extractProductAnalysis({ title, text, structured = {}, country }) {
  const clean = compactText(text);
  const lines = splitUsefulLines(clean);
  const visibleBlocks = Array.isArray(structured.visibleBlocks) ? structured.visibleBlocks : [];
  const productBlocks = productZoneBlocks(visibleBlocks);
  const evidenceBlocks = [...productBlocks, ...visibleBlocks];
  const visibleLines = productBlocks.map((block) => block.text).filter(Boolean);
  const headingLines = uniqueItems([
    ...(structured.h1 || []),
    ...(structured.h2 || []),
    ...(structured.h3 || []),
    ...visibleBlocks.filter((block) => /^h[1-3]$/i.test(block.tag)).map((block) => block.text)
  ]).filter((line) => line.length <= 120);
  const meta = structured.meta || {};
  const description = meta.description || meta["og:description"] || meta["twitter:description"] || "";
  const nameCandidates = uniqueItems([
    structured.productName,
    ...(structured.h1 || []),
    structured.urlProductName,
    meta["og:title"],
    meta["twitter:title"],
    title
  ].filter(Boolean).map(cleanTitle)).filter((item) => item.length >= 2 && item.length <= 90 && !isGenericName(item));
  const productName = nameCandidates[0] || cleanTitle(title) || "未识别";

  const signalSource = uniqueItems([...visibleLines, ...headingLines, ...lines])
    .filter((line) => !isRecommendationLine(line));
  const commerceLines = signalSource.filter((line) => (
    /[$€£]\s?\d|\d+(?:[.,]\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)|%|off|save|discount|sale|coupon|code|free shipping|limited|deal|buy\s+\d+/i.test(line)
  ));
  const sellingPoints = extractSellingPointEvidence({
    headingLines,
    visibleLines,
    lines,
    blocks: evidenceBlocks,
    description,
    productName
  });

  const discountLineTexts = uniqueItems([
    ...commerceLines.filter((line) => /\b(?:up to\s*)?\d{1,2}%\s*(?:off|discount)\b|\bsave\s*(?:up to\s*)?\d{1,2}%\b/i.test(line)),
    ...commerceLines.filter((line) => /\bsale\b|\bdiscount\b|\bsave\s*[$€£]?\s?\d|\b[$€£]\s?\d+(?:[.,]\d{2})?\s*(?:off)\b|\b\d{1,2}%\s*off\b/i.test(line))
  ])
    .filter((line) => !/\b\d{1,3}%\s+(assembled|cotton|polyester|battery|charge|waterproof)\b/i.test(line))
    .filter((line) => !/^(sale|sale price|regular price|save|free)$/i.test(line.trim()))
    .filter((line) => !/\bservice after the sale\b/i.test(line))
    .filter((line) => !isSitewidePromo(line))
    .filter((line) => !isRecommendationLine(line))
    .filter(isProductOfferLine)
    .slice(0, 4);
  const discountLines = evidenceList(discountLineTexts, evidenceBlocks, "促销关键词命中");
  const priceInfo = extractPriceInfo(commerceLines, structured);
  const priceLineTexts = uniqueItems(commerceLines.filter((line) => /[$€£]\s?\d|\d+(?:[.,]\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)/i.test(line)))
    .filter((line) => !isSitewidePromo(line))
    .filter((line) => !isRecommendationLine(line))
    .filter(isProductOfferLine)
    .slice(0, 4);
  const priceLines = evidenceList(priceLineTexts, evidenceBlocks, "价格文本命中");
  const shippingLines = evidenceList(pickNearbyLines(signalSource, /\bfree\s+shipping|shipping\s+free|free delivery|livraison gratuite\b/i, 4), evidenceBlocks, "配送信息命中");
  const couponTexts = uniqueItems(signalSource
    .filter((line) => !isSitewidePromo(line))
    .flatMap((line) => extractCouponCodes(line)))
    .slice(0, 4);
  const couponLines = evidenceList(couponTexts, evidenceBlocks, "优惠码关键词命中");
  const urgencyLines = evidenceList(pickNearbyLines(signalSource, /\blimited\s+time|today only|last chance|ends soon|while supplies last|flash sale|hurry\b/i, 4), evidenceBlocks, "限时关键词命中");
  const bundleLines = evidenceList(pickNearbyLines(signalSource, /\bbuy\s+\d+\s+get\s+\d+|bogo|bundle|free gift|gift with|赠品\b/i, 4), evidenceBlocks, "买赠/套装关键词命中");
  const trustLines = evidenceList(pickNearbyLines(signalSource, /\breview|rated|stars?|customer|guarantee|warranty|secure|money back|return|certified|clinically|doctor|trusted\b/i, 6), evidenceBlocks, "信任背书关键词命中");
  const ctaCandidateLines = uniqueItems([
    ...(structured.ctaCandidates || []).map((item) => item.text),
    ...(structured.primaryCta ? [structured.primaryCta.text] : []),
    ...(structured.buttons || []),
    ...signalSource.filter((line) => /\bshop now|buy now|buy with|add to cart|add to bag|get now|order now|claim|subscribe|sign up|start now|select options|learn more|copy code|get code\b/i.test(line))
  ])
    .filter((line) => !/^(×|x|close|accept|decline|zoom|－|-|\+|click to expand the video|open navigation menu|shop all trikes|shop all accessories|shop replacement parts|about us)$/i.test(line.trim()))
    .filter((line) => /\b(shop now|buy now|buy with|add to cart|add to bag|get now|order now|claim|start now|checkout|select options|learn more|view details|choose options|copy code|get code|subscribe|sign up)\b/i.test(line))
    .filter((line) => !/\b(sign up|subscribe|email only deals|newsletter|interest-free|as low as|affirm|klarna|afterpay|sleep study)\b/i.test(line))
    .slice(0, 12);
  const ctaLines = evidenceList(ctaCandidateLines, evidenceBlocks, structured.primaryCta ? "可见按钮，按位置/面积排序" : "CTA 文案命中")
    .map((item) => {
      const matched = (structured.ctaCandidates || []).find((candidate) => candidate.text === item.text);
      return {
        ...item,
        actionType: matched ? matched.actionType : /\b(add to cart|add to bag|buy now|buy with|checkout|order now)\b/i.test(item.text) ? "purchase" : "info",
        confidence: matched && matched.score >= 88 ? "high" : item.confidence
      };
    });

  const offerItems = [];
  if (discountLines.length) offerItems.push({ type: "折扣", values: discountLines });
  if (priceInfo.current || priceInfo.original || priceInfo.savings.length) {
    const values = [
      priceInfo.current ? evidenceForLine(`当前价 ${priceInfo.current}`, evidenceBlocks, priceInfo.source === "structured" ? "结构化价格" : "价格文本") : "",
      priceInfo.original ? evidenceForLine(`划线价 ${priceInfo.original}`, evidenceBlocks, priceInfo.source === "structured" ? "结构化划线价" : "价格文本") : "",
      ...priceInfo.savings.map((line) => evidenceForLine(line, evidenceBlocks, "优惠金额/折扣"))
    ].filter(Boolean);
    offerItems.push({ type: "价格", values });
  } else if (priceLines.length) {
    offerItems.push({ type: "价格", values: priceLines });
  }
  if (shippingLines.length) offerItems.push({ type: "配送", values: shippingLines });
  if (couponLines.length) offerItems.push({ type: "优惠码", values: couponLines });
  if (bundleLines.length) offerItems.push({ type: "买赠/套装", values: bundleLines });
  if (urgencyLines.length) offerItems.push({ type: "限时", values: urgencyLines });

  const summaryParts = [];
  summaryParts.push(productName !== "未识别" ? `页面主推产品是「${productName}」` : "页面产品名不够明确");
  if (sellingPoints.length) summaryParts.push(`核心卖点集中在「${sellingPoints.slice(0, 2).map(itemText).join(" / ")}」`);
  if (discountLines[0]) summaryParts.push(`主要促销信号是「${itemText(discountLines[0])}」`);
  else if (priceLines[0]) summaryParts.push(`页面出现价格信号「${itemText(priceLines[0])}」`);
  else summaryParts.push("页面未识别到强促销信号");

  const gaps = [];
  if (!sellingPoints.length) gaps.push("卖点表达不够集中，建议在首屏或标题区补充 2-3 个明确利益点。");
  if (!offerItems.length) gaps.push("促销/价格信息不明显，如果页面有活动，建议放在首屏或购买按钮附近。");
  if (!trustLines.length) gaps.push("信任背书较弱，可补充评价、保障、退换或安全支付信息。");
  if (!ctaLines.length) gaps.push("CTA 不明显，建议确保首屏有购买/领取类按钮。");

  return {
    productName,
    urlProductName: structured.urlProductName || "",
    pageTitle: title || "",
    description,
    summary: summaryParts.join("；") + "。",
    positioning: evidenceList(headingLines.slice(0, 4), evidenceBlocks, "标题层级"),
    sellingPoints,
    offer: {
      headline: offerItems.length
        ? offerItems.map((item) => `${item.type}：${itemText(item.values[0])}`).join("；")
        : "未识别到明确促销/价格信息",
      items: offerItems,
      price: priceInfo
    },
    trustSignals: trustLines,
    callsToAction: ctaLines,
    gaps,
    zones: {
      firstScreenSignals: evidenceList(visibleBlocks.filter((block) => block.inViewport).map((block) => block.text).slice(0, 10), visibleBlocks, "首屏可见"),
      productZoneSignals: evidenceList(productBlocks.map((block) => block.text).slice(0, 10), productBlocks, "产品区可见")
    },
    competitorSearch: null,
    confidence: [productName !== "未识别", sellingPoints.length > 0, offerItems.length > 0, headingLines.length > 0].filter(Boolean).length >= 3 ? "high" : "medium",
    country
  };
}

function extractPromoSummary(text) {
  const analysis = extractProductAnalysis({ title: "", text, structured: {}, country: "" });
  return {
    headline: analysis.offer.headline,
    items: analysis.offer.items,
    confidence: analysis.offer.items.length >= 3 ? "high" : analysis.offer.items.length ? "medium" : "low"
  };
}

function compactLinesForAi(lines, limit = 70) {
  return uniqueItems((lines || [])
    .map(itemText)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 220))
    .slice(0, limit);
}

function asPlainList(items, limit = 10) {
  return compactLinesForAi(Array.isArray(items) ? items : [], limit);
}

function normalizeAiTextItems(items, limit = 12) {
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = item && typeof item === "object" ? item.text : item;
    const zh = item && typeof item === "object" ? item.zh : "";
    const cleanText = String(text || "").replace(/\s+/g, " ").trim();
    const cleanZh = String(zh || "").replace(/\s+/g, " ").trim();
    if (!cleanText || seen.has(cleanText.toLowerCase())) continue;
    seen.add(cleanText.toLowerCase());
    normalized.push({ text: cleanText, zh: cleanZh });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function brandFromUrl(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host.split(".")[0].replace(/[^a-z0-9]+/gi, " ").trim();
  } catch (_) {
    return "";
  }
}

function normalizeSearchQuery(query) {
  return String(query || "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/g, " -")
    .trim();
}

function generateFallbackCompetitorSearch({ productAnalysis, localizationAnalysis, targetUrl }) {
  const category = productAnalysis && productAnalysis.productCategory && productAnalysis.productCategory.name
    ? productAnalysis.productCategory.name.replace(/>/g, " ").replace(/\s+/g, " ").trim()
    : "product";
  const productName = productAnalysis && productAnalysis.productName && productAnalysis.productName !== "未识别"
    ? productAnalysis.productName
    : category;
  const market = localizationAnalysis && localizationAnalysis.market ? localizationAnalysis.market : "target market";
  const brand = brandFromUrl(targetUrl);
  const sellingSeeds = asPlainList(productAnalysis && productAnalysis.sellingPoints, 3)
    .map((item) => item.replace(/[^A-Za-z0-9 +&-]/g, " ").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 4)
    .slice(0, 2);
  const baseQueries = [
    `${market} ${category} competitors`,
    `${market} ${category} alternatives`,
    `${productName} alternative ${market}`,
    `${category} best sellers ${market}`,
    `${category} price comparison ${market}`
  ];
  if (sellingSeeds[0]) baseQueries.push(`${market} ${category} ${sellingSeeds[0]}`);
  const queries = uniqueItems(baseQueries.map(normalizeSearchQuery).filter(Boolean))
    .map((query) => ({
      query: brand ? `${query} -${brand}` : query,
      zh: "找同市场同品类竞品"
    }))
    .slice(0, 6);
  return {
    queries,
    seedKeywords: uniqueItems([category, productName, ...sellingSeeds].filter(Boolean)).slice(0, 8),
    source: "rule-fallback"
  };
}


function hostFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function pathnameFromUrl(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function isSameOrSubdomain(host, baseHost) {
  if (!host || !baseHost) return false;
  return host === baseHost || host.endsWith(`.${baseHost}`);
}

function classifyCompetitorUrl(url, title = "") {
  const path = pathnameFromUrl(url);
  const text = `${url} ${title}`.toLowerCase();
  if (!path || path === "/") return "brand";
  if (/\b(blog|article|news|guide|review|reviews|essay|analysis|target-market|competitor-analysis)\b/i.test(text)) return "content";
  if (/\/(collections?|categories?|category|search|pages?|blogs?|news|account|cart|checkout)(\/|$)/i.test(path)) return "category";
  if (/\/(products?|product|p|item|sku|shop|store)\//i.test(path)) return "pdp";
  if (/\/t\/[^/]+\/[a-z0-9-]{5,}$/i.test(path)) return "pdp";
  if (/\/[a-z0-9][a-z0-9-]{18,}(?:\.html?)?$/i.test(path) && /shirt|jersey|dress|pump|bike|trike|shoe|bag|watch|hoodie|top|pants|sneaker|product/i.test(text)) return "pdp";
  return "other";
}

function competitorProductSearchTerms({ productAnalysis = {}, localizationAnalysis = {} }) {
  const category = productAnalysis.productCategory && (productAnalysis.productCategory.name || productAnalysis.productCategory.zh)
    ? String(productAnalysis.productCategory.name || productAnalysis.productCategory.zh).replace(/>/g, " ")
    : "";
  const productName = productAnalysis.productName && productAnalysis.productName !== "未识别" ? productAnalysis.productName : "";
  const market = localizationAnalysis.market || localizationAnalysis.country || "";
  const seeds = productAnalysis.competitorSearch && Array.isArray(productAnalysis.competitorSearch.seedKeywords)
    ? productAnalysis.competitorSearch.seedKeywords
    : [];
  return uniqueItems([productName, category, ...seeds, market]
    .map((item) => String(item || "").replace(/[^A-Za-z0-9 $&+/-]/g, " ").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 4))
    .slice(0, 4)
    .join(" ");
}

function competitorResultScore(result, query, sourceHost) {
  const title = String(result.title || "");
  const url = String(result.url || "");
  const content = String(result.content || "");
  const host = hostFromUrl(url);
  if (!host || isSameOrSubdomain(host, sourceHost)) return -100;
  if (/google|bing|pinterest|facebook|instagram|youtube|reddit|tiktok/i.test(host)) return -100;
  let score = Number(result.score || 0) * 100;
  const matchType = classifyCompetitorUrl(url, title);
  if (matchType === "pdp") score += 55;
  if (matchType === "category") score += 10;
  if (matchType === "brand") score -= 45;
  if (matchType === "content") score -= 80;
  const haystack = `${title} ${content} ${url}`.toLowerCase();
  for (const token of String(query || "").toLowerCase().split(/\s+/).filter((item) => item.length >= 4).slice(0, 8)) {
    if (haystack.includes(token)) score += 4;
  }
  return score;
}

function normalizeCompetitorQueries(body) {
  const direct = Array.isArray(body.queries) ? body.queries : [];
  const fromAnalysis = body.productAnalysis && body.productAnalysis.competitorSearch && Array.isArray(body.productAnalysis.competitorSearch.queries)
    ? body.productAnalysis.competitorSearch.queries
    : [];
  const generated = fromAnalysis.length ? fromAnalysis : generateFallbackCompetitorSearch({
    productAnalysis: body.productAnalysis || {},
    localizationAnalysis: body.localizationAnalysis || {},
    targetUrl: body.url || body.targetUrl || ""
  }).queries;
  const source = direct.length ? direct : generated;
  return uniqueItems(source
    .map((item) => (item && typeof item === "object" ? item.query || item.text : item))
    .map(normalizeSearchQuery)
    .filter(Boolean)
    .filter((query) => !/^target market product\b/i.test(query)))
    .slice(0, 3);
}

async function tavilySearchRequest({ key, query, searchDepth, maxResults }) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      search_depth: searchDepth,
      topic: "general",
      max_results: maxResults,
      include_answer: false,
      include_images: false,
      include_raw_content: false
    })
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text.slice(0, 240));
    error.status = response.status;
    throw error;
  }
  return JSON.parse(text);
}

function pushCompetitorResults({ target, items, query, sourceHost }) {
  for (const item of Array.isArray(items) ? items : []) {
    const host = hostFromUrl(item.url);
    const matchType = classifyCompetitorUrl(item.url, item.title);
    const score = competitorResultScore(item, query, sourceHost);
    if (score <= 0) continue;
    target.push({
      title: String(item.title || host || item.url || "Untitled").replace(/\s+/g, " ").trim(),
      url: item.url,
      domain: host,
      snippet: String(item.content || "").replace(/\s+/g, " ").trim().slice(0, 260),
      query,
      matchType,
      isPdp: matchType === "pdp",
      score: Math.round(score)
    });
  }
}

function competitorSearchCacheKey({ targetUrl, queries, deep, productAnalysis = {}, localizationAnalysis = {} }) {
  const sourceHost = hostFromUrl(targetUrl);
  const productName = productAnalysis.productName || "";
  const category = productAnalysis.productCategory && (productAnalysis.productCategory.name || productAnalysis.productCategory.zh || "");
  const market = localizationAnalysis.market || localizationAnalysis.country || "";
  const queryScope = (Array.isArray(queries) ? queries : []).slice(0, deep ? 3 : 1);
  return JSON.stringify({ sourceHost, productName, category, market, queryScope, deep: Boolean(deep) });
}

function getCachedCompetitorSearch(cacheKey) {
  const cached = COMPETITOR_SEARCH_CACHE.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > COMPETITOR_CACHE_TTL_MS) {
    COMPETITOR_SEARCH_CACHE.delete(cacheKey);
    return null;
  }
  return { ...cached.value, cached: true, cacheTtlMinutes: Math.round(COMPETITOR_CACHE_TTL_MS / 60000) };
}

function setCachedCompetitorSearch(cacheKey, value) {
  if (COMPETITOR_SEARCH_CACHE.size > 80) {
    const oldestKey = COMPETITOR_SEARCH_CACHE.keys().next().value;
    if (oldestKey) COMPETITOR_SEARCH_CACHE.delete(oldestKey);
  }
  COMPETITOR_SEARCH_CACHE.set(cacheKey, { createdAt: Date.now(), value: { ...value, cached: false } });
}

async function searchCompetitorsWithTavily({ queries, targetUrl, productAnalysis = {}, localizationAnalysis = {}, deep = false }) {
  const key = process.env.TAVILY_API_KEY;
  if (!key || /粘贴|your_|^\s*$|YOUR_TAVILY_API_KEY/i.test(key)) {
    return { ok: false, skipped: true, reason: "TAVILY_API_KEY is not configured.", provider: "tavily" };
  }
  const normalizedQueries = uniqueItems((Array.isArray(queries) ? queries : []).map(normalizeSearchQuery).filter(Boolean));
  const cacheKey = competitorSearchCacheKey({ targetUrl, queries: normalizedQueries, deep, productAnalysis, localizationAnalysis });
  const cached = getCachedCompetitorSearch(cacheKey);
  if (cached) return cached;

  const sourceHost = hostFromUrl(targetUrl);
  const searchDepth = process.env.TAVILY_SEARCH_DEPTH || "basic";
  const maxResults = Math.min(Math.max(Number(process.env.TAVILY_MAX_RESULTS || 6), 3), 10);
  const initialQueries = normalizedQueries.slice(0, deep ? 3 : 1);
  const maxDrillDomains = Math.min(Math.max(Number(process.env.TAVILY_MAX_DRILL_DOMAINS || 3), 1), 3);
  const all = [];
  const errors = [];
  const usedQueries = [];
  let actualSearchCalls = 0;

  for (const query of initialQueries) {
    try {
      usedQueries.push(query);
      actualSearchCalls += 1;
      const data = await tavilySearchRequest({ key, query, searchDepth, maxResults });
      pushCompetitorResults({ target: all, items: data.results, query, sourceHost });
    } catch (error) {
      errors.push({ query, status: error.status, reason: error.message });
    }
  }

  const productTerms = competitorProductSearchTerms({ productAnalysis, localizationAnalysis });
  const candidateDomains = deep && productTerms ? uniqueItems(all
    .filter((item) => item.domain && !item.isPdp && item.matchType !== "content")
    .sort((a, b) => b.score - a.score)
    .map((item) => item.domain))
    .slice(0, maxDrillDomains) : [];

  for (const domain of candidateDomains) {
    const query = `site:${domain} ${productTerms}`;
    try {
      usedQueries.push(query);
      actualSearchCalls += 1;
      const data = await tavilySearchRequest({ key, query, searchDepth, maxResults: 3 });
      pushCompetitorResults({ target: all, items: data.results, query, sourceHost });
    } catch (error) {
      errors.push({ query, status: error.status, reason: error.message });
    }
  }

  const seenUrls = new Set();
  const deduped = all
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = String(item.url || "").replace(/[?#].*$/, "");
      if (!key || seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });
  const pdpResults = deduped.filter((item) => item.isPdp).slice(0, 8);
  const fallbackResults = deduped.filter((item) => !item.isPdp && item.matchType !== "content").slice(0, 4);
  const results = pdpResults.length ? pdpResults : fallbackResults;
  const canDeepSearch = !deep && Boolean(productTerms) && (pdpResults.length < 3 || results.some((item) => !item.isPdp));
  const response = {
    ok: results.length > 0,
    provider: "tavily",
    searchDepth,
    maxResults,
    mode: pdpResults.length ? "pdp" : "fallback",
    deep: Boolean(deep),
    cached: false,
    estimatedCredits: deep ? Math.max(1, actualSearchCalls) : 1,
    actualSearchCalls,
    queriesUsed: usedQueries.slice(0, 8),
    results,
    canDeepSearch,
    deepSearchHint: canDeepSearch ? "默认省钱模式只搜索 1 次；需要更多 PDP 链接时，可手动追加下钻。" : "",
    errors: errors.slice(0, 4),
    reason: results.length ? "" : errors[0] ? errors[0].reason : "No competitor PDP results found."
  };
  setCachedCompetitorSearch(cacheKey, response);
  return response;
}

async function handleCompetitorSearch(req, res) {
  try {
    const auth = await requireApiAuth(req, res);
    if (!auth) return;
    const body = await parseBody(req);
    const targetUrl = String(body.url || body.targetUrl || "").trim();
    const queries = normalizeCompetitorQueries(body);
    if (!queries.length) {
      return jsonResponse(res, 400, { error: "No competitor search queries available." });
    }
    const deep = Boolean(body.deep || body.downDrill || body.drillDown);
    const search = await searchCompetitorsWithTavily({
      queries,
      targetUrl,
      productAnalysis: body.productAnalysis || {},
      localizationAnalysis: body.localizationAnalysis || {},
      deep
    });
    jsonResponse(res, 200, search);
  } catch (error) {
    jsonResponse(res, 500, { error: error.message });
  }
}

function parseJsonFromModel(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  }
}

function buildAiInput({ targetUrl, finalUrl, title, productAnalysis, localizationAnalysis, structured, keywordResults }) {
  const visibleBlocks = Array.isArray(structured.visibleBlocks) ? structured.visibleBlocks : [];
  const productBlocks = productZoneBlocks(visibleBlocks);
  const meta = structured.meta || {};
  return {
    url: targetUrl,
    finalUrl,
    title,
    country: productAnalysis.country,
    currentRuleAnalysis: {
      productName: productAnalysis.productName,
      summary: productAnalysis.summary,
      description: productAnalysis.description,
      positioning: asPlainList(productAnalysis.positioning, 8),
      sellingPoints: asPlainList(productAnalysis.sellingPoints, 10),
      offerHeadline: productAnalysis.offer && productAnalysis.offer.headline,
      offerGroups: productAnalysis.offer && Array.isArray(productAnalysis.offer.items)
        ? productAnalysis.offer.items.map((group) => ({ type: group.type, values: asPlainList(group.values, 8) }))
        : [],
      price: productAnalysis.offer && productAnalysis.offer.price,
      trustSignals: asPlainList(productAnalysis.trustSignals, 10),
      callsToAction: asPlainList(productAnalysis.callsToAction, 14),
      gaps: asPlainList(productAnalysis.gaps, 8),
      productCategory: productAnalysis.productCategory || null
    },
    sourceSignals: {
      meta: {
        description: meta.description || "",
        ogTitle: meta["og:title"] || "",
        ogDescription: meta["og:description"] || "",
        productPrice: meta["product:price:amount"] || meta["og:price:amount"] || "",
        productCurrency: meta["product:price:currency"] || meta["og:price:currency"] || ""
      },
      h1: structured.h1 || [],
      h2: structured.h2 || [],
      h3: structured.h3 || [],
      ctaCandidates: (structured.ctaCandidates || []).slice(0, 14).map((item) => ({
        text: item.text,
        actionType: item.actionType,
        inViewport: item.inViewport,
        score: item.score
      })),
      firstScreenText: compactLinesForAi(visibleBlocks.filter((block) => block.inViewport).map((block) => block.text), 35),
      productAreaText: compactLinesForAi(productBlocks.map((block) => block.text), 45),
      localizationGaps: localizationAnalysis ? localizationAnalysis.gaps || [] : [],
      keywordResults: keywordResults || []
    }
  };
}

async function callDeepSeekJson(payload) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || /粘贴|your_/i.test(key)) {
    return { ok: false, skipped: true, reason: "DEEPSEEK_API_KEY is not configured." };
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const controller = new AbortController();
  const aiTimeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 18000);
  const timer = setTimeout(() => controller.abort(), Number.isFinite(aiTimeoutMs) ? aiTimeoutMs : 18000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 1800,
        messages: [
          {
            role: "system",
            content: [
              "你是一个电商落地页分析器，只能根据用户提供的 evidence JSON 分析。",
              "不要编造页面没有出现的信息。不要做全文翻译，产品名、卖点、CTA、价格、信任背书尽量保留原网页语言。",
              "只输出合法 JSON，不要 Markdown。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              "请基于下面的抓取证据，修正和增强落地页产品分析。必须输出一个合法 JSON object。",
              "输出 schema：",
              "{",
              "  \"productName\": \"string\",",
              "  \"summary\": \"中文一句话，总结主推产品、核心卖点、主要促销；可以引用原文短语\",",
              "  \"description\": \"string，保留或浓缩原网页语言，不要乱翻译\",",
              "  \"category\": {\"name\":\"English category path\",\"zh\":\"中文品类\",\"confidence\":\"high|medium|low\",\"reason\":\"中文短理由\"},",
              "  \"positioning\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "  \"sellingPoints\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "  \"offer\": {",
              "    \"headline\": \"string\",",
              "    \"discounts\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "    \"prices\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "    \"shipping\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "    \"coupons\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}]",
              "  },",
              "  \"trustSignals\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "  \"callsToAction\": [{\"text\":\"string\",\"zh\":\"中文短解释\"}],",
              "  \"competitorSearch\": {\"queries\":[{\"query\":\"string\",\"zh\":\"中文搜索意图\"}],\"seedKeywords\":[\"string\"]},",
              "  \"gaps\": [\"string\"],",
              "  \"confidence\": \"high|medium|low\"",
              "}",
              "要求：",
              "1. sellingPoints 只放产品真实卖点，不要放评论、售后、免邮、折扣、导航。",
              "2. callsToAction 要尽量列出购买/选择/结账相关按钮，排除 newsletter、subscribe、弹窗领取码。",
              "3. offer 只放与当前 PDP/落地页主商品相关的信息，排除站外推荐、配件、博客和弹窗首单券，除非它明显是主活动。",
              "4. coupons 只输出真实优惠码本体，如 DLYUS10；不要输出 Copy Code、Get Code、Code、Coupon。",
              "5. category 要尽量具体，例如 Sportswear > Football Shirt，不要只写 Apparel。",
              "6. zh 是给中国投放/运营同事看的短解释，不要全文翻译；最多 22 个中文字。",
              "7. competitorSearch 输出 4-6 条用于找同市场竞品的搜索词，不要输出 URL；尽量包含市场、具体品类、核心规格，排除当前品牌/域名。",
              "8. gaps 用中文写，最多 4 条。",
              "",
              JSON.stringify(payload)
            ].join("\n")
          }
        ]
      })
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, reason: text.slice(0, 500), model };
    }
    const data = JSON.parse(text);
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    const parsed = parseJsonFromModel(content);
    if (!parsed) {
      return { ok: false, status: response.status, reason: "Model did not return valid JSON.", model };
    }
    return { ok: true, data: parsed, model, usage: data.usage || null };
  } catch (error) {
    return { ok: false, reason: error.name === "AbortError" ? "DeepSeek request timed out." : error.message, model };
  } finally {
    clearTimeout(timer);
  }
}

function stringsToEvidence(items, reason = "AI 结构化复核") {
  return normalizeAiTextItems(items, 12).map((item) => ({
    text: item.text,
    zh: item.zh,
    source: "AI 复核",
    confidence: "medium",
    reason
  }));
}

function mergeAiProductAnalysis(baseAnalysis, aiResult) {
  if (!aiResult || !aiResult.ok || !aiResult.data) return baseAnalysis;
  const ai = aiResult.data;
  const next = {
    ...baseAnalysis,
    aiEnhanced: true,
    aiModel: aiResult.model || "",
    confidence: ai.confidence || baseAnalysis.confidence
  };
  if (typeof ai.productName === "string" && ai.productName.trim().length >= 2) next.productName = ai.productName.trim();
  if (typeof ai.summary === "string" && ai.summary.trim().length >= 8) next.summary = ai.summary.trim();
  if (typeof ai.description === "string" && ai.description.trim().length >= 8) next.description = ai.description.trim();
  if (ai.category && typeof ai.category === "object") {
    const name = String(ai.category.name || "").replace(/\s+/g, " ").trim();
    if (name) {
      next.productCategory = {
        name,
        zh: String(ai.category.zh || "").replace(/\s+/g, " ").trim(),
        confidence: /^(high|medium|low)$/i.test(String(ai.category.confidence || "")) ? String(ai.category.confidence).toLowerCase() : "medium",
        reason: String(ai.category.reason || "").replace(/\s+/g, " ").trim()
      };
    }
  }
  if (Array.isArray(ai.positioning) && ai.positioning.length) next.positioning = stringsToEvidence(ai.positioning, "AI 页面定位复核");
  if (Array.isArray(ai.sellingPoints) && ai.sellingPoints.length) next.sellingPoints = stringsToEvidence(ai.sellingPoints, "AI 卖点复核");
  if (Array.isArray(ai.trustSignals) && ai.trustSignals.length) next.trustSignals = stringsToEvidence(ai.trustSignals, "AI 信任信号复核");
  if (Array.isArray(ai.callsToAction) && ai.callsToAction.length) next.callsToAction = stringsToEvidence(ai.callsToAction, "AI CTA 复核");
  if (Array.isArray(ai.gaps) && ai.gaps.length && Array.isArray(baseAnalysis.gaps) && baseAnalysis.gaps.length) {
    next.gaps = asPlainList(ai.gaps, 4);
  }
  if (ai.competitorSearch && typeof ai.competitorSearch === "object") {
    const queries = normalizeAiTextItems(
      (ai.competitorSearch.queries || []).map((item) => (
        item && typeof item === "object" ? { text: item.query || item.text, zh: item.zh } : item
      )),
      8
    ).map((item) => ({ query: item.text, zh: item.zh }));
    const seedKeywords = asPlainList(ai.competitorSearch.seedKeywords || [], 8);
    if (queries.length || seedKeywords.length) {
      next.competitorSearch = { queries, seedKeywords, source: "ai" };
    }
  }

  const offer = ai.offer && typeof ai.offer === "object" ? ai.offer : {};
  const offerItems = [];
  const offerGroups = [
    ["折扣", offer.discounts],
    ["价格", offer.prices],
    ["配送", offer.shipping],
    ["优惠码", offer.coupons]
  ];
  for (const [type, values] of offerGroups) {
    const list = stringsToEvidence(values, `AI ${type}复核`);
    if (list.length) offerItems.push({ type, values: list });
  }
  if (offerItems.length) {
    next.offer = {
      ...(baseAnalysis.offer || {}),
      headline: typeof offer.headline === "string" && offer.headline.trim()
        ? offer.headline.trim()
        : offerItems.map((item) => `${item.type}：${itemText(item.values[0])}`).join("；"),
      items: offerItems,
      price: baseAnalysis.offer ? baseAnalysis.offer.price : {}
    };
  }
  return next;
}

async function enhanceProductAnalysisWithAi({ targetUrl, finalUrl, title, productAnalysis, localizationAnalysis, structured, keywordResults }) {
  const payload = buildAiInput({ targetUrl, finalUrl, title, productAnalysis, localizationAnalysis, structured, keywordResults });
  const aiResult = await callDeepSeekJson(payload);
  return {
    productAnalysis: mergeAiProductAnalysis(productAnalysis, aiResult),
    aiAnalysis: {
      enabled: Boolean(process.env.DEEPSEEK_API_KEY && !/粘贴|your_/i.test(process.env.DEEPSEEK_API_KEY)),
      ok: Boolean(aiResult.ok),
      skipped: Boolean(aiResult.skipped),
      model: aiResult.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      reason: aiResult.ok ? "" : aiResult.reason || "",
      usage: aiResult.usage || null
    }
  };
}

function extractLocalizationAnalysis(text, country, structured = {}) {
  const rules = countryRules(country);
  const clean = compactText(text);
  const lower = clean.toLowerCase();
  const currencyMatched = rules.currency.some((currency) => textIncludes(clean, currency));
  const chineseSnippets = extractChineseSnippets(clean, structured);
  const hasChinese = chineseSnippets.length > 0;
  const shippingMentioned = /\bshipping|delivery|deliver|returns?|refund|exchange|free shipping|tracking\b/i.test(clean);
  const privacyMentioned = /\bprivacy|cookie|gdpr|consent|terms|data protection|ccpa\b/i.test(clean);
  const localSignals = [];
  if (currencyMatched) localSignals.push(`货币匹配 ${rules.currency.join(" / ")}`);
  if (shippingMentioned) localSignals.push("出现配送/退换相关信息");
  if (privacyMentioned) localSignals.push("出现隐私/Cookie/条款相关信息");
  if (!hasChinese) localSignals.push("未发现中文残留");

  const gaps = [];
  if (!currencyMatched) gaps.push(`未识别到 ${rules.market} 常用货币：${rules.currency.join(" / ")}。`);
  if (hasChinese) gaps.push(`页面存在中文残留：${chineseSnippets.slice(0, 3).join(" / ")}。`);
  if (!shippingMentioned) gaps.push("未识别到配送、退换或退款说明。");
  if (rules.privacy === "gdpr" && !privacyMentioned) gaps.push("目标国家属于 GDPR/Cookie 敏感市场，未识别到隐私或 Cookie 提示。");

  return {
    country,
    market: rules.market,
    locale: rules.locale,
    expectedCurrency: rules.currency,
    expectedLanguage: rules.languageHint,
    currencyMatched,
    hasChinese,
    chineseSnippets,
    shippingMentioned,
    privacyMentioned,
    localSignals,
    gaps,
    status: gaps.length ? "needs_review" : "ok"
  };
}

async function dismissPopups(page) {
  const clicked = [];
  const selectors = [
    "button[aria-label*='close' i]",
    "button[title*='close' i]",
    "[role='button'][aria-label*='close' i]",
    ".close",
    ".close-button",
    ".modal-close",
    ".popup-close",
    ".newsletter-close",
    ".klaviyo-close-form",
    "[class*='close' i]",
    "text=/^\\s*(×|x|no thanks|not now|maybe later|skip|close)\\s*$/i"
  ];

  for (const selector of selectors) {
    for (let i = 0; i < 3; i += 1) {
      const locator = page.locator(selector).first();
      const didClick = await locator.click({ timeout: 700, force: true }).then(() => true).catch(() => false);
      if (!didClick) break;
      clicked.push(selector);
      await page.waitForTimeout(250).catch(() => {});
    }
  }

  const removed = await page.evaluate(() => {
    const viewportArea = window.innerWidth * window.innerHeight;
    const popupTextPattern = /subscribe|sign up|email|discount|coupon|unlock|first order|newsletter|sms|spin|wheel|save\s+\d+%|memorial day|sale|savings|continue/i;
    let count = 0;
    Array.from(document.querySelectorAll("button,a,span,div")).forEach((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      if (/^(×|x|close|no thanks|not now|maybe later|skip|continue)$/i.test(text)) {
        try { el.click(); count += 1; } catch (_) {}
      }
    });
    Array.from(document.body.querySelectorAll("*")).forEach((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      const fixed = style.position === "fixed" || style.position === "sticky";
      const highZ = Number.parseInt(style.zIndex, 10) >= 100 || style.zIndex === "auto";
      const coversScreen = area > viewportArea * 0.03 && rect.width > window.innerWidth * 0.35;
      const text = (el.innerText || el.textContent || "").slice(0, 500);
      const marker = `${el.className || ""} ${el.id || ""}`;
      const looksLikePopup = popupTextPattern.test(text) || /modal|popup|newsletter|drawer|overlay|klaviyo|attentive/i.test(marker);
      const popupSized = area > viewportArea * 0.015 && rect.width > window.innerWidth * 0.25;
      if (fixed && highZ && looksLikePopup && (coversScreen || popupSized)) {
        let target = el;
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const parentStyle = window.getComputedStyle(parent);
          if (parentStyle.position === "fixed") target = parent;
          parent = parent.parentElement;
        }
        target.remove();
        count += 1;
      }
    });
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return count;
  }).catch(() => 0);

  return { clicked: clicked.length, removed };
}


function normalizeUrlForRouteCompare(value) {
  try {
    const parsed = new URL(value);
    const params = new URLSearchParams(parsed.search);
    for (const key of [...params.keys()]) {
      if (/^(variant|utm_|fbclid|gclid|msclkid|ref|from|from_collection|campaign|session|_pos|_sid|_ss)$/i.test(key)) {
        params.delete(key);
      }
    }
    const query = params.toString();
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${query ? `?${query}` : ""}`;
  } catch (_) {
    return String(value || "");
  }
}

function hasMeaningfulUrlChange(inputUrl, finalUrl) {
  if (!finalUrl || !inputUrl) return false;
  return normalizeUrlForRouteCompare(inputUrl) !== normalizeUrlForRouteCompare(finalUrl);
}

function scoreReport(checks, keywordResults, loadMs) {
  const breakdown = [
    { key: "status", label: "页面可访问", max: 15, lost: checks.badStatus ? 15 : 0, status: checks.badStatus ? "Review" : "OK", note: checks.badStatus ? `状态码 ${checks.statusCode}` : "页面正常返回" },
    { key: "speed", label: "首屏速度", max: 20, lost: loadMs && loadMs > 5000 ? 20 : loadMs && loadMs > 3000 ? 10 : 0, status: loadMs && loadMs > 5000 ? "High Risk" : loadMs && loadMs > 3000 ? "Review" : "OK", note: loadMs ? `首屏 ${Math.round(loadMs / 100) / 10}s` : "无测速数据" },
    { key: "cta", label: "转化入口", max: 20, lost: checks.ctaVisible ? 0 : 20, status: checks.ctaVisible ? "OK" : "Review", note: checks.ctaVisible ? "识别到明确 CTA" : "移动端首屏未发现明确 CTA" },
    { key: "localization", label: "本地化/货币", max: 15, lost: (!checks.currencyMatched ? 8 : 0) + (checks.hasChinese ? 7 : 0), status: (!checks.currencyMatched || checks.hasChinese) ? "Review" : "OK", note: !checks.currencyMatched ? "货币与目标市场不完全匹配" : checks.hasChinese ? "存在中文残留" : "货币与语言基础信号正常" },
    { key: "layout", label: "移动端体验", max: 10, lost: checks.horizontalOverflow ? 10 : 0, status: checks.horizontalOverflow ? "Review" : "OK", note: checks.horizontalOverflow ? "存在横向溢出" : "未发现横向溢出" },
    { key: "trust", label: "信任与政策", max: 10, lost: (!checks.shippingMentioned ? 5 : 0) + (checks.needsPrivacyNotice && !checks.privacyMentioned ? 5 : 0), status: (!checks.shippingMentioned || (checks.needsPrivacyNotice && !checks.privacyMentioned)) ? "Review" : "OK", note: !checks.shippingMentioned ? "未识别配送/退换说明" : "配送/政策基础信号正常" },
    { key: "consistency", label: "页面一致性", max: 10, lost: checks.urlChanged ? 10 : 0, status: checks.urlChanged ? "Review" : "OK", note: checks.urlChanged ? "最终 URL 与输入不一致" : "未发现明显跳转风险" }
  ];

  const issues = [];
  function issue(condition, points, message, severity = "medium") {
    if (condition) issues.push({ severity, message, points });
  }

  issue(!checks.titlePresent, 5, "页面 title 为空或不可读", "low");
  issue(checks.badStatus, 30, `页面返回异常状态 ${checks.statusCode}，可能是验证页、错误页或反爬页面`, "high");
  issue(loadMs && loadMs > 5000, 20, `首屏就绪 ${Math.round(loadMs / 100) / 10}s，超过 5 秒`, "high");
  issue(loadMs && loadMs > 3000 && loadMs <= 5000, 10, `首屏就绪 ${Math.round(loadMs / 100) / 10}s，超过 3 秒`, "medium");
  issue(!checks.ctaVisible, 20, "移动端首屏没有发现明确 CTA", "high");
  const chineseDetail = Array.isArray(checks.chineseSnippets) && checks.chineseSnippets.length
    ? `：${checks.chineseSnippets.slice(0, 3).join(" / ")}`
    : "";
  issue(checks.hasChinese, 15, `页面出现中文残留${chineseDetail}`, "high");
  issue(checks.horizontalOverflow, 10, "移动端存在横向溢出", "medium");
  issue(!checks.currencyMatched, 8, "页面货币与目标国家不完全匹配", "medium");
  issue(checks.needsPrivacyNotice && !checks.privacyMentioned, 6, "目标国家需要更明确的隐私/Cookie 提示", "low");
  issue(!checks.shippingMentioned, 5, "未识别到配送、退换或退款说明", "low");
  issue(checks.urlChanged, 15, "最终打开页面与输入 URL 不一致，产品页分析可信度下降", "high");

  for (const item of keywordResults) {
    if (!item.found) {
      breakdown.push({ key: `keyword:${item.keyword}`, label: "自定义关注点", max: 0, lost: 0, status: "Review", note: `未出现：${item.keyword}` });
      issues.push({ severity: "medium", message: `自定义关键词未在页面出现：${item.keyword}`, points: 8 });
    }
  }

  const totalMax = breakdown.reduce((sum, item) => sum + item.max, 0);
  const totalLost = breakdown.reduce((sum, item) => sum + Math.min(item.max, item.lost || 0), 0);
  const score = Math.max(0, Math.round(((totalMax - totalLost) / totalMax) * 100));
  const risk = score >= 85 ? "Low" : score >= 70 ? "Medium" : "High";
  return { score, risk, issues, scoreBreakdown: breakdown };
}

async function fallbackCheck(targetUrl, country, keywords, startedAt, reason) {
  const runtimeDiagnostics = playwrightRuntimeDiagnostics({ fallbackReason: reason });
  console.error("Playwright fallback:", JSON.stringify(runtimeDiagnostics, null, 2));
  const response = await fetch(targetUrl, { redirect: "follow" });
  const html = await response.text();
  const analysisMs = Date.now() - startedAt;
  const structured = extractStructuredTextFromHtml(html);
  structured.urlProductName = productNameFromUrl(targetUrl);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  const resolvedCountry = country === "AUTO" ? inferCountry(text, response.url || targetUrl, structured) : country;
  const rules = countryRules(resolvedCountry);
  let productAnalysis = extractProductAnalysis({ title, text, structured, country: resolvedCountry });
  const localizationAnalysis = extractLocalizationAnalysis(text, resolvedCountry, structured);
  const keywordResults = keywords.map((keyword) => ({
    keyword,
    found: textIncludes(text, keyword)
  }));
  const aiEnhancement = await enhanceProductAnalysisWithAi({
    targetUrl,
    finalUrl: response.url || targetUrl,
    title,
    productAnalysis,
    localizationAnalysis,
    structured,
    keywordResults
  });
  const loadMs = 0;
  const checks = {
    titlePresent: Boolean(title),
    badStatus: response.status >= 400,
    statusCode: response.status,
    ctaVisible: /buy now|shop now|add to cart|add to bag|get now|order now|claim|subscribe|start now/i.test(text),
    hasChinese: localizationAnalysis.hasChinese,
    chineseSnippets: localizationAnalysis.chineseSnippets,
    horizontalOverflow: false,
    currencyMatched: localizationAnalysis.currencyMatched,
    shippingMentioned: localizationAnalysis.shippingMentioned,
    privacyMentioned: localizationAnalysis.privacyMentioned,
    needsPrivacyNotice: rules.privacy === "gdpr",
    urlChanged: hasMeaningfulUrlChange(targetUrl, response.url || targetUrl)
  };
  const smart = applySmartReview({
    targetUrl,
    finalUrl: response.url || targetUrl,
    title,
    text,
    structured,
    productAnalysis: aiEnhancement.productAnalysis,
    localizationAnalysis,
    checks
  });
  productAnalysis = smart.productAnalysis;
  const promoSummary = {
    headline: productAnalysis.offer.headline,
    items: productAnalysis.offer.items,
    confidence: productAnalysis.offer.items.length >= 3 ? "high" : productAnalysis.offer.items.length ? "medium" : "low"
  };
  const scored = scoreReport(checks, keywordResults, loadMs);
  const reviewedScore = {
    ...scored,
    issues: [
      ...scored.issues,
      ...smart.smartReview.issues.map((message) => ({ severity: "medium", message, points: 0 }))
    ]
  };

  return {
    mode: "http-fallback",
    fallbackReason: reason,
    url: targetUrl,
    finalUrl: response.url || targetUrl,
    urlChanged: hasMeaningfulUrlChange(targetUrl, response.url || targetUrl),
    country: resolvedCountry,
    requestedCountry: country,
    checkedAt: new Date().toISOString(),
    title,
    loadMs,
    analysisMs,
    loadMetrics: { source: "http-fetch", note: "Fallback 模式只能记录抓取耗时，不代表真实浏览器加载。" },
    runtimeDiagnostics,
    screenshotPath: null,
    desktopScreenshotPath: null,
    languageHint: rules.languageHint,
    promoSummary,
    productAnalysis,
    aiAnalysis: aiEnhancement.aiAnalysis,
    smartReview: smart.smartReview,
    localizationAnalysis,
    checks,
    keywordResults,
    ...reviewedScore
  };
}

async function checkWithPlaywright(targetUrl, country, keywords) {
  const startedAt = Date.now();
  const playwright = tryRequirePlaywright();
  if (!playwright) {
    return fallbackCheck(targetUrl, country, keywords, startedAt, "Playwright is not available.");
  }

  let browser;
  try {
    const { chromium, devices } = playwright;
    browser = await chromium.launch(chromiumLaunchOptions());
    const rules = countryRules(country);
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      locale: rules.locale
    });
    const page = await context.newPage();
    await speedUpPage(page);
    const navigation = await gotoForScreenshot(page, targetUrl, 12000);
    const response = navigation.response;
    await page.waitForTimeout(350).catch(() => {});
    let popupDismissal = await dismissPopups(page);
    await page.waitForTimeout(500).catch(() => {});
    const latePopupDismissal = await dismissPopups(page);
    popupDismissal = {
      clicked: Number(popupDismissal.clicked || 0) + Number(latePopupDismissal.clicked || 0),
      removed: Number(popupDismissal.removed || 0) + Number(latePopupDismissal.removed || 0)
    };
    await page.waitForTimeout(120).catch(() => {});
    const finalUrl = page.url();
    const loadMetrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      if (nav) {
        return {
          source: "navigation",
          firstContentfulPaintMs: fcp ? Math.max(0, Math.round(fcp.startTime)) : 0,
          domContentLoadedMs: Math.max(0, Math.round(nav.domContentLoadedEventEnd)),
          loadMs: Math.max(0, Math.round(nav.loadEventEnd || nav.duration)),
          fullLoadMs: Math.max(0, Math.round(nav.loadEventEnd || nav.duration)),
          responseMs: Math.max(0, Math.round(nav.responseEnd)),
          transferSize: nav.transferSize || 0
        };
      }
      const timing = performance.timing;
      const start = timing.navigationStart;
      return {
        source: "performance.timing",
        firstContentfulPaintMs: 0,
        domContentLoadedMs: Math.max(0, timing.domContentLoadedEventEnd - start),
        loadMs: Math.max(0, timing.loadEventEnd - start),
        fullLoadMs: Math.max(0, timing.loadEventEnd - start),
        responseMs: Math.max(0, timing.responseEnd - start),
        transferSize: 0
      };
    }).catch(() => ({ source: "unavailable", loadMs: Date.now() - startedAt }));
    loadMetrics.navigationError = navigation.error;
    const loadMs = loadMetrics.firstContentfulPaintMs || loadMetrics.domContentLoadedMs || loadMetrics.loadMs || 0;
    const screenshotFile = LATEST_SCREENSHOT_FILE;
    const screenshotPath = path.join(REPORTS_DIR, screenshotFile);
    let mobileScreenshotOk = false;
    let mobileScreenshotError = "";
    try {
      await safeScreenshot(page, { path: screenshotPath, fullPage: false }, 4500);
      mobileScreenshotOk = true;
    } catch (error) {
      mobileScreenshotError = error.message;
    }

    const desktopScreenshotFile = LATEST_DESKTOP_SCREENSHOT_FILE;
    const desktopScreenshotPath = path.join(REPORTS_DIR, desktopScreenshotFile);
    let desktopScreenshotOk = false;
    let desktopScreenshotError = "";
    let desktopNavigation = { error: "桌面端截图已默认关闭，以降低实例内存占用。" };
    if (desktopScreenshotEnabled() && Date.now() - startedAt < 18000) {
      let desktopContext;
      try {
        desktopContext = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          locale: rules.locale
        });
        const desktopPage = await desktopContext.newPage();
        await speedUpPage(desktopPage);
        desktopNavigation = await gotoForScreenshot(desktopPage, finalUrl || targetUrl, 9000);
        await desktopPage.waitForTimeout(300).catch(() => {});
        await dismissPopups(desktopPage);
        await desktopPage.waitForTimeout(250).catch(() => {});
        await dismissPopups(desktopPage);
        try {
          await safeScreenshot(desktopPage, { path: desktopScreenshotPath, fullPage: false }, 3500);
          desktopScreenshotOk = true;
        } catch (error) {
          desktopScreenshotError = error.message;
        }
      } catch (error) {
        desktopScreenshotError = error.message;
      } finally {
        if (desktopContext) await desktopContext.close().catch(() => {});
      }
    }
    loadMetrics.desktopNavigationError = desktopNavigation.error;
    loadMetrics.mobileScreenshotError = mobileScreenshotError;
    loadMetrics.desktopScreenshotError = desktopScreenshotError;

    const title = await page.title().catch(() => "");
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const structured = await page.evaluate(() => {
      const textOf = (selector) => Array.from(document.querySelectorAll(selector))
        .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 16);
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
      };
      const visibleBlocks = Array.from(document.querySelectorAll("h1,h2,h3,p,li,button,a,span,strong"))
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            size: Math.round(rect.width * rect.height),
            inViewport: rect.top >= 0 && rect.top <= window.innerHeight,
            role: el.getAttribute("role") || "",
            href: el.getAttribute("href") || ""
          };
        })
        .filter((item) => item.text.length >= 3 && item.text.length <= 180)
        .sort((a, b) => (a.top - b.top) || (b.size - a.size))
        .slice(0, 80);
      const meta = {};
      document.querySelectorAll("meta[name], meta[property]").forEach((el) => {
        const key = (el.getAttribute("name") || el.getAttribute("property") || "").toLowerCase();
        const value = (el.getAttribute("content") || "").replace(/\s+/g, " ").trim();
        if (key && value) meta[key] = value;
      });
      const buttonCandidates = Array.from(document.querySelectorAll("button, a[role='button'], input[type='submit'], input[type='button'], a[href], [onclick], [data-action], [data-add-to-cart]"))
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = (el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
          const marker = `${el.getAttribute("href") || ""} ${el.getAttribute("class") || ""} ${el.id || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-action") || ""}`;
          const ctaText = /\b(add to cart|add to bag|buy now|buy with|shop now|get now|order now|checkout|claim|start now|select options|choose options|learn more|view details|copy code|get code|subscribe|sign up)\b/i.test(text);
          const hrefIntent = /cart|checkout|products|buy|add-to-cart|shopify|payment/i.test(marker);
          const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";
          const nearTop = rect.top >= -20 && rect.top <= window.innerHeight;
          const purchaseIntent = /\b(add to cart|add to bag|buy now|buy with|checkout|order now)\b/i.test(text) || /cart|bag|checkout|add-to-cart|payment|shopify-payment/i.test(marker);
          const infoIntent = /\b(learn more|view details|select options|choose options|shop now|copy code|get code|subscribe|sign up)\b/i.test(text);
          const score = (purchaseIntent ? 70 : ctaText ? 52 : 0) + (nearTop ? 24 : 0) + (infoIntent ? 8 : 0) + Math.min(16, Math.round((rect.width * rect.height) / 850)) - (disabled ? 40 : 0);
          return {
            text,
            tag: el.tagName.toLowerCase(),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            size: Math.round(rect.width * rect.height),
            inViewport: nearTop,
            href: el.getAttribute("href") || "",
            actionType: purchaseIntent ? "purchase" : infoIntent ? "info" : "other",
            score: score + (hrefIntent ? 8 : 0)
          };
        })
        .filter((item) => item.text && item.text.length <= 96 && item.score > 15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 18);
      const productJson = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map((el) => el.textContent || "")
        .map((raw) => {
          try { return JSON.parse(raw); } catch (_) { return null; }
        })
        .flatMap((item) => Array.isArray(item) ? item : [item])
        .find((item) => item && /product/i.test(String(item["@type"] || "")));
      const offer = productJson && productJson.offers
        ? (Array.isArray(productJson.offers) ? productJson.offers[0] : productJson.offers)
        : null;
      const offerPrice = offer && offer.price ? String(offer.price) : "";
      const offerCurrency = offer && offer.priceCurrency ? String(offer.priceCurrency) : "";
      const metaPrice = meta["product:price:amount"] || meta["og:price:amount"] || "";
      const metaCurrency = meta["product:price:currency"] || meta["og:price:currency"] || offerCurrency || "";
      const shopifyProduct = window.ShopifyAnalytics && window.ShopifyAnalytics.meta
        ? window.ShopifyAnalytics.meta.product
        : null;
      const variants = shopifyProduct && Array.isArray(shopifyProduct.variants) ? shopifyProduct.variants : [];
      const centsToMoney = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return "";
        return `$${(num / 100).toFixed(2)}`;
      };
      const shopifyPrice = variants.length ? centsToMoney(Math.min(...variants.map((variant) => Number(variant.price)).filter(Boolean))) : "";
      const shopifyCompare = variants.length ? centsToMoney(Math.max(...variants.map((variant) => Number(variant.compare_at_price || 0)).filter(Boolean))) : "";
      return {
        meta,
        h1: textOf("h1"),
        h2: textOf("h2"),
        h3: textOf("h3"),
        buttons: textOf("button, a[role='button'], input[type='submit']"),
        ctaCandidates: buttonCandidates,
        primaryCta: buttonCandidates[0] || null,
        visibleBlocks,
        urlProductName: "",
        productName: productJson && productJson.name ? String(productJson.name) : "",
        offerPrice: offerPrice ? `${offerCurrency === "USD" ? "$" : ""}${offerPrice}` : "",
        metaPrice: metaPrice ? `${metaCurrency === "USD" ? "$" : ""}${metaPrice}` : "",
        shopifyPrice,
        compareAtPrice: shopifyCompare
      };
    }).catch(() => ({}));
    structured.urlProductName = productNameFromUrl(targetUrl);
    const resolvedCountry = country === "AUTO" ? inferCountry(text, finalUrl || targetUrl, structured) : country;
    const resolvedRules = countryRules(resolvedCountry);
    let productAnalysis = extractProductAnalysis({ title, text, structured, country: resolvedCountry });
    const localizationAnalysis = extractLocalizationAnalysis(text, resolvedCountry, structured);
    const keywordResults = keywords.map((keyword) => ({
      keyword,
      found: textIncludes(text, keyword)
    }));
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = null;
    const aiEnhancement = await enhanceProductAnalysisWithAi({
      targetUrl,
      finalUrl,
      title,
      productAnalysis,
      localizationAnalysis,
      structured,
      keywordResults
    });
    const ctaByStructure = Boolean(
      structured.primaryCta &&
      structured.primaryCta.inViewport &&
      /\b(shop now|buy now|add to cart|add to bag|get now|order now|claim|start now|checkout)\b/i.test(structured.primaryCta.text || "")
    );
    const ctaVisible = ctaByStructure || await page
      .locator("text=/buy now|shop now|add to cart|add to bag|get now|order now|claim|subscribe|start now/i")
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    const horizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2;
    }).catch(() => false);

    const checks = {
      titlePresent: Boolean(title),
      badStatus: response ? response.status() >= 400 : false,
      statusCode: response ? response.status() : null,
      ctaVisible,
      hasChinese: localizationAnalysis.hasChinese,
      chineseSnippets: localizationAnalysis.chineseSnippets,
      horizontalOverflow,
      currencyMatched: localizationAnalysis.currencyMatched,
      shippingMentioned: localizationAnalysis.shippingMentioned,
      privacyMentioned: localizationAnalysis.privacyMentioned,
      needsPrivacyNotice: resolvedRules.privacy === "gdpr",
      urlChanged: hasMeaningfulUrlChange(targetUrl, finalUrl)
    };
    const smart = applySmartReview({
      targetUrl,
      finalUrl,
      title,
      text,
      structured,
      productAnalysis: aiEnhancement.productAnalysis,
      localizationAnalysis,
      checks
    });
    productAnalysis = smart.productAnalysis;
    const promoSummary = {
      headline: productAnalysis.offer.headline,
      items: productAnalysis.offer.items,
      confidence: productAnalysis.offer.items.length >= 3 ? "high" : productAnalysis.offer.items.length ? "medium" : "low"
    };

    const scored = scoreReport(checks, keywordResults, loadMs);
    const reviewedScore = {
      ...scored,
      issues: [
        ...scored.issues,
        ...smart.smartReview.issues.map((message) => ({ severity: "medium", message, points: 0 }))
      ]
    };
    const analysisMs = Date.now() - startedAt;
    return {
      mode: "playwright",
      status: response ? response.status() : null,
      url: targetUrl,
      finalUrl,
      urlChanged: hasMeaningfulUrlChange(targetUrl, finalUrl),
      country: resolvedCountry,
      requestedCountry: country,
      checkedAt: new Date().toISOString(),
      title,
      loadMs,
      analysisMs,
      loadMetrics,
      runtimeDiagnostics: playwrightRuntimeDiagnostics({ mode: "playwright" }),
      popupDismissal,
      screenshotPath: mobileScreenshotOk ? `reports/${LATEST_SCREENSHOT_FILE}?t=${Date.now()}` : null,
      desktopScreenshotPath: desktopScreenshotOk ? `reports/${desktopScreenshotFile}?t=${Date.now()}` : null,
      languageHint: resolvedRules.languageHint,
      promoSummary,
      productAnalysis,
      aiAnalysis: aiEnhancement.aiAnalysis,
      smartReview: smart.smartReview,
      localizationAnalysis,
      checks,
      keywordResults,
      ...reviewedScore
    };
  } catch (error) {
    return fallbackCheck(targetUrl, country, keywords, startedAt, error.message);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function handleCheck(req, res) {
  try {
    const auth = await requireApiAuth(req, res);
    if (!auth) return;
    const body = await parseBody(req);
    const targetUrl = String(body.url || "").trim();
    const country = normalizeCountryInput(body.country);
    const keywords = normalizeKeywords(body.keywords);

    if (!targetUrl) {
      return jsonResponse(res, 400, { error: "URL is required." });
    }
    try {
      const parsed = new URL(targetUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Unsupported protocol");
    } catch (_) {
      return jsonResponse(res, 400, { error: "Please enter a valid http or https URL." });
    }

    const report = await checkWithPlaywright(targetUrl, country, keywords);
    const reportFile = LATEST_REPORT_FILE;
    fs.writeFileSync(path.join(REPORTS_DIR, reportFile), JSON.stringify(report, null, 2));
    report.reportPath = `reports/${reportFile}?t=${Date.now()}`;
    cleanupReportCache();

    jsonResponse(res, 200, report);
  } catch (error) {
    jsonResponse(res, 500, { error: error.message });
  }
}

async function captureScreenshot(targetUrl, device) {
  const playwright = tryRequirePlaywright();
  if (!playwright) throw new Error("Playwright is not available.");
  const startedAt = Date.now();
  const { chromium, devices } = playwright;
  let browser;
  let context;
  try {
    browser = await chromium.launch(chromiumLaunchOptions());
    const isDesktop = device === "desktop";
    context = await browser.newContext(isDesktop
      ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-US" }
      : { ...devices["iPhone 13"], locale: "en-US" });
    const page = await context.newPage();
    await speedUpPage(page);
    const navigation = await gotoForScreenshot(page, targetUrl, isDesktop ? 9000 : 11000);
    await page.waitForTimeout(350).catch(() => {});
    await dismissPopups(page);
    await page.waitForTimeout(350).catch(() => {});
    await dismissPopups(page);
    const file = isDesktop ? LATEST_DESKTOP_SCREENSHOT_FILE : LATEST_SCREENSHOT_FILE;
    const screenshotPath = path.join(REPORTS_DIR, file);
    await safeScreenshot(page, { path: screenshotPath, fullPage: false }, isDesktop ? 5000 : 6000);
    return {
      device: isDesktop ? "desktop" : "mobile",
      path: `reports/${file}?t=${Date.now()}`,
      finalUrl: page.url(),
      navigationError: navigation.error || "",
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

async function handleScreenshot(req, res) {
  try {
    const auth = await requireApiAuth(req, res);
    if (!auth) return;
    const body = await parseBody(req);
    const targetUrl = String(body.url || "").trim();
    const device = String(body.device || "mobile").toLowerCase() === "desktop" ? "desktop" : "mobile";
    if (!targetUrl) return jsonResponse(res, 400, { error: "URL is required." });
    try {
      const parsed = new URL(targetUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Unsupported protocol");
    } catch (_) {
      return jsonResponse(res, 400, { error: "Please enter a valid http or https URL." });
    }
    const screenshot = await captureScreenshot(targetUrl, device);
    jsonResponse(res, 200, screenshot);
  } catch (error) {
    jsonResponse(res, 500, { error: error.message });
  }
}

function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const baseDir = pathname.startsWith("/reports/") ? ROOT : PUBLIC_DIR;
  const filePath = path.normalize(path.join(baseDir, pathname.replace(/^\/+/, "")));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml; charset=utf-8",
      ".ico": "image/x-icon"
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/config") {
    jsonResponse(res, 200, publicRuntimeConfig());
    return;
  }
  if (req.method === "GET" && req.url === "/api/me") {
    requireApiAuth(req, res).then((auth) => {
      if (!auth) return;
      jsonResponse(res, 200, { ok: true, email: auth.email || "", userId: auth.userId });
    }).catch((error) => jsonResponse(res, 500, { error: error.message }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/check") {
    handleCheck(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/screenshot") {
    handleScreenshot(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/competitors") {
    handleCompetitorSearch(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Landing Intel Console running at http://${shownHost}:${PORT}`);
});
