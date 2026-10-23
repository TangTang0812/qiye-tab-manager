import test from "node:test";
import assert from "node:assert/strict";
import { applyLearnedCorrections, applyReviewPass, cohereSiteGroups, completeSuggestions, correctionKey, isEligibleTab, repairTopicSuggestions, ruleSuggestions, siteKey, validateSuggestions } from "../core.js";
import { aiSuggestions, buildSystemPrompt, endpointOriginPattern, listAIModels, parseAIResponse, rememberApiKeyRequirement, resolveApiEndpoints, testAIConnection } from "../ai.js";

const tab = (id, title, host, index, extra = {}) => ({
  id, title, url: `https://${host}/private/path?token=secret`, index, groupId: -1, pinned: false, ...extra
});

test("a new keyless endpoint clears a missing key requirement without forgetting the old endpoint's key", () => {
  const previous = { endpoint: "https://old.example/v1", hadApiKey: true };
  assert.equal(rememberApiKeyRequirement({ endpoint: previous.endpoint, apiKey: "" }, previous, ""), true);
  assert.equal(rememberApiKeyRequirement({ endpoint: "http://127.0.0.1:11434/v1", apiKey: "" }, previous, ""), false);
  assert.equal(rememberApiKeyRequirement({ endpoint: "https://new.example/v1", apiKey: "new-key" }, previous, ""), true);
  assert.equal(rememberApiKeyRequirement({ endpoint: previous.endpoint, apiKey: "" }, previous, "old-key"), false);
});

test("ungrouped web and Chrome pages are eligible; protected tabs are not", () => {
  assert.equal(isEligibleTab(tab(1, "Example", "example.com", 0)), true);
  assert.equal(isEligibleTab(tab(2, "Pinned", "example.com", 1, { pinned: true })), false);
  assert.equal(isEligibleTab(tab(3, "Existing group", "example.com", 2, { groupId: 8 })), false);
  assert.equal(isEligibleTab(tab(4, "Split", "example.com", 3, { splitViewId: 4 })), false);
  assert.equal(isEligibleTab({ ...tab(5, "Settings", "example.com", 4), url: "chrome://settings" }), true);
  assert.equal(isEligibleTab({ ...tab(6, "Organizer", "example.com", 5), url: "chrome-extension://abc/popup.html" }), false);
});

test("offline suggestions cover all tabs and mark uncertain ones", () => {
  const tabs = [
    tab(1, "IndexTTS 模型", "github.com", 0),
    tab(2, "语音转写工具", "speech.example", 1),
    tab(3, "夸克网盘分享", "pan.quark.cn", 2),
    tab(4, "云盘文件", "drive.google.com", 3),
    tab(5, "天气", "weather.example", 4)
  ];
  const result = ruleSuggestions(tabs);
  assert.deepEqual(result.groups.map(group => group.title), ["语音与字幕", "网盘与文件", "待核对"]);
  assert.deepEqual(result.groups.map(group => group.tabIds), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(result.unassignedIds, []);
});

test("model suggestions cannot include ineligible, repeated, or invented IDs", () => {
  const tabs = [
    tab(1, "A", "a.example", 0),
    tab(2, "B", "b.example", 1),
    tab(3, "Pinned", "c.example", 2, { pinned: true }),
    tab(4, "D", "d.example", 3)
  ];
  const result = validateSuggestions([
    { title: "开发\n资料", color: "purple", tabIds: [1, 2, 3, 99, 1] },
    { title: "重复", color: "bogus", tabIds: [2, 4] },
    { title: "单个", color: "blue", tabIds: [4] }
  ], tabs);
  assert.deepEqual(result, [
    { title: "开发 资料", color: "purple", tabIds: [1, 2] },
    { title: "重复", color: "blue", tabIds: [4] }
  ]);
});

test("more than twelve topic or host buckets still cover every eligible tab once", () => {
  const tabs = Array.from({ length: 68 }, (_, index) => tab(index + 1, `Page ${index}`, `site${Math.floor(index / 2)}.example`, index));
  const groups = ruleSuggestions(tabs).groups;
  const ids = groups.flatMap(group => group.tabIds);
  assert.equal(groups.length <= 24, true);
  assert.equal(ids.length, tabs.length);
  assert.equal(new Set(ids).size, tabs.length);
  assert.equal(groups.at(-1).title, "待核对");
});

test("model omissions are assigned to a review group", () => {
  const tabs = [tab(1, "A", "a.example", 0), tab(2, "B", "b.example", 1), tab(3, "C", "c.example", 2)];
  assert.deepEqual(completeSuggestions([{ title: "项目", color: "green", tabIds: [1, 2] }], tabs), [
    { title: "项目", color: "green", tabIds: [1, 2] },
    { title: "待核对", color: "grey", tabIds: [3] }
  ]);
});

test("topic repair rejoins matching project and duplicate pages without merging unrelated tabs", () => {
  const tabs = [
    tab(1, "IndexTTS 百度网盘资源", "pan.baidu.com", 0),
    tab(2, "IndexTTS 百度网盘资源", "pan.baidu.com", 1),
    tab(3, "CutAgent 语音工具", "cutagent.example", 2),
    tab(4, "CutAgent 首页", "cutagent.example", 3),
    tab(5, "其他资源", "pan.baidu.com", 4)
  ];
  const result = repairTopicSuggestions([
    { title: "IndexTTS 资料", color: "purple", tabIds: [1] },
    { title: "CutAgent 工具", color: "pink", tabIds: [3] },
    { title: "待核对", color: "grey", tabIds: [2, 4, 5] }
  ], tabs);
  assert.deepEqual(result.groups.map(group => group.tabIds), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(result.diagnostics, {
    reviewCount: 1, modelReviewCount: 1, omittedCount: 0, hostedCount: 0, capacityCount: 0, recoveredCount: 2, clusteredCount: 0
  });
});

test("hosted business pages leave deployment groups and omissions remain traceable", () => {
  const tabs = [
    tab(1, "Netlify 控制台", "app.netlify.com", 0),
    tab(2, "租车预订", "car-rental.netlify.app", 1),
    tab(3, "Vercel 部署", "vercel.com", 2),
    tab(4, "无关页面", "misc.example", 3)
  ];
  const result = repairTopicSuggestions([
    { title: "Netlify 与域名配置", color: "cyan", tabIds: [1, 2, 3] },
    { title: "Review", color: "grey", tabIds: [] }
  ], tabs);
  assert.deepEqual(result.groups.map(group => group.tabIds), [[1, 3], [2, 4]]);
  assert.deepEqual(result.diagnostics, {
    reviewCount: 2, modelReviewCount: 0, omittedCount: 1, hostedCount: 1, capacityCount: 0, recoveredCount: 0, clusteredCount: 0
  });
});

test("a speech group spanning several products gets a broader title", () => {
  const tabs = [
    tab(1, "IndexTTS 语音合成", "example.org", 0),
    tab(2, "FireRedASR 语音识别", "example.net", 1),
    tab(3, "FunASR 转写", "example.com", 2),
    tab(4, "CoCap 字幕", "example.info", 3)
  ];
  const result = repairTopicSuggestions([
    { title: "IndexTTS 语音合成与转写", color: "purple", tabIds: [1, 2, 3, 4] }
  ], tabs, { language: "zh" });
  assert.equal(result.groups[0].title, "语音与音频");
  assert.equal(result.diagnostics.reviewCount, 0);
  const broad = repairTopicSuggestions([
    { title: "Speech & Audio", color: "purple", tabIds: [1, 2, 3, 4] }
  ], tabs);
  assert.equal(broad.groups[0].title, "Speech & Audio");
});

test("topic repair merges duplicate speech names and separates API services from deployment", () => {
  const tabs = [
    tab(1, "IndexTTS 语音合成", "speech.example", 0),
    tab(2, "TTS 评测", "docs.example", 1),
    tab(3, "FireRedASR 字幕转写", "asr.example", 2),
    tab(4, "FunASR 字幕转写", "cutagent.example", 3),
    tab(5, "iTang", "newapi.example", 4),
    tab(6, "Any Router", "anyrouter.top", 5),
    tab(7, "Tavily API Platform", "app.tavily.com", 6),
    tab(8, "Domain management | Netlify", "app.netlify.com", 7),
    tab(9, "Netlify 自定义域名教程", "docs.example", 8),
    tab(10, "Vercel", "vercel.com", 9),
    tab(11, "租车合集 · 优惠导览", "rental.netlify.app", 10),
    tab(12, "追踪 | UPS", "ups.com", 11)
  ];
  const result = repairTopicSuggestions([
    { title: "IndexTTS 语音合成与转写", color: "purple", tabIds: [1, 3, 4] },
    { title: "语音与音频", color: "purple", tabIds: [2] },
    { title: "Netlify", color: "cyan", tabIds: [5, 8, 9, 11] },
    { title: "待核对", color: "grey", tabIds: [6, 7, 10, 12] }
  ], tabs);
  assert.deepEqual(result.groups.map(group => [group.title, group.tabIds]), [
    ["语音与音频", [1, 2, 3, 4]],
    ["网站部署与域名", [8, 9, 10]],
    ["待核对", [11, 12]],
    ["API 服务", [5, 6, 7]]
  ]);
  assert.deepEqual(result.diagnostics, {
    reviewCount: 2, modelReviewCount: 1, omittedCount: 0, hostedCount: 1, capacityCount: 0, recoveredCount: 3, clusteredCount: 0
  });
});

test("topic repair does not create a speculative API group for one isolated service", () => {
  const tabs = [tab(1, "Any Router", "anyrouter.top", 0), tab(2, "Netlify 域名设置", "app.netlify.com", 1)];
  const result = repairTopicSuggestions([
    { title: "Netlify", color: "cyan", tabIds: [2] },
    { title: "待核对", color: "grey", tabIds: [1] }
  ], tabs);
  assert.equal(result.groups.some(group => group.title === "API 服务"), false);
  assert.deepEqual(result.groups.find(group => group.title === "待核对")?.tabIds, [1]);
});

test("topic repair consolidates bilingual review groups and preserves all tab IDs", () => {
  const tabs = [tab(1, "A", "a.example", 0), tab(2, "B", "b.example", 1), tab(3, "C", "c.example", 2)];
  const result = repairTopicSuggestions([
    { title: "Review", color: "grey", tabIds: [1] },
    { title: "待核对", color: "grey", tabIds: [2] },
    { title: "其他", color: "blue", tabIds: [3] }
  ], tabs, { language: "zh" });
  assert.deepEqual(result.groups.map(group => [group.title, group.tabIds]), [
    ["待核对", [1, 2]], ["其他", [3]]
  ]);
  assert.equal(result.diagnostics.modelReviewCount, 2);
});

test("matching generic titles on unrelated sites do not force a topic merge", () => {
  const tabs = [
    tab(1, "最新动态与公告", "one.example", 0),
    tab(2, "最新动态与公告", "two.example", 1)
  ];
  const result = repairTopicSuggestions([
    { title: "站点一", color: "blue", tabIds: [1] },
    { title: "待核对", color: "grey", tabIds: [2] }
  ], tabs);
  assert.deepEqual(result.groups.map(group => group.tabIds), [[1], [2]]);
});

test("identical same-site pages in Review become their own native topic group", () => {
  const tabs = [
    tab(1, "黑与白公益站", "ai.hybgzs.com", 0),
    tab(2, "黑与白公益站", "ai.hybgzs.com", 1),
    tab(3, "黑与白公益站", "ai.hybgzs.com", 2),
    tab(4, "包裹追踪", "ups.com", 3)
  ];
  const result = repairTopicSuggestions([{ title: "待核对", color: "grey", tabIds: [1, 2, 3, 4] }], tabs);
  assert.deepEqual(result.groups.find(group => group.title === "黑与白公益站")?.tabIds, [1, 2, 3]);
  assert.deepEqual(result.groups.find(group => group.title === "待核对")?.tabIds, [4]);
  assert.equal(result.diagnostics.clusteredCount, 3);
  assert.equal(result.diagnostics.reviewCount, 1);
});

test("review second pass accepts only high-confidence scoped moves and names", () => {
  const tabs = [
    tab(1, "语音项目", "speech.example", 0),
    tab(2, "音频处理", "audio.example", 1),
    tab(3, "专题甲", "one.example", 2),
    tab(4, "专题乙", "two.example", 3),
    tab(5, "租车预订", "rental.netlify.app", 4),
    tab(6, "Netlify 域名", "app.netlify.com", 5)
  ];
  const initial = { groups: [
    { title: "语音", color: "purple", tabIds: [1] },
    { title: "网站部署", color: "cyan", tabIds: [6] },
    { title: "待核对", color: "grey", tabIds: [2, 3, 4, 5] }
  ], diagnostics: { reviewCount: 4, modelReviewCount: 4 } };
  const result = applyReviewPass(initial, {
    moves: [
      { tabId: 2, targetTitle: "语音", confidence: 0.95 },
      { tabId: 5, targetTitle: "网站部署", confidence: 0.99 }
    ],
    newGroups: [{ title: "专题", color: "green", tabIds: [3, 4], confidence: 0.95 }],
    renames: [{ from: "语音", to: "语音与音频", confidence: 0.95 }]
  }, tabs);
  assert.deepEqual(result.groups.find(group => group.title === "语音与音频")?.tabIds, [1, 2]);
  assert.deepEqual(result.groups.find(group => group.title === "专题")?.tabIds, [3, 4]);
  assert.deepEqual(result.groups.find(group => group.title === "待核对")?.tabIds, [5]);
  assert.equal(result.diagnostics.secondPassRecoveredCount, 3);
  assert.equal(result.diagnostics.reviewCount, 1);
  assert.equal(result.groups.flatMap(group => group.tabIds).length, tabs.length);
});

test("review pass cannot relabel a mixed speech group narrowly or turn hosted pages into deployment", () => {
  const tabs = [
    tab(1, "IndexTTS 语音", "one.example", 0),
    tab(2, "FunASR 转写", "two.example", 1),
    tab(3, "FireRedASR 语音", "three.example", 2),
    tab(4, "租车预订", "rental.netlify.app", 3),
    tab(5, "车辆报价", "rental.netlify.app", 4)
  ];
  const initial = { groups: [
    { title: "语音与音频", color: "purple", tabIds: [1, 2, 3] },
    { title: "待核对", color: "grey", tabIds: [4, 5] }
  ], diagnostics: { reviewCount: 2 } };
  const result = applyReviewPass(initial, {
    moves: [],
    newGroups: [{ title: "Netlify 部署", color: "cyan", tabIds: [4, 5], confidence: 0.99 }],
    renames: [{ from: "语音与音频", to: "IndexTTS", confidence: 0.99 }]
  }, tabs);
  assert.deepEqual(result.groups.map(group => group.title), ["语音与音频", "待核对"]);
  assert.equal(result.diagnostics.reviewCount, 2);
});

test("learned corrections are exact to site and title, and never lose tabs", () => {
  const tabs = [
    tab(1, "专题文档", "docs.example", 0),
    tab(2, "专题文档", "other.example", 1),
    tab(3, "另一篇", "docs.example", 2)
  ];
  const groups = [
    { title: "待核对", color: "grey", tabIds: [1, 2] },
    { title: "专题", color: "blue", tabIds: [3] }
  ];
  const key = correctionKey(tabs[0]);
  const result = applyLearnedCorrections(groups, tabs, [{ key, title: "专题" }]);
  assert.deepEqual(result.groups.find(group => group.title === "专题")?.tabIds, [3, 1]);
  assert.deepEqual(result.groups.find(group => group.title === "待核对")?.tabIds, [2]);
  assert.equal(result.appliedCount, 1);
  assert.equal(applyLearnedCorrections(groups, tabs, undefined).appliedCount, 0);
});

test("learned corrections and review clustering respect the 24-group limit", () => {
  const tabs = Array.from({ length: 25 }, (_, index) => tab(index + 1, `Unique ${index}`, `site${index}.example`, index));
  const raw = tabs.slice(0, 23).map(item => ({ title: `Group ${item.id}`, color: "blue", tabIds: [item.id] }));
  raw.push({ title: "待核对", color: "grey", tabIds: [24, 25] });
  const repaired = repairTopicSuggestions(raw, tabs);
  assert.equal(repaired.groups.length, 24);
  const learned = applyLearnedCorrections(repaired.groups, tabs,
    [{ key: correctionKey(tabs[23]), title: "新项目" }]);
  assert.equal(learned.appliedCount, 0);
  assert.equal(learned.groups.length, 24);
  assert.deepEqual(learned.groups.flatMap(group => group.tabIds).sort((a, b) => a - b), tabs.map(item => item.id));
});

test("topic repair keeps full coverage and explains the review group at the 24-group limit", () => {
  const tabs = Array.from({ length: 25 }, (_, index) => tab(index + 1, `Unique ${index}`, `site${index}.example`, index));
  const raw = tabs.slice(0, 24).map(item => ({ title: `Group ${item.id}`, color: "blue", tabIds: [item.id] }));
  const result = repairTopicSuggestions(raw, tabs);
  assert.equal(result.groups.length, 24);
  assert.deepEqual(result.groups.flatMap(group => group.tabIds).sort((a, b) => a - b), tabs.map(item => item.id));
  assert.deepEqual(result.diagnostics, {
    reviewCount: 2, modelReviewCount: 0, omittedCount: 1, hostedCount: 0, capacityCount: 1, recoveredCount: 0, clusteredCount: 0
  });
});

test("omitted tabs at the 24-group limit are not mislabeled as a topic", () => {
  const tabs = Array.from({ length: 25 }, (_, index) => tab(index + 1, `Page ${index}`, `site${index}.example`, index));
  const raw = tabs.slice(0, 24).map(item => ({ title: `Topic ${item.id}`, color: "blue", tabIds: [item.id] }));
  const groups = completeSuggestions(raw, tabs, { language: "en" });
  assert.equal(groups.length, 24);
  assert.deepEqual(groups.at(-1), { title: "Review", color: "grey", tabIds: [24, 25] });
});

test("deployment and API-service tabs get topical groups before fallback", () => {
  const tabs = [
    tab(1, "Vercel", "vercel.com", 0),
    tab(2, "Netlify 自定义域名", "app.netlify.com", 1),
    tab(3, "Any Router", "anyrouter.top", 2),
    tab(4, "NovaCode 控制台", "ai.novacode.top", 3),
    tab(5, "包裹追踪", "ups.com", 4)
  ];
  const groups = ruleSuggestions(tabs).groups;
  assert.deepEqual(groups.map(group => [group.title, group.tabIds]), [
    ["部署与域名", [1, 2]],
    ["API 服务", [3, 4]],
    ["待核对", [5]]
  ]);
});

test("same-site buckets use a shared human-readable site name", () => {
  const tabs = [
    tab(1, "订单查询 - 链动小铺", "shop.wzyp.example", 0),
    tab(2, "我的店铺 - 链动小铺", "shop.wzyp.example", 1),
    tab(3, "黑与白公益站", "ai.hybgzs.example", 2),
    tab(4, "黑与白公益站", "ai.hybgzs.example", 3)
  ];
  assert.deepEqual(ruleSuggestions(tabs).groups.map(group => group.title), ["链动小铺", "黑与白公益站"]);
});

test("site-first rules keep Bilibili subdomains in one native group", () => {
  const tabs = [
    tab(1, "IndexTTS 视频", "www.bilibili.com", 0),
    tab(2, "ASR 视频", "search.bilibili.com", 1),
    tab(3, "消息中心", "message.bilibili.com", 2),
    tab(4, "IndexTTS 文档", "docs.example", 3)
  ];
  const groups = ruleSuggestions(tabs).groups;
  assert.deepEqual(groups.find(group => group.title === "哔哩哔哩"),
    { title: "哔哩哔哩", color: "red", tabIds: [1, 2, 3] });
  assert.equal(groups.flatMap(group => group.tabIds).filter(id => id === 4).length, 1);
  assert.equal(siteKey("a.github.io"), "a.github.io");
  assert.equal(siteKey("b.github.io"), "b.github.io");
});

test("AI site coherence repairs Bilibili pages split across topic groups", () => {
  const tabs = [
    tab(1, "IndexTTS 视频", "www.bilibili.com", 0),
    tab(2, "ASR 视频", "search.bilibili.com", 1),
    tab(3, "消息中心", "message.bilibili.com", 2),
    tab(4, "IndexTTS 项目", "github.com", 3),
    tab(5, "ASR 项目", "github.com", 4)
  ];
  const groups = cohereSiteGroups([
    { title: "语音模型", color: "purple", tabIds: [1, 4] },
    { title: "语音转写", color: "purple", tabIds: [2, 5] },
    { title: "哔哩哔哩", color: "red", tabIds: [3] }
  ], tabs);
  assert.deepEqual(groups.find(group => group.title === "哔哩哔哩")?.tabIds, [1, 2, 3]);
  assert.deepEqual(groups.find(group => group.title === "GitHub")?.tabIds, [4, 5]);
  assert.equal(groups.flatMap(group => group.tabIds).length, 5);
});

test("site-first grouping survives the 24-group limit without losing tabs", () => {
  const tabs = [
    tab(1, "B 站视频", "www.bilibili.com", 24),
    tab(2, "B 站消息", "message.bilibili.com", 25),
    ...Array.from({ length: 24 }, (_, index) => tab(index + 3, `Page ${index}`, `site${index}.example`, index))
  ];
  const rawGroups = tabs.filter(item => item.id !== 2).map(item => ({
    title: `Group ${item.id}`, color: "blue", tabIds: [item.id]
  }));
  const groups = cohereSiteGroups(rawGroups, tabs);
  const ids = groups.flatMap(group => group.tabIds);
  assert.equal(groups.length <= 24, true);
  assert.deepEqual(groups.find(group => group.title === "哔哩哔哩")?.tabIds, [1, 2]);
  assert.deepEqual([...ids].sort((a, b) => a - b), tabs.map(item => item.id).sort((a, b) => a - b));
});

test("local rules prioritize a large same-site bucket near the group limit", () => {
  const tabs = Array.from({ length: 23 }, (_, index) => [
    tab(index * 2 + 1, `Page ${index} A`, `site${index}.example`, index * 2),
    tab(index * 2 + 2, `Page ${index} B`, `site${index}.example`, index * 2 + 1)
  ]).flat();
  tabs.push(tab(47, "视频", "www.bilibili.com", 46));
  tabs.push(tab(48, "搜索", "search.bilibili.com", 47));
  tabs.push(tab(49, "消息", "message.bilibili.com", 48));
  const groups = ruleSuggestions(tabs).groups;
  assert.deepEqual(groups.find(group => group.title === "哔哩哔哩")?.tabIds, [47, 48, 49]);
  assert.equal(groups.flatMap(group => group.tabIds).length, tabs.length);
});

test("topic mode groups a named project across websites and localizes names", () => {
  const tabs = [
    tab(1, "MotionSites prompt gallery", "github.com", 0),
    tab(2, "MotionSites design gallery", "motionsites.com", 1),
    tab(3, "IndexTTS model", "example.org", 2),
    tab(4, "FunASR speech", "example.net", 3)
  ];
  const groups = ruleSuggestions(tabs, { basis: "topic", language: "en" }).groups;
  assert.deepEqual(groups.find(group => group.title === "MotionSites Projects")?.tabIds, [1, 2]);
  assert.deepEqual(groups.find(group => group.title === "Speech Projects")?.tabIds, [3, 4]);
  assert.equal(groups.flatMap(group => group.tabIds).length, tabs.length);
});

test("site mode uses localized site names while topic mode keeps cross-site AI groups", () => {
  const tabs = [
    tab(1, "MotionSites Bilibili tutorial", "www.bilibili.com", 0),
    tab(2, "Bilibili message center", "message.bilibili.com", 1),
    tab(3, "MotionSites GitHub", "github.com", 2)
  ];
  const raw = [
    { title: "MotionSites Projects", color: "blue", tabIds: [1, 3] },
    { title: "Messages", color: "cyan", tabIds: [2] }
  ];
  assert.deepEqual(parseAIResponse(JSON.stringify({ groups: raw }), tabs, { basis: "topic", language: "en" }), raw);
  const siteGroups = parseAIResponse(JSON.stringify({ groups: raw }), tabs, { basis: "site", language: "en" });
  assert.deepEqual(siteGroups.find(group => group.title === "Bilibili")?.tabIds, [1, 2]);
  assert.match(buildSystemPrompt({ basis: "topic", language: "en" }), /different websites.*English/);
  assert.match(buildSystemPrompt({ basis: "site", language: "zh" }), /same site value.*Simplified Chinese/);
});

test("AI response parser accepts fenced JSON and still validates tab IDs", () => {
  const tabs = [tab(1, "A", "a.example", 0), tab(2, "B", "b.example", 1)];
  const result = parseAIResponse('```json\n{"groups":[{"title":"项目","color":"green","tabIds":[1,2,99]}]}\n```', tabs);
  assert.deepEqual(result, [{ title: "项目", color: "green", tabIds: [1, 2] }]);
});

test("AI endpoint accepts HTTPS or loopback HTTP only", () => {
  assert.equal(endpointOriginPattern("https://api.example.com/v1/chat/completions"), "https://api.example.com/*");
  assert.equal(endpointOriginPattern("http://127.0.0.1:11434/v1/chat/completions"), "http://127.0.0.1/*");
  assert.throws(() => endpointOriginPattern("http://public.example.com/api"));
  assert.throws(() => endpointOriginPattern("file:///tmp/secret"));
  assert.throws(() => endpointOriginPattern("https://example.com/v1?key=secret"));
  assert.deepEqual(resolveApiEndpoints("https://api.example.com"), {
    base: "https://api.example.com/v1",
    models: "https://api.example.com/v1/models",
    chat: "https://api.example.com/v1/chat/completions",
    originPattern: "https://api.example.com/*"
  });
  assert.equal(resolveApiEndpoints("https://api.example.com/v1/chat/completions").models,
    "https://api.example.com/v1/models");
  assert.equal(resolveApiEndpoints("https://api.example.com/v1/models").chat,
    "https://api.example.com/v1/chat/completions");
  assert.equal(resolveApiEndpoints("https://api.example.com/api/v1").chat,
    "https://api.example.com/api/v1/chat/completions");
});

test("AI receives titles and hostnames but no URL path or query", async () => {
  const originalFetch = globalThis.fetch;
  let transmitted;
  let requestBody;
  let requestedUrl;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestBody = JSON.parse(options.body);
    transmitted = JSON.stringify(requestBody.messages);
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      async text() { return JSON.stringify({ choices: [{ message: { content: '{"groups":[{"title":"同类","color":"blue","tabIds":[1,2]}]}' } }] }); } };
  };
  try {
    const tabs = [tab(1, "工具一", "example.com", 0), tab(2, "工具二", "example.org", 1)];
    const result = await aiSuggestions(tabs, { endpoint: "https://api.example.net/v1/chat/completions", model: "test" }, "");
    assert.equal(result.groups.length, 1);
    assert.equal(requestedUrl, "https://api.example.net/v1/chat/completions");
    assert.equal(requestBody.model, "test");
    assert.match(transmitted, /example\.com/);
    assert.equal(JSON.parse(requestBody.messages[1].content)[0].site, "example.com");
    assert.doesNotMatch(transmitted, /private\/path|token=secret/);
    assert.equal(Object.hasOwn(requestBody, "temperature"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI never receives pinned or manually grouped tabs, even if the caller includes them", async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  try {
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(JSON.parse(options.body).messages[1].content);
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
        async text() { return JSON.stringify({ choices: [{ message: { content: '{"groups":[{"title":"可整理","color":"blue","tabIds":[1,2,3]}]}' } }] }); } };
    };
    const tabs = [tab(1, "可整理页面", "allowed.example", 0),
      { ...tab(2, "手动分组里的私密页面", "private.example", 1), groupId: 7 },
      { ...tab(3, "固定的私密页面", "pinned.example", 2), pinned: true }];
    const result = await aiSuggestions(tabs, { endpoint: "https://api.example.net/v1", model: "test" }, "");
    assert.deepEqual(sent.map(item => item.id), [1]);
    assert.deepEqual(result.groups.flatMap(group => group.tabIds), [1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI topic mode makes one targeted review request and falls back if it fails", async () => {
  const originalFetch = globalThis.fetch;
  const tabs = [tab(1, "语音教程", "docs.example", 0), tab(2, "音频剪辑", "audio.example", 1)];
  const settings = { endpoint: "https://api.example.net/v1", model: "test", basis: "topic", language: "zh" };
  const first = { choices: [{ message: { content: JSON.stringify({ groups: [
    { title: "语音与音频", color: "purple", tabIds: [1] },
    { title: "待核对", color: "grey", tabIds: [2] }
  ] }) } }] };
  const second = { choices: [{ message: { content: JSON.stringify({
    moves: [{ tabId: 2, targetTitle: "语音与音频", confidence: 0.95 }], newGroups: [], renames: []
  }) } }] };
  let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      if (calls === 2) {
        assert.match(body.messages[1].content, /reviewTabs/);
        assert.doesNotMatch(body.messages[1].content, /private\/path|token=secret/);
      }
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
        async text() { return JSON.stringify(calls === 1 ? first : second); } };
    };
    const result = await aiSuggestions(tabs, settings, "session-key");
    assert.equal(calls, 2);
    assert.deepEqual(result.groups[0].tabIds, [1, 2]);
    assert.equal(result.diagnostics.secondPassRecoveredCount, 1);

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: calls === 1, status: calls === 1 ? 200 : 429,
        headers: new Headers({ "content-type": "application/json" }),
        async text() { return JSON.stringify(calls === 1 ? first : { error: "rate limited" }); } };
    };
    const fallback = await aiSuggestions(tabs, settings, "session-key");
    assert.equal(calls, 2);
    assert.equal(fallback.diagnostics.secondPassFailed, true);
    assert.deepEqual(fallback.groups.find(group => group.title === "待核对")?.tabIds, [2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model discovery uses /v1/models and accepts searchable IDs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.net/v1/models");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer session-key");
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      async text() { return JSON.stringify({ data: [{ id: "z-model" }, { id: "a-model" }, { id: "a-model" }] }); } };
  };
  try {
    assert.deepEqual(await listAIModels("https://api.example.net", "session-key"), ["a-model", "z-model"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("connection test sends a fixed short prompt, never tab data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.net/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "test-model");
    assert.deepEqual(body.messages, [{ role: "user", content: "Reply OK." }]);
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      async text() { return JSON.stringify({ choices: [{ message: { content: "OK" } }] }); } };
  };
  try {
    assert.equal(await testAIConnection("https://api.example.net", "test-model", "session-key"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTML and API errors show actionable messages instead of JSON syntax", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }),
      async text() { return "<!doctype html><html>Home</html>"; } });
    await assert.rejects(() => listAIModels("https://api.example.net", ""), /网页 HTML.*不是 API JSON/);
    globalThis.fetch = async () => ({ ok: false, status: 401, headers: new Headers({ "content-type": "application/json" }),
      async text() { return '{"error":{"message":"private token info"}}'; } });
    await assert.rejects(() => testAIConnection("https://api.example.net", "test-model", ""), /API Key 无效/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
