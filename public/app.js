const form = document.querySelector("#qaForm");
const resultPanel = document.querySelector("#resultPanel");
const submitBtn = document.querySelector("#submitBtn");
const runtimeStatus = document.querySelector("#runtimeStatus");
const countryInput = document.querySelector("#country");
const countrySearch = document.querySelector("#countrySearch");
const marketMenu = document.querySelector("#marketMenu");
const marketCombobox = document.querySelector("#marketCombobox");
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3002" : "";
let lastReport = null;
const authState = {
  enabled: false,
  ready: false,
  signedIn: true,
  clerk: null
};
const cursorDot = document.createElement("div");
cursorDot.className = "cursor-dot";
document.body.appendChild(cursorDot);

const MARKET_OPTIONS = [
  ["AUTO", "自动识别"],
  ["AF", "阿富汗"], ["AX", "奥兰群岛"], ["AL", "阿尔巴尼亚"], ["DZ", "阿尔及利亚"], ["AS", "美属萨摩亚"], ["AD", "安道尔"], ["AO", "安哥拉"], ["AI", "安圭拉"], ["AQ", "南极洲"], ["AG", "安提瓜和巴布达"], ["AR", "阿根廷"], ["AM", "亚美尼亚"], ["AW", "阿鲁巴"], ["AU", "澳大利亚"], ["AT", "奥地利"], ["AZ", "阿塞拜疆"],
  ["BS", "巴哈马"], ["BH", "巴林"], ["BD", "孟加拉国"], ["BB", "巴巴多斯"], ["BY", "白俄罗斯"], ["BE", "比利时"], ["BZ", "伯利兹"], ["BJ", "贝宁"], ["BM", "百慕大"], ["BT", "不丹"], ["BO", "玻利维亚"], ["BQ", "荷兰加勒比区"], ["BA", "波黑"], ["BW", "博茨瓦纳"], ["BV", "布韦岛"], ["BR", "巴西"], ["IO", "英属印度洋领地"], ["BN", "文莱"], ["BG", "保加利亚"], ["BF", "布基纳法索"], ["BI", "布隆迪"],
  ["KH", "柬埔寨"], ["CM", "喀麦隆"], ["CA", "加拿大"], ["CV", "佛得角"], ["KY", "开曼群岛"], ["CF", "中非共和国"], ["TD", "乍得"], ["CL", "智利"], ["CN", "中国大陆"], ["CX", "圣诞岛"], ["CC", "科科斯群岛"], ["CO", "哥伦比亚"], ["KM", "科摩罗"], ["CG", "刚果共和国"], ["CD", "刚果民主共和国"], ["CK", "库克群岛"], ["CR", "哥斯达黎加"], ["CI", "科特迪瓦"], ["HR", "克罗地亚"], ["CU", "古巴"], ["CW", "库拉索"], ["CY", "塞浦路斯"], ["CZ", "捷克"],
  ["DK", "丹麦"], ["DJ", "吉布提"], ["DM", "多米尼克"], ["DO", "多米尼加共和国"], ["EC", "厄瓜多尔"], ["EG", "埃及"], ["SV", "萨尔瓦多"], ["GQ", "赤道几内亚"], ["ER", "厄立特里亚"], ["EE", "爱沙尼亚"], ["SZ", "斯威士兰"], ["ET", "埃塞俄比亚"], ["FK", "福克兰群岛"], ["FO", "法罗群岛"], ["FJ", "斐济"], ["FI", "芬兰"], ["FR", "法国"], ["GF", "法属圭亚那"], ["PF", "法属波利尼西亚"], ["TF", "法属南部领地"],
  ["GA", "加蓬"], ["GM", "冈比亚"], ["GE", "格鲁吉亚"], ["DE", "德国"], ["GH", "加纳"], ["GI", "直布罗陀"], ["GR", "希腊"], ["GL", "格陵兰"], ["GD", "格林纳达"], ["GP", "瓜德罗普"], ["GU", "关岛"], ["GT", "危地马拉"], ["GG", "根西岛"], ["GN", "几内亚"], ["GW", "几内亚比绍"], ["GY", "圭亚那"], ["HT", "海地"], ["HM", "赫德岛和麦克唐纳群岛"], ["HN", "洪都拉斯"], ["HK", "中国香港"], ["HU", "匈牙利"],
  ["IS", "冰岛"], ["IN", "印度"], ["ID", "印度尼西亚"], ["IR", "伊朗"], ["IQ", "伊拉克"], ["IE", "爱尔兰"], ["IM", "马恩岛"], ["IL", "以色列"], ["IT", "意大利"], ["JM", "牙买加"], ["JP", "日本"], ["JE", "泽西岛"], ["JO", "约旦"], ["KZ", "哈萨克斯坦"], ["KE", "肯尼亚"], ["KI", "基里巴斯"], ["KP", "朝鲜"], ["KR", "韩国"], ["KW", "科威特"], ["KG", "吉尔吉斯斯坦"], ["LA", "老挝"], ["LV", "拉脱维亚"], ["LB", "黎巴嫩"], ["LS", "莱索托"], ["LR", "利比里亚"], ["LY", "利比亚"], ["LI", "列支敦士登"], ["LT", "立陶宛"], ["LU", "卢森堡"],
  ["MO", "中国澳门"], ["MG", "马达加斯加"], ["MW", "马拉维"], ["MY", "马来西亚"], ["MV", "马尔代夫"], ["ML", "马里"], ["MT", "马耳他"], ["MH", "马绍尔群岛"], ["MQ", "马提尼克"], ["MR", "毛里塔尼亚"], ["MU", "毛里求斯"], ["YT", "马约特"], ["MX", "墨西哥"], ["FM", "密克罗尼西亚"], ["MD", "摩尔多瓦"], ["MC", "摩纳哥"], ["MN", "蒙古"], ["ME", "黑山"], ["MS", "蒙特塞拉特"], ["MA", "摩洛哥"], ["MZ", "莫桑比克"], ["MM", "缅甸"],
  ["NA", "纳米比亚"], ["NR", "瑙鲁"], ["NP", "尼泊尔"], ["NL", "荷兰"], ["NC", "新喀里多尼亚"], ["NZ", "新西兰"], ["NI", "尼加拉瓜"], ["NE", "尼日尔"], ["NG", "尼日利亚"], ["NU", "纽埃"], ["NF", "诺福克岛"], ["MK", "北马其顿"], ["MP", "北马里亚纳群岛"], ["NO", "挪威"], ["OM", "阿曼"], ["PK", "巴基斯坦"], ["PW", "帕劳"], ["PS", "巴勒斯坦"], ["PA", "巴拿马"], ["PG", "巴布亚新几内亚"], ["PY", "巴拉圭"], ["PE", "秘鲁"], ["PH", "菲律宾"], ["PN", "皮特凯恩群岛"], ["PL", "波兰"], ["PT", "葡萄牙"], ["PR", "波多黎各"], ["QA", "卡塔尔"],
  ["RE", "留尼汪"], ["RO", "罗马尼亚"], ["RU", "俄罗斯"], ["RW", "卢旺达"], ["BL", "圣巴泰勒米"], ["SH", "圣赫勒拿"], ["KN", "圣基茨和尼维斯"], ["LC", "圣卢西亚"], ["MF", "法属圣马丁"], ["PM", "圣皮埃尔和密克隆"], ["VC", "圣文森特和格林纳丁斯"], ["WS", "萨摩亚"], ["SM", "圣马力诺"], ["ST", "圣多美和普林西比"], ["SA", "沙特阿拉伯"], ["SN", "塞内加尔"], ["RS", "塞尔维亚"], ["SC", "塞舌尔"], ["SL", "塞拉利昂"], ["SG", "新加坡"], ["SX", "荷属圣马丁"], ["SK", "斯洛伐克"], ["SI", "斯洛文尼亚"], ["SB", "所罗门群岛"], ["SO", "索马里"], ["ZA", "南非"], ["GS", "南乔治亚和南桑威奇群岛"], ["SS", "南苏丹"], ["ES", "西班牙"], ["LK", "斯里兰卡"], ["SD", "苏丹"], ["SR", "苏里南"], ["SJ", "斯瓦尔巴和扬马延"], ["SE", "瑞典"], ["CH", "瑞士"], ["SY", "叙利亚"],
  ["TW", "中国台湾"], ["TJ", "塔吉克斯坦"], ["TZ", "坦桑尼亚"], ["TH", "泰国"], ["TL", "东帝汶"], ["TG", "多哥"], ["TK", "托克劳"], ["TO", "汤加"], ["TT", "特立尼达和多巴哥"], ["TN", "突尼斯"], ["TR", "土耳其"], ["TM", "土库曼斯坦"], ["TC", "特克斯和凯科斯群岛"], ["TV", "图瓦卢"], ["UG", "乌干达"], ["UA", "乌克兰"], ["AE", "阿联酋"], ["UK", "英国"], ["US", "美国"], ["UM", "美国本土外小岛屿"], ["UY", "乌拉圭"], ["UZ", "乌兹别克斯坦"], ["VU", "瓦努阿图"], ["VA", "梵蒂冈"], ["VE", "委内瑞拉"], ["VN", "越南"], ["VG", "英属维尔京群岛"], ["VI", "美属维尔京群岛"], ["WF", "瓦利斯和富图纳"], ["EH", "西撒哈拉"], ["YE", "也门"], ["ZM", "赞比亚"], ["ZW", "津巴布韦"]
];

const MARKET_NAME_BY_CODE = Object.fromEntries(MARKET_OPTIONS.map(([code, name]) => [code, name]));
const HOT_MARKET_CODES = ["AUTO", "US", "CA", "UK", "AU", "DE", "FR", "ES", "IT", "JP", "KR", "SG", "AE", "SA", "MX", "BR", "NL", "SE", "HK", "TW"];

function marketLabel(code) {
  if (code === "AUTO") return "自动识别";
  const name = MARKET_NAME_BY_CODE[code] || code;
  return `${name} · ${code}`;
}

function marketMatches(option, keyword) {
  const [code, name] = option;
  const q = String(keyword || "").trim().toLowerCase();
  if (!q) return true;
  return code.toLowerCase().includes(q) || name.toLowerCase().includes(q);
}

function renderMarketMenu(keyword = "", forceAll = false) {
  if (!marketMenu) return;
  const query = String(keyword || "").trim();
  const source = query || forceAll
    ? MARKET_OPTIONS.filter((item) => marketMatches(item, query)).slice(0, 60)
    : HOT_MARKET_CODES.map((code) => MARKET_OPTIONS.find((item) => item[0] === code)).filter(Boolean);
  const selected = countryInput ? countryInput.value || "AUTO" : "AUTO";
  marketMenu.innerHTML = source.map(([code, name]) => `
    <button class="market-option ${code === selected ? "is-selected" : ""}" type="button" data-market-code="${safeHtml(code)}" role="option" aria-selected="${code === selected ? "true" : "false"}">
      <strong>${safeHtml(name)}</strong><span>${safeHtml(code === "AUTO" ? "智能判断" : code)}</span>
    </button>
  `).join("");
}

function setMarket(code) {
  const next = code || "AUTO";
  if (countryInput) countryInput.value = next;
  if (countrySearch) countrySearch.value = marketLabel(next);
  renderMarketMenu("");
}

function openMarketMenu() {
  if (!marketCombobox || !countrySearch) return;
  marketCombobox.classList.add("is-open");
  countrySearch.setAttribute("aria-expanded", "true");
  const value = countrySearch.value || "";
  const isSelectedLabel = value === "自动识别" || value.includes("·");
  renderMarketMenu(isSelectedLabel ? "" : value);
}

function closeMarketMenu() {
  if (!marketCombobox || !countrySearch) return;
  marketCombobox.classList.remove("is-open");
  countrySearch.setAttribute("aria-expanded", "false");
}

setMarket("AUTO");

countrySearch?.addEventListener("focus", () => {
  countrySearch.select();
  openMarketMenu();
});

countrySearch?.addEventListener("input", () => {
  if (countryInput) countryInput.value = "AUTO";
  openMarketMenu();
  renderMarketMenu(countrySearch.value, true);
});

marketMenu?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-market-code]");
  if (!option) return;
  setMarket(option.dataset.marketCode || "AUTO");
  closeMarketMenu();
});

document.addEventListener("click", (event) => {
  if (!marketCombobox || marketCombobox.contains(event.target)) return;
  closeMarketMenu();
});

countrySearch?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMarketMenu();
    return;
  }
  if (event.key === "Enter") {
    const first = marketMenu?.querySelector("[data-market-code]");
    if (first) {
      event.preventDefault();
      setMarket(first.dataset.marketCode || "AUTO");
      closeMarketMenu();
    }
  }
});

function safeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadScript(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) script.setAttribute(key, value);
    }
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

function clerkFrontendApiFromKey(publishableKey) {
  try {
    const encoded = String(publishableKey || "").replace(/^pk_(?:test|live)_/, "");
    const decoded = atob(encoded).replace(/\$$/, "");
    return decoded || "";
  } catch (_) {
    return "";
  }
}

function setToolLocked(locked) {
  if (!form) return;
  for (const field of form.querySelectorAll("input, button")) {
    field.disabled = locked;
  }
}

function renderSignedOutGate() {
  setToolLocked(true);
  runtimeStatus.textContent = "需登录";
  resultPanel.innerHTML = `
    <div class="empty-state auth-state">
      <div class="auth-card">
        <span class="slant-tag">PRIVATE</span>
        <h2>登录后使用</h2>
        <p>这个工具只开放给被允许的账号，登录后才能扫描落地页和调用 API。</p>
        <div id="signInMount" class="sign-in-mount"></div>
      </div>
    </div>
  `;
  const mount = document.querySelector("#signInMount");
  if (mount && authState.clerk) authState.clerk.mountSignIn(mount);
}

function renderSignedInState() {
  setToolLocked(false);
  runtimeStatus.textContent = "待命";
  const mount = document.querySelector("#authMount");
  if (mount && authState.clerk) {
    mount.innerHTML = "";
    authState.clerk.mountUserButton(mount);
  }
  if (resultPanel.querySelector(".auth-state")) {
    resultPanel.innerHTML = `
      <div class="empty-state idle-state">
        <div class="idle-card">
          <span class="slant-tag">IDLE</span>
          <h2>READY TO SCAN</h2>
          <p>丢一个落地页 URL 进来，系统会抓产品信息、促销价格、风险和首屏截图。</p>
          <div class="scan-window">
            <span>PRODUCT</span><span>OFFER</span><span>TRUST</span><span>RISK</span>
          </div>
        </div>
      </div>
    `;
  }
}

async function initAuth() {
  try {
    const response = await fetch(`${API_BASE}/api/config`);
    const config = await response.json();
    authState.enabled = Boolean(config.authEnabled && config.clerkPublishableKey);
    if (!authState.enabled) return;
    setToolLocked(true);
    runtimeStatus.textContent = "登录检查";
    await loadScript("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js", {
      "data-clerk-publishable-key": config.clerkPublishableKey
    });
    const clerk = window.Clerk;
    if (!clerk || typeof clerk.load !== "function") throw new Error("Clerk SDK 未正确加载");
    await clerk.load();
    authState.clerk = clerk;
    authState.ready = true;
    authState.signedIn = Boolean(clerk.user);
    clerk.addListener(({ user }) => {
      authState.signedIn = Boolean(user);
      if (authState.signedIn) renderSignedInState();
      else renderSignedOutGate();
    });
    if (authState.signedIn) renderSignedInState();
    else renderSignedOutGate();
  } catch (error) {
    resultPanel.innerHTML = `<div class="error">登录组件加载失败：${safeHtml(error.message)}</div>`;
    runtimeStatus.textContent = "登录异常";
  }
}

async function authHeaders() {
  if (!authState.enabled) return {};
  const token = await authState.clerk?.session?.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(await authHeaders())
  };
  return fetch(url, { ...options, headers });
}

initAuth();


function riskClass(risk) {
  return String(risk || "").toLowerCase();
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${Math.round(ms / 100) / 10}s` : `${ms}ms`;
}

function itemText(item) {
  if (item && typeof item === "object") return item.text || item.value || "";
  return String(item ?? "");
}

function itemZh(item) {
  if (item && typeof item === "object") return item.zh || item.translation || "";
  return "";
}

function listItems(items, emptyText) {
  const data = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!data.length) return `<li class="muted-item">${safeHtml(emptyText)}</li>`;
  return data.map((item) => {
    const zh = itemZh(item);
    return `<li><span class="item-main">${safeHtml(itemText(item))}</span>${zh ? `<span class="item-zh">${safeHtml(zh)}</span>` : ""}</li>`;
  }).join("");
}

function levelText(level) {
  return String(level || "medium").toUpperCase();
}

function levelFromConfidence(value) {
  const clean = String(value || "").toLowerCase();
  if (clean === "high") return "HIGH";
  if (clean === "low") return "LOW";
  return "MEDIUM";
}

function scoreLevel(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return "MEDIUM";
  if (num >= 86) return "HIGH";
  if (num >= 70) return "MEDIUM";
  return "LOW";
}

function renderIntel(label, value, hint) {
  const level = levelText(value);
  return `
    <div class="intel-tile ${level.toLowerCase()}">
      <span>${safeHtml(label)}</span>
      <strong>${safeHtml(level)}</strong>
      <em>${safeHtml(hint || "")}</em>
    </div>
  `;
}

function firstText(items, fallback = "未识别") {
  const data = Array.isArray(items) ? items.filter(Boolean) : [];
  return data.length ? itemText(data[0]) : fallback;
}

function renderSticker(text, tone = "") {
  return `<span class="sticker ${safeHtml(tone)}">${safeHtml(text)}</span>`;
}


function detectedCurrency(report, localization, offerPrice) {
  const raw = [offerPrice && offerPrice.current, offerPrice && offerPrice.original, ...(offerPrice && Array.isArray(offerPrice.raw) ? offerPrice.raw : [])].filter(Boolean).join(" ");
  if (/\bUSD\b|\$\s?\d/i.test(raw)) return "$ / USD";
  if (/\bCAD\b/i.test(raw)) return "$ / CAD";
  if (/\bAUD\b/i.test(raw)) return "$ / AUD";
  if (/\bGBP\b|£/i.test(raw)) return "£ / GBP";
  if (/\bEUR\b|€/i.test(raw)) return "€ / EUR";
  if (/\bJPY\b|¥/i.test(raw)) return "¥ / JPY";
  if (/\bKRW\b|₩/i.test(raw)) return "₩ / KRW";
  const expected = localization && Array.isArray(localization.expectedCurrency) ? localization.expectedCurrency.join(" / ") : "";
  return expected || "-";
}

function shortCnTake(analysis) {
  const value = String((analysis && analysis.summary) || "").replace(/\s+/g, " ").trim();
  if (!value) return "暂无中文短判，可参考下方卖点和证据。";
  return value.length > 72 ? `${value.slice(0, 72)}...` : value;
}

function renderOffer(offer) {
  const groups = offer && Array.isArray(offer.items) ? offer.items : [];
  const price = offer && offer.price ? offer.price : {};
  if (!groups.length) {
    return `<div class="empty-note">未识别到明确价格、折扣、免邮、优惠码或限时促销。</div>`;
  }
  const discount = groups.find((group) => group.type === "折扣");
  const coupon = groups.find((group) => group.type === "优惠码");
  const shipping = groups.find((group) => group.type === "配送");
  const primaryParts = [
    firstText(discount && discount.values, ""),
    price.current ? `当前价 ${price.current}` : firstText(groups.find((group) => group.type === "价格")?.values, ""),
    firstText(coupon && coupon.values, ""),
    firstText(shipping && shipping.values, "")
  ].filter(Boolean).slice(0, 4);
  const excluded = Array.isArray(price.excluded) ? price.excluded : [];
  return `
    <div class="card-priority">
      <span>PRIMARY OFFER</span>
      <strong>${safeHtml(primaryParts.join(" · ") || offer.headline || "未识别主促销")}</strong>
      ${price.confidence ? `<em>PRICE CONFIDENCE · ${safeHtml(levelText(price.confidence))}</em>` : ""}
    </div>
    <div class="detail-label">DETAILS</div>
    <div class="offer-list">
      ${groups.map((group) => `
        <div class="offer-row">
          <span>${safeHtml(group.type)}</span>
          <strong>
            ${group.values.map((item) => {
              const zh = itemZh(item);
              return `<b>${safeHtml(itemText(item))}</b>${zh ? `<em>${safeHtml(zh)}</em>` : ""}`;
            }).join("")}
          </strong>
        </div>
      `).join("")}
    </div>
    ${excluded.length ? `
      <div class="exclusion-note">
        <span>PRICE EXCLUSIONS</span>
        <ul>${excluded.slice(0, 3).map((item) => `<li><span class="item-main">${safeHtml(item.text)}</span><span class="item-zh">${safeHtml(item.reason)}</span></li>`).join("")}</ul>
      </div>
    ` : ""}
  `;
}

function renderLocalization(localization) {
  if (!localization) {
    return `<div class="empty-note">未生成本地化分析。</div>`;
  }
  const chineseSnippets = Array.isArray(localization.chineseSnippets) ? localization.chineseSnippets : [];
  const chineseBlock = chineseSnippets.length
    ? `
      <h4>中文残留位置</h4>
      <ul>${listItems(chineseSnippets, "未发现中文残留。")}</ul>
    `
    : "";
  return `
    <div class="locale-grid">
      <div><span>市场</span><strong>${safeHtml(localization.market || localization.country)}</strong></div>
      <div><span>语言</span><strong>${safeHtml(localization.expectedLanguage || "-")}</strong></div>
      <div><span>货币</span><strong>${safeHtml((localization.expectedCurrency || []).join(" / "))}</strong></div>
      <div><span>状态</span><strong>${localization.status === "ok" ? "OK" : "Review"}</strong></div>
    </div>
    <h4>已识别信号</h4>
    <ul>${listItems(localization.localSignals, "未识别到明显本地化信号。")}</ul>
    <h4>本地化缺口</h4>
    <ul>${listItems(localization.gaps, "本地化基础信息看起来完整。")}</ul>
    ${chineseBlock}
  `;
}

function renderPreviewShot(label, path, emptyText) {
  if (!path) return `<div class="empty-note">${safeHtml(emptyText)}</div>`;
  const src = `${API_BASE}/${safeHtml(path)}`;
  const deviceClass = /桌面|desktop/i.test(label) ? "desktop-device" : "mobile-device";
  const shortLabel = /桌面|desktop/i.test(label) ? "DESKTOP" : "MOBILE";
  return `
    <a class="preview-shot device-shot ${deviceClass}" href="${src}" data-preview-src="${src}" data-preview-label="${safeHtml(label)}" title="点击放大">
      <span class="device-label">${safeHtml(shortLabel)}</span>
      <div class="device-frame">
        <img class="screenshot" src="${src}" alt="${safeHtml(label)} screenshot">
      </div>
    </a>
  `;
}


function renderCompetitorPanel(analysis) {
  const search = analysis && analysis.competitorSearch ? analysis.competitorSearch : {};
  const queries = Array.isArray(search.queries) ? search.queries : [];
  if (!queries.length) {
    return `
      <section class="analysis-card competitor-card">
        <div class="card-head"><h3>竞品雷达</h3></div>
        <div class="empty-note">暂无竞品搜索关键词。先完成一次产品分析后再试。</div>
      </section>
    `;
  }
  return `
    <section class="analysis-card competitor-card">
      <div class="card-head"><h3>竞品雷达</h3></div>
      <div class="card-priority">
        <span>SEARCH BRIEF</span>
        <strong>${safeHtml(firstText(queries, "同市场同品类竞品"))}</strong>
        <em>默认只搜 1 次，避免重复消耗；需要更深 PDP 再手动追加</em>
      </div>
      <div class="query-stack">
        ${queries.slice(0, 4).map((item) => `<span>${safeHtml(item.query || item.text || item)}</span>`).join("")}
      </div>
      <button class="competitor-search-btn" type="button" data-action="search-competitors">搜索竞品链接 · 约 1 credit</button>
      <div class="competitor-results" id="competitorResults"></div>
    </section>
  `;
}

function renderScoreBreakdown(report) {
  const items = Array.isArray(report.scoreBreakdown) ? report.scoreBreakdown : [];
  if (!items.length) return "";
  return `
    <div class="score-breakdown">
      <div class="detail-label">SCORE BREAKDOWN</div>
      ${items.filter((item) => Number(item.max) > 0).map((item) => {
        const earned = Math.max(0, Number(item.max || 0) - Number(item.lost || 0));
        const statusClass = String(item.status || "").toLowerCase().replace(/\s+/g, "-");
        return `
          <div class="score-row ${statusClass}">
            <span>${safeHtml(item.label)}</span>
            <strong>${safeHtml(earned)} / ${safeHtml(item.max)}</strong>
            <em>${safeHtml(item.note || item.status || "")}</em>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCompetitorResults(data) {
  const box = document.querySelector("#competitorResults");
  if (!box) return;
  if (data.skipped) {
    box.innerHTML = `<div class="empty-note">${safeHtml(data.reason || "Tavily API key 未配置。")}</div>`;
    return;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const callCount = Number(data.actualSearchCalls || (data.queriesUsed || []).length || 0);
  const creditText = data.cached ? "缓存命中 · 0 credit" : `本次 ${callCount || 0} 次搜索`;
  if (!results.length) {
    const deepAction = data.canDeepSearch ? `<button class="competitor-deep-btn" type="button" data-action="deep-search-competitors">追加 PDP 下钻</button>` : "";
    box.innerHTML = `<div class="empty-note">未搜到可用竞品。${safeHtml(data.reason || "")}</div>${deepAction}`;
    return;
  }
  box.innerHTML = `
    <div class="competitor-meta">
      <span>${safeHtml(creditText)}</span>
      <span>${safeHtml(data.cached ? "CACHED" : data.deep ? "DEEP SEARCH" : "SAVE MODE")}</span>
      <span>${safeHtml(data.searchDepth || "basic").toUpperCase()}</span>
      <span>${safeHtml(data.mode === "pdp" ? "PDP MODE" : "FALLBACK MODE")}</span>
      <span>${safeHtml(results.length)} LINKS</span>
    </div>
    ${data.deepSearchHint ? `<div class="competitor-hint">${safeHtml(data.deepSearchHint)}</div>` : ""}
    <div class="competitor-list">
      ${results.map((item) => `
        <a class="competitor-link ${item.isPdp ? "is-pdp" : ""}" href="${safeHtml(item.url)}" target="_blank" rel="noreferrer">
          <span>${safeHtml(item.domain || "DOMAIN")} · ${safeHtml((item.matchType || "link").toUpperCase())}</span>
          <strong>${safeHtml(item.title || item.url)}</strong>
          <em>${safeHtml(item.snippet || "")}</em>
        </a>
      `).join("")}
    </div>
    ${data.canDeepSearch ? `<button class="competitor-deep-btn" type="button" data-action="deep-search-competitors">追加 PDP 下钻 · 最多约 4 次搜索</button>` : ""}
  `;
}

function renderReport(report) {
  lastReport = report;
  const analysis = report.productAnalysis || {};
  const localization = report.localizationAnalysis || {};
  const category = analysis.productCategory || {};
  const smart = report.smartReview || {};
  const offerPrice = analysis.offer && analysis.offer.price ? analysis.offer.price : {};
  const screenshots = `
    <div class="device-console">
      ${renderPreviewShot("移动端", report.screenshotPath, "当前使用 HTTP fallback 模式，没有生成移动端截图。")}
      ${renderPreviewShot("桌面端", report.desktopScreenshotPath, "当前使用 HTTP fallback 模式，没有生成桌面端截图。")}
    </div>
  `;
  const issues = report.issues && report.issues.length
    ? report.issues.map((issue) => `
        <li class="issue ${safeHtml(issue.severity)}">
          <span>${safeHtml(issue.message)}</span>
          <strong>-${safeHtml(issue.points)}</strong>
        </li>
      `).join("")
    : `<li class="issue"><span>没有发现明显 QA 风险</span><strong>OK</strong></li>`;
  const routeNotice = report.urlChanged
    ? `<div class="route-notice">最终打开地址和输入地址不一致：${safeHtml(report.finalUrl || "")}</div>`
    : "";
  const popupNote = report.popupDismissal && (report.popupDismissal.clicked || report.popupDismissal.removed)
    ? "已清理遮挡弹窗"
    : "未发现遮挡弹窗";
  const productMatch = levelFromConfidence(smart.confidence || analysis.confidence);
  const offerClarity = offerPrice.confidence ? levelFromConfidence(offerPrice.confidence) : (analysis.offer && analysis.offer.items && analysis.offer.items.length ? "MEDIUM" : "LOW");
  const ctaQuality = analysis.callsToAction && analysis.callsToAction.length ? "HIGH" : "LOW";
  const stickers = [
    smart.pageType ? renderSticker(String(smart.pageType).toUpperCase(), "blue") : "",
    localization.market ? renderSticker(localization.market, "") : "",
    analysis.aiEnhanced ? renderSticker("AI CHECKED", "green") : "",
    renderSticker(`${productMatch} CONFIDENCE`, productMatch.toLowerCase())
  ].filter(Boolean).join("");

  resultPanel.innerHTML = `
    <div class="analysis-shell">
      <section class="summary-card command-summary">
        <div class="summary-main">
          <div class="sticker-row">${stickers}</div>
          <h2>${safeHtml(analysis.productName || report.title || "未识别产品名")}</h2>
          <p>${safeHtml(analysis.summary || "页面分析完成，但可提取信息较少。")}</p>
          <a class="primary-page-link" href="${safeHtml(report.url)}" target="_blank" rel="noreferrer">打开落地页</a>
          ${routeNotice}
        </div>
        <div class="score-card">
          <span>页面评分</span>
          <strong>${safeHtml(report.score)}</strong>
          <em class="${riskClass(report.risk)}">${safeHtml(report.risk)} Risk</em>
        </div>
      </section>

      <section class="intel-strip">
        ${renderIntel("Product Match", productMatch, category.zh || category.name || "产品识别")}
        ${renderIntel("Offer Clarity", offerClarity, offerPrice.current || "促销清晰度")}
        ${renderIntel("CTA Quality", ctaQuality, firstText(analysis.callsToAction, "购买路径"))}
      </section>

      <section class="metric-strip">
        <div><span>识别市场</span><strong>${safeHtml(localization.market || report.country)}</strong></div>
        <div><span>识别货币</span><strong>${safeHtml(detectedCurrency(report, localization, offerPrice))}</strong></div>
        <div><span>处理时间</span><strong>${formatMs(report.analysisMs)}</strong></div>
        <div><span>首屏就绪</span><strong>${formatMs(report.loadMs)}</strong></div>
      </section>

      <div class="analysis-grid">
        <section class="analysis-card main-card conclusion-card">
          <div class="card-head"><h3>页面结论</h3></div>
          <div class="flip-card core-flip" data-flip-card>
            <div class="flip-card-inner">
              <div class="flip-face flip-front">
                <button class="flip-toggle" type="button" data-action="flip-core">CN TAKE</button>
                <span>CORE HEAD</span>
                <strong>${safeHtml(analysis.description || analysis.summary || "暂无 meta description，可重点参考下方卖点和页面定位。")}</strong>
              </div>
              <div class="flip-face flip-back">
                <button class="flip-toggle" type="button" data-action="flip-core">CORE HEAD</button>
                <span>CN TAKE</span>
                <strong>${safeHtml(shortCnTake(analysis))}</strong>
              </div>
            </div>
          </div>
          ${category.name ? `
            <div class="category-chip">
              <span>品类</span>
              <strong>${safeHtml(category.name)}</strong>
              ${category.zh ? `<em>${safeHtml(category.zh)}</em>` : ""}
              ${category.reason ? `<small>${safeHtml(category.reason)}</small>` : ""}
            </div>
          ` : ""}
          <div class="two-col evidence-block">
            <div>
              <h4>页面定位</h4>
              <ul>${listItems(analysis.positioning, "未识别到清晰标题层级。")}</ul>
            </div>
            <div>
              <h4>核心卖点</h4>
              <ul>${listItems(analysis.sellingPoints, "卖点不够集中，建议在首屏补充明确利益点。")}</ul>
            </div>
          </div>
        </section>

        <section class="analysis-card offer-card">
          <div class="card-head"><h3>促销与价格</h3></div>
          ${renderOffer(analysis.offer)}
        </section>

        <section class="analysis-card trust-card">
          <div class="card-head"><h3>信任与转化</h3></div>
          <div class="card-priority">
            <span>PRIMARY CTA</span>
            <strong>${safeHtml(firstText(analysis.callsToAction, "未识别到明显购买按钮"))}</strong>
          </div>
          <div class="two-col evidence-block">
            <div>
              <h4>信任背书</h4>
              <ul>${listItems(analysis.trustSignals, "未识别到评价、保障、退换或安全支付信息。")}</ul>
            </div>
            <div>
              <h4>CTA</h4>
              <ul>${listItems(analysis.callsToAction, "未识别到明显购买按钮。")}</ul>
            </div>
          </div>
        </section>

        <section class="analysis-card locale-card">
          <div class="card-head"><h3>本地化</h3></div>
          ${renderLocalization(localization)}
        </section>

        <section class="analysis-card gaps-card">
          <div class="card-head"><h3>优化建议</h3></div>
          <div class="card-priority">
            <span>NEXT ACTION</span>
            <strong>${safeHtml(firstText(analysis.gaps, "当前结构没有明显缺口，可继续结合真实转化数据判断。"))}</strong>
          </div>
          ${renderScoreBreakdown(report)}
          <h4>页面风险</h4>
          <ul class="issue-list">${issues}</ul>
        </section>

        <aside class="analysis-card preview-card">
          <div class="card-head"><h3>设备对比台</h3></div>
          ${screenshots}
        </aside>

        ${renderCompetitorPanel(analysis)}
      </div>

      <div class="links secondary-links"></div>
    </div>
  `;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = {
    url: formData.get("url"),
    country: formData.get("country"),
    keywords: formData.get("keywords")
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "扫描中";
  runtimeStatus.textContent = "扫描中";
  form.classList.add("is-scanning");
  document.body.classList.add("is-scanning");
  resultPanel.innerHTML = `
    <div class="empty-state scanning-state">
      <div class="scanner-card">
        <span class="slant-tag">SCANNING</span>
        <h2>正在扫描落地页</h2>
        <p>页面打开、弹窗清理、双端截图和信息提取正在依次进行。</p>
        <div class="scan-line"></div>
        <div class="scan-steps">
          <span>OPEN PAGE</span>
          <span>CLEAN POPUPS</span>
          <span>MOBILE SHOT</span>
          <span>DESKTOP SHOT</span>
          <span>EXTRACT INFO</span>
          <span>SCORE</span>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await apiFetch(`${API_BASE}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Check failed");
    renderReport(data);
    runtimeStatus.textContent = "完成";
  } catch (error) {
    const message = window.location.protocol === "file:"
      ? "连接本地服务失败。请先双击启动 Landing Page QA.command，或打开 http://localhost:3002 后再运行。"
      : error.message;
    resultPanel.innerHTML = `<div class="error">${safeHtml(message)}</div>`;
    runtimeStatus.textContent = "出错";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "执行扫描";
    form.classList.remove("is-scanning");
    document.body.classList.remove("is-scanning");
  }
});

document.addEventListener("pointermove", (event) => {
  cursorDot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target.closest("button, a, input, select, .analysis-card, .metric-strip div, .summary-card");
  if (!target) return;
  target.classList.remove("is-pressing");
  void target.offsetWidth;
  target.classList.add("is-pressing");
  window.setTimeout(() => target.classList.remove("is-pressing"), 220);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="flip-core"]');
  if (!button) return;
  event.preventDefault();
  const card = button.closest("[data-flip-card]");
  if (card) card.classList.toggle("is-flipped");
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest('[data-action="search-competitors"], [data-action="deep-search-competitors"]');
  if (!button) return;
  if (!lastReport) return;
  const deep = button.dataset.action === "deep-search-competitors";
  const box = document.querySelector("#competitorResults");
  button.disabled = true;
  button.textContent = deep ? "PDP 下钻中..." : "搜索中...";
  if (box) {
    box.innerHTML = `<div class="competitor-loading"><span></span><strong>${deep ? "正在追加 PDP 下钻，可能消耗多次搜索" : "省钱模式：仅调用 1 次 Tavily 搜索"}</strong></div>`;
  }
  try {
    const response = await apiFetch(`${API_BASE}/api/competitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: lastReport.url,
        productAnalysis: lastReport.productAnalysis,
        localizationAnalysis: lastReport.localizationAnalysis,
        deep
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Competitor search failed");
    renderCompetitorResults(data);
  } catch (error) {
    if (box) box.innerHTML = `<div class="empty-note">${safeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = deep ? "重新 PDP 下钻" : "重新搜索竞品 · 约 1 credit";
  }
});

document.addEventListener("click", (event) => {
  const preview = event.target.closest("[data-preview-src]");
  if (!preview) return;
  event.preventDefault();
  const overlay = document.createElement("div");
  overlay.className = "preview-lightbox";
  overlay.innerHTML = `
    <button class="lightbox-close" type="button">关闭</button>
    <div class="lightbox-frame">
      <span>${safeHtml(preview.dataset.previewLabel || "截图预览")}</span>
      <img src="${safeHtml(preview.dataset.previewSrc)}" alt="${safeHtml(preview.dataset.previewLabel || "截图预览")}">
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".lightbox-close").focus();
});

document.addEventListener("click", (event) => {
  if (event.target.matches(".preview-lightbox, .lightbox-close")) {
    event.target.closest(".preview-lightbox").remove();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelector(".preview-lightbox")?.remove();
});
