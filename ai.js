import { applyReviewPass, cohereSiteGroups, isEligibleTab, repairTopicSuggestions, safeTab, siteKey } from "./core.js";

export function resolveApiEndpoints(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || "").trim());
  } catch {
    throw new Error("请输入有效的 API 地址，例如 https://服务地址/v1。");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("API 地址须使用 HTTPS，或本机的 http://127.0.0.1 / localhost。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址不能包含账号、密码、查询参数或 # 片段。");
  }

  let basePath = url.pathname.replace(/\/+$/, "");
  if (basePath.endsWith("/chat/completions")) {
    basePath = basePath.slice(0, -"/chat/completions".length);
  } else if (basePath.endsWith("/models")) {
    basePath = basePath.slice(0, -"/models".length);
  } else if (!basePath) {
    basePath = "/v1";
  }
  const baseUrl = new URL(url.origin);
  baseUrl.pathname = basePath;
  const apiBase = baseUrl.href.replace(/\/$/, "");
  return {
    base: apiBase,
    models: `${apiBase}/models`,
    chat: `${apiBase}/chat/completions`,
    originPattern: `${url.protocol}//${url.hostname}/*`
  };
}

export function endpointOriginPattern(endpoint) {
  return resolveApiEndpoints(endpoint).originPattern;
}

export function rememberApiKeyRequirement({ endpoint, apiKey }, previousSettings = {}, previousSessionKey = "") {
  return Boolean(apiKey) || Boolean(previousSettings.hadApiKey && !previousSessionKey
    && endpoint === previousSettings.endpoint);
}

function statusError(status, action) {
  if (status === 400) return `${action}失败（400）：接口不接受当前参数或模型，请核对 API 类型与模型 ID。`;
  if (status === 401) return `${action}失败（401）：API Key 无效或已过期，请重新填写。`;
  if (status === 403) return `${action}失败（403）：Key 没有权限访问此接口或模型。`;
  if (status === 404) return `${action}失败（404）：未找到 API 路径，请核对基础地址是否以 /v1 等正确路径结尾。`;
  if (status === 429) return `${action}失败（429）：请求次数或额度已达上限，请稍后重试。`;
  if (status >= 500) return `${action}失败（${status}）：接口服务暂时不可用，请稍后重试。`;
  return `${action}失败（HTTP ${status}），请核对接口地址和权限。`;
}

async function readJsonResponse(response, action) {
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() || "";
  const text = await response.text();
  if (contentType.includes("text/html") || /^\s*(?:<!doctype|<html|<head)/i.test(text)) {
    throw new Error(`${action}收到网页 HTML（HTTP ${response.status}），不是 API JSON。请检查 API 基础地址；网站首页不能直接作为接口。`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!response.ok) throw new Error(statusError(response.status, action));
    throw new Error(`${action}收到非 JSON 响应（HTTP ${response.status}），请核对 API 地址与接口类型。`);
  }
  if (!response.ok) throw new Error(statusError(response.status, action));
  return payload;
}

async function requestJson(url, { action, apiKey, method = "GET", body, timeoutMs = 30000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    return await readJsonResponse(response, action);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${action}超时，请检查网络或稍后重试。`);
    if (error instanceof TypeError) throw new Error(`${action}无法连接接口，请检查网络、地址和浏览器访问权限。`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listAIModels(endpoint, apiKey) {
  const urls = resolveApiEndpoints(endpoint);
  const payload = await requestJson(urls.models, { action: "获取模型", apiKey, timeoutMs: 20000 });
  const raw = Array.isArray(payload?.data) ? payload.data : payload?.models;
  if (!Array.isArray(raw)) throw new Error("接口没有返回标准模型列表；可手动输入模型 ID 后测试连接。");
  const models = [...new Set(raw.map(item => typeof item === "string" ? item : item?.id).filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];
  if (!models.length) throw new Error("接口返回的模型列表为空；可手动输入模型 ID 后测试连接。");
  return models.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export async function testAIConnection(endpoint, model, apiKey) {
  const urls = resolveApiEndpoints(endpoint);
  const modelId = String(model || "").trim();
  if (!modelId) throw new Error("请先选择或填写模型 ID。");
  const payload = await requestJson(urls.chat, {
    action: "测试连接",
    apiKey,
    method: "POST",
    body: { model: modelId, messages: [{ role: "user", content: "Reply OK." }] },
    timeoutMs: 30000
  });
  if (!payload?.choices?.[0]?.message) {
    throw new Error("接口已响应，但不是 Chat Completions 格式；请检查 API 类型与模型。");
  }
  return true;
}

function parseJsonObject(content) {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.filter(part => part?.type === "text").map(part => part.text).join("\n") : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回有效的分组 JSON。");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("模型返回的 JSON 无法解析，请重试或换一个模型。");
  }
  return parsed;
}

export function parseAIResult(content, tabs, { basis = "site", language = "auto" } = {}) {
  const parsed = parseJsonObject(content);
  if (basis === "topic") return repairTopicSuggestions(parsed.groups, tabs, { language });
  return { groups: cohereSiteGroups(parsed.groups, tabs, { language }), diagnostics: null };
}

export function parseAIResponse(content, tabs, preferences = {}) {
  return parseAIResult(content, tabs, preferences).groups;
}

export function buildSystemPrompt({ basis = "site", language = "auto" } = {}) {
  const grouping = basis === "topic"
    ? "Group tabs by shared project, task or subject, even when they come from different websites. Use repeated product names and identical page titles as strong relationship signals. Infer concise project/topic names from titles; a title must describe every member, so use a broader topic name when several products share a group. Give every group a distinct name; merge groups with the same topic instead of creating duplicate names. API platforms such as Any Router, Tavily API and a newapi subdomain belong to API services, not deployment or domain management. Official Netlify and Vercel dashboards may share a deployment/domains group, named broadly enough for both. Do not use a website name merely because several tabs share a domain. Tabs from one website may be split only when their subjects truly differ. A subdomain hosted on netlify.app, vercel.app, github.io or pages.dev is an independent website, not necessarily a deployment task; classify it by its page title."
    : "Prioritize website coherence over title topics: tabs with the same site value should form one group, even when their titles cover different topics. Name those groups after the site. Hosted subdomains such as project.netlify.app are independent sites, not the Netlify dashboard.";
  const naming = language === "en" ? "Write group titles in English (preserve brand names)."
    : language === "zh" ? "Write group titles in Simplified Chinese (preserve brand and product names)."
      : "Use the language that best fits each group and its tab titles; preserve brand and product names.";
  const review = language === "en" ? "Review" : "待核对";
  return `Organize all provided Chrome tab IDs exactly once into coherent native tab groups. ${grouping} ${naming} A group may contain one tab. Put unrelated or uncertain tabs into a group titled ${review} with color grey. Use no more than 24 groups, short group titles, and only colors blue, cyan, green, yellow, orange, red, pink, purple, grey. Return JSON only, shaped as {"groups":[{"title":"...","color":"blue","tabIds":[1,2]}]}. Never include explanations.`;
}

function reviewPrompt(language) {
  const naming = language === "en" ? "Use English group names." : language === "zh" ? "Use Simplified Chinese group names." : "Use the language that best fits each group.";
  return `You are performing one conservative second-pass audit of a Chrome tab grouping. Review only the provided uncertain tabs and existing group names. Move an uncertain tab to an existing group only when its title and site clearly support it; otherwise leave it in Review. A new group needs at least two related uncertain tabs. Rename an existing group only when its current title fails to describe its members, and prefer a broader accurate name. Never move a hosted business site into a Netlify/Vercel deployment group merely because of its host suffix. ${naming} Give only high-confidence proposals (confidence 0.9 to 1). Return JSON only: {"moves":[{"tabId":1,"targetTitle":"Existing exact group title","confidence":0.95}],"newGroups":[{"title":"Short title","color":"blue","tabIds":[2,3],"confidence":0.95}],"renames":[{"from":"Existing exact group title","to":"Better title","confidence":0.95}]}. Empty arrays are correct when nothing is clear.`;
}

export async function reviewAISuggestions(tabs, settings, apiKey, firstPass) {
  const reviewGroup = firstPass.groups.find(group => /^(?:待核对|review)$/i.test(group.title));
  if (!reviewGroup?.tabIds.length) return firstPass;
  const byId = new Map(tabs.map(safeTab).map(tab => [tab.id, tab]));
  const reviewTabs = reviewGroup.tabIds.map(id => byId.get(id)).filter(Boolean)
    .map(({ id, title, host }) => ({ id, title, host, site: siteKey(host) }));
  const existingGroups = firstPass.groups.filter(group => group !== reviewGroup).map(group => ({
    title: group.title,
    members: group.tabIds.map(id => byId.get(id)).filter(Boolean)
      .map(({ title, host }) => ({ title, host }))
  }));
  const urls = resolveApiEndpoints(settings.endpoint);
  const payload = await requestJson(urls.chat, {
    action: "AI 复核",
    apiKey,
    method: "POST",
    body: { model: String(settings.model).trim(), messages: [
      { role: "system", content: reviewPrompt(settings.language) },
      { role: "user", content: JSON.stringify({ reviewTabs, existingGroups }) }
    ] },
    timeoutMs: 30000
  });
  const proposed = parseJsonObject(payload?.choices?.[0]?.message?.content);
  return applyReviewPass(firstPass, proposed, tabs, settings);
}

export async function aiSuggestions(tabs, settings, apiKey) {
  const urls = resolveApiEndpoints(settings.endpoint);
  const model = String(settings.model || "").trim();
  if (!model) throw new Error("请先选择或填写模型 ID。");

  const eligible = tabs.filter(isEligibleTab);
  if (!eligible.length) throw new Error("当前窗口没有可整理的标签。");
  const input = eligible.map(safeTab).map(({ id, title, host }) => ({ id, title, host, site: siteKey(host) }));
  const payload = await requestJson(urls.chat, {
    action: "AI 整理",
    apiKey,
    method: "POST",
    body: {
      model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(settings)
        },
        { role: "user", content: JSON.stringify(input) }
      ]
    },
    timeoutMs: 45000
  });
  const result = parseAIResult(payload?.choices?.[0]?.message?.content, eligible, settings);
  if (!result.groups.length) throw new Error("模型没有返回可用的标签分组；可切换到本地规则试试。");
  if (settings.basis !== "topic" || !result.diagnostics?.reviewCount) return result;
  try {
    return await reviewAISuggestions(eligible, settings, apiKey, result);
  } catch {
    return { ...result, diagnostics: { ...result.diagnostics, secondPassFailed: true } };
  }
}
