export const GROUP_COLORS = [
  "blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple", "grey"
];

const COMPOUND_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "com.hk", "com.tw",
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "co.kr",
  "github.io", "netlify.app", "vercel.app", "pages.dev", "blogspot.com", "wordpress.com"
]);

const SITE_NAMES = new Map([
  ["bilibili.com", { zh: "哔哩哔哩", en: "Bilibili" }],
  ["youtube.com", { zh: "YouTube", en: "YouTube" }],
  ["github.com", { zh: "GitHub", en: "GitHub" }],
  ["quark.cn", { zh: "夸克网盘", en: "Quark Drive" }],
  ["google.com", { zh: "Google", en: "Google" }],
  ["chrome", { zh: "Chrome 页面", en: "Chrome Pages" }]
]);

const SITE_COLORS = new Map([
  ["bilibili.com", "red"], ["youtube.com", "red"],
  ["github.com", "green"], ["quark.cn", "blue"], ["chrome", "grey"]
]);

const TOPICS = [
  { title: "语音项目", en: "Speech Projects", color: "purple", terms: /index\s?tts|fun\s?asr|fire\s?red\s?asr|narrato\s?ai/i },
  { title: "部署与域名", en: "Deployment & Domains", color: "cyan", terms: /\b(?:netlify|vercel|deployment|deploy|dns)\b|自定义域名|绑定域名|网站托管/i },
  { title: "API 服务", en: "API Services", color: "green", terms: /\b(?:any\s?router|newapi|novacode|tavily|api platform|api management)\b|模型接口|接口平台/i },
  { title: "开发社区", en: "Developer Communities", color: "green", terms: /linux\s?do|leetcode|github|gitlab|stackoverflow|开发社区|技术论坛/i },
  { title: "语音与字幕", en: "Speech & Captions", color: "purple", terms: /\b(?:tts|asr|speech|transcri(?:be|ption)|whisper|index\s?tts|fun\s?asr)\b|语音|字幕|转写|转录|音频|配音/i },
  { title: "网盘与文件", en: "Cloud Files", color: "blue", terms: /\b(?:drive|dropbox|onedrive|cloud storage|file sharing)\b|网盘|云盘|文件分享|夸克网盘|百度网盘/i },
  { title: "邮件与沟通", en: "Mail & Communication", color: "cyan", terms: /\b(?:gmail|outlook|discord|slack|teams|mailbox|email)\b|邮箱|邮件|收件箱|飞书|钉钉/i },
  { title: "视频与直播", en: "Video & Streaming", color: "red", terms: /\b(?:youtube|bilibili|twitch|netflix|video)\b|哔哩哔哩|视频|直播|番剧/i },
  { title: "开发与代码", en: "Development & Code", color: "green", terms: /\b(?:github|gitlab|leetcode|docker|linux|npm|api|repository|repo|vscode|typescript|python)\b|代码|开发|编程|接口|开源/i },
  { title: "AI 工具", en: "AI Tools", color: "pink", terms: /\b(?:chatgpt|claude|gemini|deepseek|qwen|llm|prompt|ai tools?)\b|人工智能|智能助手|大模型|模型服务/i },
  { title: "阅读与资料", en: "Reading & Reference", color: "orange", terms: /\b(?:wiki|documentation|docs|tutorial|guide)\b|文档|教程|百科|指南|资料/i }
];

const PROJECT_STOPWORDS = new Set([
  "about", "account", "audio", "baidu", "bilibili", "blog", "caption", "captions", "cloud", "code", "com", "console", "dashboard",
  "dev", "docs", "documentation", "download", "example", "files", "github", "google", "guide",
  "home", "index", "login", "management", "model", "netlify", "official", "online", "page",
  "pages", "platform", "project", "projects", "prompt", "prompts", "search", "service",
  "settings", "site", "sites", "speech", "streaming", "tools", "transcription", "vercel", "video", "voice", "website", "youtube"
]);

const REVIEW_TITLES = new Set(["待核对", "review"]);
const HOSTED_PLATFORMS = ["netlify.app", "vercel.app", "github.io", "pages.dev"];
const PLATFORM_GROUP = /\b(?:netlify|vercel|cloudflare|deployment|deploy|hosting|dns)\b|部署|域名|托管/i;
const PLATFORM_TASK = /\b(?:dashboard|deployment|deploy|hosting|dns|domain)\b|部署|域名|托管|控制台/i;
const API_GROUP = /^(?:API 服务|API Services)$/i;
const API_SERVICE_TITLE = /\b(?:any\s?router|newapi|tavily\s+api\s+platform)\b/i;
const SPEECH_SIGNAL = /\b(?:tts|asr|speech|transcri(?:be|ption)|whisper|cocap)\b|(?:index|fun|firered)\s?(?:tts|asr)|语音|字幕|转写|转录|音频|配音/i;

function isReviewGroup(group) {
  return REVIEW_TITLES.has(String(group.title).trim().toLowerCase());
}

function distinctiveTokens(title) {
  return [...new Set([...String(title).matchAll(/[A-Za-z][A-Za-z0-9-]{4,}/g)]
    .map(match => match[0].toLowerCase())
    .filter(token => !PROJECT_STOPWORDS.has(token)))];
}

function comparableTitle(title) {
  return String(title).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function correctionKey(tab) {
  const host = tab?.host || hostnameOf(tab?.url);
  const title = comparableTitle(tab?.title || "");
  return host && title.length >= 3 ? `${host}|${title.slice(0, 120)}` : "";
}

export function applyLearnedCorrections(rawGroups, tabs, corrections = [], { language = "auto" } = {}) {
  const groups = completeSuggestions(rawGroups, tabs, { language });
  const learned = new Map((Array.isArray(corrections) ? corrections : []).filter(item => item && typeof item.key === "string"
    && typeof item.title === "string" && item.title.trim())
    .map(item => [item.key, item.title.trim().slice(0, 24)]));
  if (!learned.size) return { groups, appliedCount: 0 };
  const eligible = tabs.filter(isEligibleTab).map(safeTab);
  let appliedCount = 0;
  for (const tab of eligible) {
    const targetTitle = learned.get(correctionKey(tab));
    if (!targetTitle) continue;
    const source = groups.find(group => group.tabIds.includes(tab.id));
    if (!source || source.title === targetTitle) continue;
    let target = groups.find(group => group.title.toLocaleLowerCase() === targetTitle.toLocaleLowerCase());
    if (target === source) continue;
    if (!target) {
      if (groups.length >= 24) continue;
      target = { title: targetTitle, color: REVIEW_TITLES.has(targetTitle.toLowerCase())
        ? "grey" : source.color === "grey" ? "blue" : source.color, tabIds: [] };
      groups.push(target);
    }
    source.tabIds = source.tabIds.filter(id => id !== tab.id);
    target.tabIds.push(tab.id);
    appliedCount++;
  }
  return { groups: mergeSameTitleGroups(groups.filter(group => group.tabIds.length)), appliedCount };
}

function mergeSameTitleGroups(groups) {
  const merged = new Map();
  for (const group of groups) {
    const key = isReviewGroup(group) ? "__review__" : group.title.trim().toLocaleLowerCase();
    if (merged.has(key)) merged.get(key).tabIds.push(...group.tabIds);
    else merged.set(key, group);
  }
  return [...merged.values()];
}

function isApiServiceTab(tab) {
  return Boolean(tab && (API_SERVICE_TITLE.test(tab.title)
    || /^(?:newapi|anyrouter|tavily)(?:\.|$)/i.test(tab.host)
    || /(?:^|\.)anyrouter\.top$|(?:^|\.)tavily\.com$/i.test(tab.host)));
}

function isDeploymentConsoleTab(tab) {
  return Boolean(tab && (/^(?:vercel\.com|app\.netlify\.com)$/i.test(tab.host)
    || (/^(?:Netlify|Vercel)$/i.test(tab.title) && /(?:^|\.)(?:netlify|vercel)\.com$/i.test(tab.host))));
}

export function hostnameOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome:") return "chrome";
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

export function siteKey(host) {
  const normalized = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!normalized || normalized === "localhost" || normalized === "chrome" || /^[\d.]+$/.test(normalized)) return normalized;
  const parts = normalized.split(".");
  if (parts.length <= 2) return normalized;
  const suffix = parts.slice(-2).join(".");
  return parts.slice(COMPOUND_SUFFIXES.has(suffix) ? -3 : -2).join(".");
}

export function isEligibleTab(tab) {
  return Number.isInteger(tab?.id)
    && tab.pinned !== true
    && (tab.groupId == null || tab.groupId === -1)
    && (tab.splitViewId == null || tab.splitViewId < 0)
    && Boolean(hostnameOf(tab.url));
}

export function safeTab(tab) {
  const host = hostnameOf(tab.url);
  return {
    id: tab.id,
    title: String(tab.title || host || "无标题").trim().slice(0, 180),
    host,
    index: tab.index
  };
}

function domainLabel(host) {
  const parts = host.split(".");
  const name = parts.length > 1 ? parts[parts.length - 2] : host;
  return name.slice(0, 1).toUpperCase() + name.slice(1, 20);
}

function hostGroupTitle(host, tabs) {
  const titles = tabs.map(tab => tab.title.trim());
  if (titles.length && titles.every(title => title === titles[0]) && titles[0].length <= 24) return titles[0];
  const suffixes = titles.map(title => title.split(/\s[-|·]\s/).at(-1).trim());
  if (suffixes.length && suffixes.every(suffix => suffix === suffixes[0]) && suffixes[0].length >= 2 && suffixes[0].length <= 24) {
    return suffixes[0];
  }
  return domainLabel(host);
}

function siteGroup(site, tabs, index, language = "auto") {
  const known = SITE_NAMES.get(site);
  return {
    title: known ? known[language === "en" ? "en" : "zh"]
      : language === "en" ? domainLabel(site) : hostGroupTitle(site, tabs),
    color: SITE_COLORS.get(site) || GROUP_COLORS[index % 8],
    tabIds: tabs.map(tab => tab.id)
  };
}

function projectGroups(eligible, remaining, language) {
  const tokens = new Map();
  for (const tab of eligible) {
    const seen = new Set();
    for (const match of tab.title.matchAll(/[A-Za-z][A-Za-z0-9-]{3,}/g)) {
      const display = match[0].replace(/\d+$/, "");
      const key = display.toLowerCase();
      if (key.length < 5 || PROJECT_STOPWORDS.has(key) || seen.has(key)) continue;
      seen.add(key);
      if (!tokens.has(key)) tokens.set(key, { display, tabs: [] });
      tokens.get(key).tabs.push(tab);
    }
  }
  return [...tokens.values()]
    .filter(bucket => bucket.tabs.length >= 2 && new Set(bucket.tabs.map(tab => siteKey(tab.host))).size >= 2)
    .sort((a, b) => b.tabs.length - a.tabs.length || b.display.length - a.display.length)
    .flatMap(bucket => {
      const tabs = bucket.tabs.filter(tab => remaining.has(tab.id));
      if (tabs.length < 2 || new Set(tabs.map(tab => siteKey(tab.host))).size < 2) return [];
      tabs.forEach(tab => remaining.delete(tab.id));
      return [{
        title: `${bucket.display} ${language === "en" ? "Projects" : "项目"}`.slice(0, 24),
        color: "blue",
        tabIds: tabs.map(tab => tab.id)
      }];
    });
}

export function ruleSuggestions(tabs, { basis = "site", language = "auto" } = {}) {
  const eligible = tabs.filter(isEligibleTab).map(safeTab).sort((a, b) => a.index - b.index);
  const remaining = new Set(eligible.map(tab => tab.id));
  const groups = [];
  const sites = new Map();
  for (const tab of eligible) {
    const key = siteKey(tab.host);
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push(tab);
  }
  if (basis === "site") {
    const siteBuckets = [...sites].filter(([, siteTabs]) => siteTabs.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || a[1][0].index - b[1][0].index)
      .slice(0, 23);
    for (const [key, siteTabs] of siteBuckets) {
      groups.push(siteGroup(key, siteTabs, groups.length, language));
      siteTabs.forEach(tab => remaining.delete(tab.id));
    }
  } else {
    groups.push(...projectGroups(eligible, remaining, language));
  }
  const priorityGroups = new Set(groups);
  for (const topic of TOPICS) {
    const ids = eligible.filter(tab => remaining.has(tab.id) && topic.terms.test(`${tab.title} ${tab.host}`)).map(tab => tab.id);
    if (ids.length < 2) continue;
    groups.push({ title: language === "en" ? topic.en : topic.title, color: topic.color, tabIds: ids });
    ids.forEach(id => remaining.delete(id));
  }

  const hostBuckets = new Map();
  for (const tab of eligible.filter(tab => remaining.has(tab.id))) {
    const key = siteKey(tab.host);
    const bucket = hostBuckets.get(key) || [];
    bucket.push(tab);
    hostBuckets.set(key, bucket);
  }
  for (const [host, hostTabs] of hostBuckets) {
    if (hostTabs.length < 2) continue;
    groups.push(siteGroup(host, hostTabs, groups.length, language));
    hostTabs.forEach(tab => remaining.delete(tab.id));
  }

  const order = new Map(eligible.map((tab, i) => [tab.id, i]));
  const firstIndex = group => Math.min(...group.tabIds.map(id => order.get(id)));
  groups.sort((a, b) => firstIndex(a) - firstIndex(b));
  const selected = [
    ...groups.filter(group => priorityGroups.has(group)),
    ...groups.filter(group => !priorityGroups.has(group))
  ].slice(0, 23).sort((a, b) => firstIndex(a) - firstIndex(b));
  const selectedIds = new Set(selected.flatMap(group => group.tabIds));
  const uncertain = eligible.map(tab => tab.id).filter(id => !selectedIds.has(id));
  if (uncertain.length) selected.push({ title: language === "en" ? "Review" : "待核对", color: "grey", tabIds: uncertain });
  return { groups: selected, unassignedIds: [] };
}

export function cohereSiteGroups(rawGroups, tabs, { language = "auto" } = {}) {
  const groups = completeSuggestions(rawGroups, tabs, { language });
  const eligible = tabs.filter(isEligibleTab).map(safeTab).sort((a, b) => a.index - b.index);
  const sites = new Map();
  for (const tab of eligible) {
    const key = siteKey(tab.host);
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push(tab);
  }
  const buckets = [...sites].filter(([, siteTabs]) => siteTabs.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[1][0].index - b[1][0].index)
    .slice(0, 23);
  const siteIds = new Set(buckets.flatMap(([, siteTabs]) => siteTabs.map(tab => tab.id)));
  const siteGroups = buckets.map(([key, siteTabs], index) => siteGroup(key, siteTabs, index, language));
  let remaining = groups.map(group => ({
    ...group,
    tabIds: group.tabIds.filter(id => !siteIds.has(id))
  })).filter(group => group.tabIds.length);
  const maxRemaining = 24 - siteGroups.length;
  if (remaining.length > maxRemaining) {
    const keep = remaining.slice(0, maxRemaining - 1);
    const overflow = remaining.slice(maxRemaining - 1).flatMap(group => group.tabIds);
    remaining = [...keep, { title: language === "en" ? "Review" : "待核对", color: "grey", tabIds: overflow }];
  }
  const order = new Map(eligible.map((tab, index) => [tab.id, index]));
  const firstIndex = group => Math.min(...group.tabIds.map(id => order.get(id)));
  return completeSuggestions([...siteGroups, ...remaining].sort((a, b) => firstIndex(a) - firstIndex(b)), tabs, { language });
}

export function validateSuggestions(rawGroups, tabs) {
  const allowed = new Set(tabs.filter(isEligibleTab).map(tab => tab.id));
  const used = new Set();
  const groups = [];
  if (!Array.isArray(rawGroups)) return groups;
  for (const raw of rawGroups.slice(0, 24)) {
    if (!raw || !Array.isArray(raw.tabIds)) continue;
    const ids = [];
    for (const id of raw.tabIds) {
      if (Number.isInteger(id) && allowed.has(id) && !used.has(id) && !ids.includes(id)) ids.push(id);
    }
    if (!ids.length) continue;
    const title = String(raw.title || "").trim().replace(/[\r\n\t]/g, " ").slice(0, 24);
    if (!title) continue;
    ids.forEach(id => used.add(id));
    groups.push({ title, color: GROUP_COLORS.includes(raw.color) ? raw.color : "blue", tabIds: ids });
    if (groups.length >= 24) break;
  }
  return groups;
}

export function completeSuggestions(rawGroups, tabs, { language = "auto" } = {}) {
  const groups = validateSuggestions(rawGroups, tabs);
  const used = new Set(groups.flatMap(group => group.tabIds));
  const missing = tabs.filter(isEligibleTab).map(tab => tab.id).filter(id => !used.has(id));
  if (missing.length) {
    const reviewTitle = language === "en" ? "Review" : "待核对";
    const fallback = groups.find(isReviewGroup);
    if (fallback) fallback.tabIds.push(...missing);
    else if (groups.length < 24) groups.push({ title: reviewTitle, color: "grey", tabIds: missing });
    else {
      const overflow = groups.pop();
      groups.push({ title: reviewTitle, color: "grey", tabIds: [...overflow.tabIds, ...missing] });
    }
  }
  return groups;
}

export function repairTopicSuggestions(rawGroups, tabs, { language = "auto" } = {}) {
  const eligible = tabs.filter(isEligibleTab).map(safeTab);
  const byId = new Map(eligible.map(tab => [tab.id, tab]));
  const validated = validateSuggestions(rawGroups, tabs);
  const modelReviewIds = new Set(validated.filter(isReviewGroup).flatMap(group => group.tabIds));
  const used = new Set(validated.flatMap(group => group.tabIds));
  const omittedIds = new Set(eligible.map(tab => tab.id).filter(id => !used.has(id)));
  const capacityReviewIds = new Set();
  if (omittedIds.size && validated.length === 24 && !validated.some(isReviewGroup)) {
    validated.at(-1).tabIds.forEach(id => capacityReviewIds.add(id));
  }
  const groups = mergeSameTitleGroups(completeSuggestions(rawGroups, tabs, { language }));
  const reviewTitle = language === "en" ? "Review" : "待核对";
  const modelReview = groups.find(isReviewGroup);
  if (modelReview) modelReview.title = reviewTitle;
  const hostedReviewIds = new Set();
  const misplacedReviewIds = new Set();
  let review = groups.find(isReviewGroup);
  const originalReview = new Set(review?.tabIds || []);
  let clusteredCount = 0;

  for (const group of groups.filter(group => !isReviewGroup(group) && PLATFORM_GROUP.test(group.title))) {
    const misplaced = group.tabIds.filter(id => {
      const tab = byId.get(id);
      const hostedBusinessPage = tab && HOSTED_PLATFORMS.some(domain => tab.host.endsWith(`.${domain}`))
        && !PLATFORM_TASK.test(tab.title);
      if (hostedBusinessPage) hostedReviewIds.add(id);
      return hostedBusinessPage || isApiServiceTab(tab);
    });
    if (!misplaced.length) continue;
    group.tabIds = group.tabIds.filter(id => !misplaced.includes(id));
    misplaced.forEach(id => misplacedReviewIds.add(id));
  }
  for (const empty of groups.filter(group => !group.tabIds.length)) groups.splice(groups.indexOf(empty), 1);
  if (misplacedReviewIds.size) {
    if (!review) {
      review = { title: reviewTitle, color: "grey", tabIds: [] };
      if (groups.length === 24) {
        const overflow = groups.pop();
        overflow.tabIds.forEach(id => capacityReviewIds.add(id));
        review.tabIds.push(...overflow.tabIds);
      }
      groups.push(review);
    }
    review.tabIds.push(...misplacedReviewIds);
  }

  const assigned = groups.filter(group => !isReviewGroup(group) && group.tabIds.length);
  const order = new Map(eligible.map((tab, index) => [tab.id, index]));
  if (review) {
    const apiIds = review.tabIds.filter(id => isApiServiceTab(byId.get(id)));
    let apiGroup = assigned.find(group => API_GROUP.test(group.title));
    if (!apiGroup && apiIds.length >= 2 && groups.length < 24) {
      apiGroup = { title: language === "en" ? "API Services" : "API 服务", color: "green", tabIds: [] };
      groups.push(apiGroup);
      assigned.push(apiGroup);
    }
    if (apiGroup) {
      apiGroup.tabIds.push(...apiIds);
      review.tabIds = review.tabIds.filter(id => !apiIds.includes(id));
    }

    const deploymentGroups = assigned.filter(group => PLATFORM_GROUP.test(group.title));
    if (deploymentGroups.length === 1) {
      const deploymentGroup = deploymentGroups[0];
      const deploymentIds = review.tabIds.filter(id => isDeploymentConsoleTab(byId.get(id)));
      deploymentGroup.tabIds.push(...deploymentIds);
      review.tabIds = review.tabIds.filter(id => !deploymentIds.includes(id));
      const members = deploymentGroup.tabIds.map(id => byId.get(id)).filter(Boolean);
      if (members.some(tab => /(?:^|\.)netlify\.com$/i.test(tab.host))
        && members.some(tab => /(?:^|\.)vercel\.com$/i.test(tab.host))) {
        deploymentGroup.title = language === "en" ? "Deployment & Domains" : "网站部署与域名";
      }
    }

    for (const id of [...review.tabIds]) {
      const candidate = byId.get(id);
      if (!candidate) continue;
      const title = comparableTitle(candidate.title);
      const tokens = distinctiveTokens(candidate.title);
      const matches = assigned.filter(group => group.tabIds.some(memberId => {
        const member = byId.get(memberId);
        if (!member) return false;
        const sameTitle = title.length >= 8 && siteKey(candidate.host) === siteKey(member.host)
          && title === comparableTitle(member.title);
        return sameTitle || tokens.some(token => distinctiveTokens(member.title).includes(token));
      }));
      if (matches.length !== 1) continue;
      matches[0].tabIds.push(id);
      review.tabIds = review.tabIds.filter(reviewId => reviewId !== id);
    }

    // Identical pages can remain in Review when the model put every copy there.
    const duplicateBuckets = new Map();
    for (const id of review.tabIds) {
      const tab = byId.get(id);
      const title = comparableTitle(tab?.title);
      if (!tab?.host || title.length < 3) continue;
      const key = `${tab.host}|${title}`;
      const bucket = duplicateBuckets.get(key) || [];
      bucket.push(id);
      duplicateBuckets.set(key, bucket);
    }
    for (const ids of duplicateBuckets.values()) {
      if (ids.length < 2 || groups.length >= 24 && review.tabIds.length > ids.length) continue;
      const tabsInBucket = ids.map(id => byId.get(id));
      const title = hostGroupTitle(tabsInBucket[0].host, tabsInBucket).slice(0, 24);
      if (!title || isReviewGroup({ title })) continue;
      const group = { title, color: GROUP_COLORS[groups.length % 8], tabIds: [...ids] };
      groups.push(group);
      assigned.push(group);
      review.tabIds = review.tabIds.filter(id => !ids.includes(id));
      clusteredCount += ids.length;
    }
  }

  for (const group of assigned) {
    const members = group.tabIds.map(id => byId.get(id)).filter(Boolean);
    const titleTokens = distinctiveTokens(group.title);
    const tooNarrow = members.length >= 3 && titleTokens.some(token =>
      members.filter(tab => distinctiveTokens(tab.title).includes(token)).length < members.length / 2);
    const speechMembers = members.filter(tab => SPEECH_SIGNAL.test(tab.title)).length;
    if (tooNarrow && speechMembers >= Math.ceil(members.length / 2)) {
      group.title = language === "en" ? "Speech & Audio" : "语音与音频";
    }
  }

  for (const group of groups) group.tabIds.sort((a, b) => order.get(a) - order.get(b));
  const finalGroups = mergeSameTitleGroups(groups.filter(group => group.tabIds.length));
  for (const group of finalGroups) group.tabIds.sort((a, b) => order.get(a) - order.get(b));
  const finalReview = new Set(finalGroups.find(isReviewGroup)?.tabIds || []);
  return {
    groups: finalGroups,
    diagnostics: {
      reviewCount: finalReview.size,
      modelReviewCount: [...modelReviewIds].filter(id => finalReview.has(id)).length,
      omittedCount: [...omittedIds].filter(id => finalReview.has(id)).length,
      hostedCount: [...hostedReviewIds].filter(id => finalReview.has(id)).length,
      capacityCount: [...capacityReviewIds].filter(id => finalReview.has(id)).length,
      recoveredCount: [...originalReview].filter(id => !finalReview.has(id)).length,
      clusteredCount
    }
  };
}

export function applyReviewPass(initial, rawPass, tabs, { language = "auto" } = {}) {
  const groups = completeSuggestions(initial.groups, tabs, { language });
  const review = groups.find(isReviewGroup);
  const eligible = new Map(tabs.filter(isEligibleTab).map(safeTab).map(tab => [tab.id, tab]));
  const reviewIds = new Set(review?.tabIds || []);
  let recovered = 0;
  let newGroupCount = 0;
  let renamedCount = 0;
  const confidence = item => Number(item?.confidence) >= 0.9 && Number(item?.confidence) <= 1;
  const cleanTitle = value => String(value || "").trim().replace(/[\r\n\t]/g, " ").slice(0, 24);
  const findGroup = title => groups.find(group => !isReviewGroup(group) && group.title.toLocaleLowerCase() === title.toLocaleLowerCase());
  for (const move of Array.isArray(rawPass?.moves) ? rawPass.moves : []) {
    const target = findGroup(cleanTitle(move?.targetTitle));
    if (!confidence(move) || !reviewIds.has(move.tabId) || !target) continue;
    const tab = eligible.get(move.tabId);
    if (tab && HOSTED_PLATFORMS.some(domain => tab.host.endsWith(`.${domain}`))
      && PLATFORM_GROUP.test(target.title) && !PLATFORM_TASK.test(tab.title)) continue;
    reviewIds.delete(move.tabId);
    target.tabIds.push(move.tabId);
    recovered++;
  }
  for (const proposal of Array.isArray(rawPass?.newGroups) ? rawPass.newGroups : []) {
    if (!confidence(proposal) || !Array.isArray(proposal.tabIds)) continue;
    const ids = [...new Set(proposal.tabIds)].filter(id => reviewIds.has(id));
    const title = cleanTitle(proposal.title);
    if (ids.length < 2 || !title || isReviewGroup({ title })
      || groups.length >= 24 && reviewIds.size > ids.length || findGroup(title)) continue;
    if (PLATFORM_GROUP.test(title) && ids.some(id => {
      const tab = eligible.get(id);
      return tab && HOSTED_PLATFORMS.some(domain => tab.host.endsWith(`.${domain}`))
        && !PLATFORM_TASK.test(tab.title);
    })) continue;
    groups.push({ title, color: GROUP_COLORS.includes(proposal.color) ? proposal.color : "blue", tabIds: ids });
    ids.forEach(id => reviewIds.delete(id));
    recovered += ids.length;
    newGroupCount++;
  }
  for (const proposal of Array.isArray(rawPass?.renames) ? rawPass.renames : []) {
    const from = cleanTitle(proposal?.from);
    const to = cleanTitle(proposal?.to);
    const group = findGroup(from);
    if (!confidence(proposal) || !group || !to || to === from || isReviewGroup({ title: to }) || findGroup(to)) continue;
    const members = group.tabIds.map(id => eligible.get(id)).filter(Boolean);
    const narrowTokens = distinctiveTokens(to);
    if (members.length >= 3 && members.filter(tab => SPEECH_SIGNAL.test(tab.title)).length >= Math.ceil(members.length / 2)
      && narrowTokens.some(token => members.filter(tab => distinctiveTokens(tab.title).includes(token)).length < members.length / 2)) continue;
    group.title = to;
    renamedCount++;
  }
  if (review) review.tabIds = [...reviewIds];
  const finalGroups = mergeSameTitleGroups(groups.filter(group => group.tabIds.length));
  const order = new Map([...eligible.keys()].map((id, index) => [id, index]));
  for (const group of finalGroups) group.tabIds.sort((a, b) => order.get(a) - order.get(b));
  const finalReview = new Set(finalGroups.find(isReviewGroup)?.tabIds || []);
  const diagnostics = { ...(initial.diagnostics || {}), reviewCount: finalReview.size,
    secondPassRecoveredCount: recovered, secondPassNewGroupCount: newGroupCount, renamedCount };
  return { groups: finalGroups, diagnostics };
}
