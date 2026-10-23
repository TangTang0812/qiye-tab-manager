import { applyLearnedCorrections, correctionKey, isEligibleTab, ruleSuggestions, safeTab, validateSuggestions } from "./core.js";
import { aiSuggestions } from "./ai.js";
import { makeUndoOperation, matchUndoOperation, restoredOrderIds } from "./undo-state.js";
import { performanceGroups, performanceTotals, reasonLabel, releaseReason } from "./performance-core.js";

const MENU_ID = "organize-current-window";
const PRESENTATION_KEY = "presentationMode";
const activeWindows = new Set();
const mutatingWindows = new Set();
let correctionQueue = Promise.resolve();

void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});

async function applyPresentationMode(mode) {
  if (!chrome.action?.setPopup) throw new Error("当前 Chrome 不支持切换打开方式。");
  await chrome.action.setPopup({ popup: mode === "popup" ? "popup.html" : "" });
}

async function syncPresentationMode() {
  if (!chrome.action?.setPopup) return;
  const saved = await chrome.storage.local.get(PRESENTATION_KEY);
  await applyPresentationMode(saved[PRESENTATION_KEY] === "popup" ? "popup" : "sidepanel");
}

void syncPresentationMode().catch(() => {});

async function loadOperations(windowId) {
  const [local, session] = await Promise.all([
    chrome.storage.local.get("organizerOperations"),
    chrome.storage.session.get(`lastOperation:${windowId}`)
  ]);
  const operations = Array.isArray(local.organizerOperations) ? local.organizerOperations : [];
  const legacy = session[`lastOperation:${windowId}`];
  return legacy && !operations.some(item => item.id === legacy.id)
    ? [...operations, legacy] : operations;
}

async function resolveUndo(windowId) {
  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const groupIds = [...new Set(tabs.map(tab => tab.groupId).filter(id => id >= 0))];
  const groups = chrome.tabGroups.get
    ? (await Promise.all(groupIds.map(id => chrome.tabGroups.get(id).catch(() => null)))).filter(Boolean)
    : [];
  return await matchUndoOperation(await loadOperations(windowId), tabs, groups, windowId);
}

function scopeModeOf(value) {
  return value === "all" ? "all" : "incremental";
}

async function organizeScope(windowId, scopeMode = "incremental") {
  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const match = await resolveUndo(windowId);
  const ownedIds = new Set(match?.groups.map(group => group.groupId) || []);
  const incremental = tabs.filter(tab => isEligibleTab({ ...tab, groupId: ownedIds.has(tab.groupId) ? -1 : tab.groupId }));
  const all = tabs.filter(tab => isEligibleTab({ ...tab, groupId: -1 }));
  const eligible = scopeModeOf(scopeMode) === "all" ? all : incremental;
  const sourceGroupIds = new Set(eligible.map(tab => tab.groupId).filter(id => Number.isInteger(id) && id >= 0));
  return { tabs, eligible, ownedIds, sourceGroupIds, match,
    incrementalCount: incremental.length, allCount: all.length,
    revisitedCount: incremental.filter(tab => ownedIds.has(tab.groupId)).length };
}

function planningTabs(tabs, eligible) {
  const ids = new Set(eligible.map(tab => tab.id));
  return tabs.map(tab => ids.has(tab.id) ? { ...tab, groupId: -1 } : tab);
}

function queueCorrection(task) {
  correctionQueue = correctionQueue.catch(() => {}).then(task);
  return correctionQueue;
}

async function saveCorrection(tab, title, originalTitle) {
  const key = correctionKey(tab);
  if (!key) return;
  await queueCorrection(async () => {
    const stored = await chrome.storage.local.get("organizerCorrections");
    const corrections = Array.isArray(stored.organizerCorrections) ? stored.organizerCorrections : [];
    const next = corrections.filter(item => item.key !== key);
    if (title && title !== originalTitle) next.push({ key, title: title.slice(0, 24), updatedAt: Date.now() });
    await chrome.storage.local.set({ organizerCorrections: next.slice(-200) });
  });
}

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (!Number.isInteger(changeInfo.groupId) || !Number.isInteger(tab?.windowId)
    || mutatingWindows.has(tab.windowId)) return;
  void (async () => {
    const operation = (await loadOperations(tab.windowId)).find(item => item.windowId === tab.windowId
      && item.created?.some(group => group.tabIds.includes(tabId)));
    const original = operation?.created?.find(group => group.tabIds.includes(tabId));
    if (!original || original.keys?.[tabId] !== correctionKey(tab) || mutatingWindows.has(tab.windowId)) return;
    if (changeInfo.groupId === original.groupId) return;
    if (changeInfo.groupId < 0) return;
    const destination = await chrome.tabGroups.get(changeInfo.groupId);
    if (destination?.title?.trim()) await saveCorrection(tab, destination.title.trim(), original.title);
  })().catch(() => {});
});

chrome.tabGroups.onUpdated?.addListener(group => {
  if (!Number.isInteger(group?.id) || !Number.isInteger(group.windowId)
    || mutatingWindows.has(group.windowId)) return;
  void (async () => {
    const operation = (await loadOperations(group.windowId)).find(item => item.windowId === group.windowId
      && item.created?.some(itemGroup => itemGroup.groupId === group.id));
    const original = operation?.created?.find(item => item.groupId === group.id);
    const title = group.title?.trim();
    if (!original || !title || title === original.title || mutatingWindows.has(group.windowId)) return;
    const tabs = await chrome.tabs.query({ groupId: group.id, windowId: group.windowId });
    for (const tab of tabs.filter(item => original.keys?.[item.id] === correctionKey(item))) {
      await saveCorrection(tab, title, original.title);
    }
  })().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "栖页：整理当前窗口的标签页",
    contexts: ["tab"]
  });
  void syncPresentationMode().catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  void syncPresentationMode().catch(() => {});
});

chrome.action.onClicked?.addListener(tab => {
  if (!Number.isInteger(tab?.windowId)) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (chrome.sidePanel?.open && Number.isInteger(tab?.windowId)) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    await chrome.action.openPopup(Number.isInteger(tab?.windowId) ? { windowId: tab.windowId } : undefined);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !["set-presentation-mode", "organize", "preview", "apply", "undo", "undo-status", "clear-memory", "performance-status", "discard-tabs"].includes(message.type)) return;
  const operation = message.type === "set-presentation-mode"
    ? (async () => {
      if (!["sidepanel", "popup"].includes(message.mode)) throw new Error("无效的打开方式。");
      await applyPresentationMode(message.mode);
      await chrome.storage.local.set({ [PRESENTATION_KEY]: message.mode });
      return { ok: true, mode: message.mode };
    })()
    : message.type === "clear-memory"
    ? queueCorrection(async () => {
      await chrome.storage.local.remove("organizerCorrections");
      return { ok: true };
    })
    : message.type === "undo-status"
      ? organizeScope(message.windowId).then(scope => ({
        ok: true, available: Boolean(scope.match), diagnostics: scope.match?.operation.diagnostics || null,
        restored: Boolean(scope.match?.restored), organizableCount: scope.eligible.length,
        allCount: scope.allCount, revisitedCount: scope.revisitedCount,
        undoScopeMode: scope.match?.operation.scopeMode || "incremental"
      }))
      : message.type === "performance-status"
        ? performanceStatus(message.windowId)
        : runWindowOperation(message);
  operation.then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function runWindowOperation(message) {
  const windowId = message.windowId;
  if (!Number.isInteger(windowId)) throw new Error("没有找到目标窗口。");
  if (activeWindows.has(windowId)) throw new Error("这个窗口正在处理标签，请稍候。");
  activeWindows.add(windowId);
  try {
    if (message.type === "discard-tabs") return await discardTabs(windowId, message.targets);
    if (message.type === "organize") return await organizeWindow(windowId, message.mode, message);
    if (message.type === "preview") return await previewWindow(windowId, message.mode, message);
    if (message.type === "apply") return await applyGroups(windowId, message.groups, message.diagnostics || null,
      message.tabs || null, scopeModeOf(message.scopeMode));
    return await undoGroups(windowId);
  } finally {
    activeWindows.delete(windowId);
  }
}

const performanceJournalKey = windowId => `performanceOperation:${windowId}`;

async function performanceStatus(windowId) {
  if (!Number.isInteger(windowId)) throw new Error("没有找到目标窗口。");
  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const groupIds = [...new Set(tabs.map(tab => tab.groupId).filter(id => Number.isInteger(id) && id >= 0))];
  const nativeGroups = (await Promise.all(groupIds.map(id => chrome.tabGroups.get(id).catch(() => null)))).filter(Boolean);
  const groups = performanceGroups(tabs, nativeGroups);
  const key = performanceJournalKey(windowId);
  const stored = await chrome.storage.session.get(key);
  let operation = stored[key] || null;
  if (operation?.status === "running" && !activeWindows.has(windowId)) {
    operation = { ...operation, status: "interrupted" };
    await chrome.storage.session.set({ [key]: operation });
  }
  return { ok: true, groups, totals: performanceTotals(groups), operation };
}

async function discardTabs(windowId, targets) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 500) {
    throw new Error("请选择 1–500 个可释放的后台标签。");
  }
  const ids = targets.map(target => target?.id);
  if (ids.some(id => !Number.isInteger(id)) || new Set(ids).size !== ids.length
    || targets.some(target => !Number.isInteger(target.groupId) || typeof target.url !== "string")) {
    throw new Error("选择的标签无效，请刷新后重试。");
  }
  const key = performanceJournalKey(windowId);
  const operation = { status: "running", startedAt: Date.now(), requested: targets.length, results: [] };
  await chrome.storage.session.set({ [key]: operation });
  for (const target of targets) {
    let outcome;
    try {
      const tab = await chrome.tabs.get(target.id).catch(() => null);
      if (!tab) outcome = { id: target.id, result: "skipped", reason: "missing" };
      else if (tab.windowId !== windowId) outcome = { id: target.id, result: "skipped", reason: "moved" };
      else if (tab.groupId !== target.groupId || tab.url !== target.url) {
        outcome = { id: target.id, result: "skipped", reason: "changed" };
      } else {
        const reason = releaseReason(tab);
        if (reason) outcome = { id: target.id, result: "skipped", reason };
        else {
          const discarded = await chrome.tabs.discard(target.id);
          outcome = discarded?.discarded
            ? { id: target.id, result: "released" }
            : { id: target.id, result: "failed", reason: "failed" };
        }
      }
    } catch {
      outcome = { id: target.id, result: "failed", reason: "failed" };
    }
    operation.results.push(outcome);
    await chrome.storage.session.set({ [key]: operation });
  }
  const released = operation.results.filter(item => item.result === "released").length;
  const skipped = operation.results.filter(item => item.result === "skipped").length;
  const failed = operation.results.filter(item => item.result === "failed").length;
  const reasons = Object.entries(operation.results.reduce((counts, item) => {
    if (item.reason) counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {})).map(([reason, count]) => ({ reason, label: reasonLabel(reason), count }));
  const summary = { released, skipped, failed, reasons };
  operation.status = "complete";
  operation.summary = summary;
  await chrome.storage.session.set({ [key]: operation });
  return { ok: true, ...summary };
}

async function organizeWindow(windowId, mode, preferences = {}) {
  const plan = await planWindow(windowId, mode, preferences);
  return await applyGroups(windowId, plan.groups, plan.diagnostics, plan.tabs, plan.scopeMode);
}

async function previewWindow(windowId, mode, preferences = {}) {
  const plan = await planWindow(windowId, mode, preferences);
  return { ok: true, groups: plan.groups, tabs: plan.tabs, diagnostics: plan.diagnostics,
    scopeMode: plan.scopeMode };
}

async function planWindow(windowId, mode, preferences = {}) {
  const scopeMode = scopeModeOf(preferences.scopeMode);
  const { eligible } = await organizeScope(windowId, scopeMode);
  if (!eligible.length) throw new Error("当前窗口没有可整理的标签。");
  const candidates = eligible.map(tab => ({ ...tab, groupId: -1 }));
  if (!["rules", "ai"].includes(mode)) throw new Error("请选择整理策略。");
  const local = await chrome.storage.local.get("organizerSettings");
  const settings = local.organizerSettings || {};
  const basis = (preferences.basis || settings.basis) === "topic" ? "topic" : "site";
  const language = ["zh", "en"].includes(preferences.language || settings.language)
    ? preferences.language || settings.language : "auto";
  let groups;
  let diagnostics = null;
  if (mode === "ai") {
    const [localKey, session] = await Promise.all([
      chrome.storage.local.get("organizerApiKey"),
      chrome.storage.session.get("organizerApiKey")
    ]);
    const apiKey = localKey.organizerApiKey || session.organizerApiKey || "";
    if (!settings.endpoint || !settings.model) throw new Error("请先在设置中填写 AI 接口和模型 ID。");
    if (settings.hadApiKey && !apiKey) throw new Error("请在设置中填写并保存 API Key。");
    const result = await aiSuggestions(candidates, { ...settings, basis, language }, apiKey);
    groups = result.groups;
    diagnostics = result.diagnostics;
  } else {
    groups = ruleSuggestions(candidates, { basis, language }).groups;
  }
  if (basis === "topic") {
    const memory = await chrome.storage.local.get("organizerCorrections");
    const learned = applyLearnedCorrections(groups, candidates, memory.organizerCorrections, { language });
    groups = learned.groups;
    if (diagnostics) diagnostics = { ...diagnostics, learnedCount: learned.appliedCount,
      reviewCount: groups.find(group => /^(?:待核对|review)$/i.test(group.title))?.tabIds.length || 0 };
    else if (learned.appliedCount) diagnostics = { learnedCount: learned.appliedCount };
  }
  return { groups, diagnostics, scopeMode,
    tabs: eligible.map(tab => ({ ...safeTab(tab), groupId: tab.groupId })) };
}

async function applyGroups(windowId, proposedGroups, diagnostics = null, expectedTabs = null, scopeMode = "incremental") {
  if (!Number.isInteger(windowId)) throw new Error("没有找到目标窗口。");
  scopeMode = scopeModeOf(scopeMode);
  const scope = await organizeScope(windowId, scopeMode);
  if (expectedTabs) {
    const expected = new Map(expectedTabs.map(tab => [tab.id, tab]));
    const stale = expected.size !== scope.eligible.length || scope.eligible.some(tab => {
      const current = safeTab(tab);
      const prior = expected.get(tab.id);
      return !prior || prior.title !== current.title || prior.host !== current.host
        || (Object.hasOwn(prior, "groupId") && prior.groupId !== tab.groupId);
    });
    if (stale) throw new Error("标签页内容在生成建议后发生了变化，请重新预览或整理。");
  }
  const allTabs = scope.tabs;
  const groups = validateSuggestions(proposedGroups, planningTabs(allTabs, scope.eligible));
  if (!groups.length) throw new Error("没有可应用的分组。请先生成整理建议。");
  const eligibleIds = new Set(scope.eligible.map(tab => tab.id));
  const proposedIds = new Set(groups.flatMap(group => group.tabIds));
  if (eligibleIds.size !== proposedIds.size || [...eligibleIds].some(id => !proposedIds.has(id))) {
    throw new Error("整理方案未覆盖全部可整理标签，或标签页发生了变化。请重试。");
  }

  const originalOrder = allTabs.map(tab => tab.id);
  const previous = await Promise.all([...scope.sourceGroupIds].map(async groupId => {
    const group = await chrome.tabGroups.get(groupId);
    return { groupId, title: group.title || "", color: group.color || "grey",
      tabIds: scope.eligible.filter(tab => tab.groupId === groupId).map(tab => tab.id) };
  }));
  const created = [];
  let savedOperation = null;
  mutatingWindows.add(windowId);
  try {
    for (const group of groups) {
      const fresh = await chrome.tabs.query({ windowId });
      const available = new Set(fresh.filter(tab => eligibleIds.has(tab.id)
        && (tab.groupId === -1 || scope.sourceGroupIds.has(tab.groupId))).map(tab => tab.id));
      const tabIds = group.tabIds.filter(id => available.has(id));
      if (tabIds.length !== group.tabIds.length) throw new Error("标签页在整理过程中发生了变化，已撤销本次操作。请重新生成建议。");
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      created.push({ groupId, tabIds, title: group.title, color: group.color,
        keys: Object.fromEntries(allTabs.filter(tab => tabIds.includes(tab.id)).map(tab => [tab.id, correctionKey(tab)])) });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
    }
    if (!created.length) throw new Error("标签在整理前发生了变化，请重新生成建议。");
    const stored = await chrome.storage.local.get("organizerOperations");
    const history = Array.isArray(stored.organizerOperations) ? stored.organizerOperations : [];
    const timestamp = Math.max(Date.now(), ...history.map(item => Number(item.timestamp) + 1 || 0));
    savedOperation = await makeUndoOperation(windowId, allTabs, created, diagnostics, timestamp);
    savedOperation.previous = previous;
    savedOperation.scopeMode = scopeMode;
    await chrome.storage.local.set({ organizerOperations: [...history, savedOperation].slice(-12) });
    await chrome.storage.session.set({ [`lastOperation:${windowId}`]: savedOperation });
    return { ok: true, groupCount: created.length, tabCount: created.reduce((n, group) => n + group.tabIds.length, 0), diagnostics,
      scopeMode };
  } catch (error) {
    if (savedOperation) {
      try {
        const stored = await chrome.storage.local.get("organizerOperations");
        await chrome.storage.local.set({ organizerOperations: (stored.organizerOperations || []).filter(item => item.id !== savedOperation.id) });
      } catch { /* The rollback below still takes priority if storage is unavailable. */ }
    }
    const affected = await rollbackCreated(created);
    await restorePreviousGroups(windowId, previous, new Map([...affected].map(id => [id, id])));
    await restoreTabOrder(windowId, originalOrder, affected);
    throw error;
  } finally {
    mutatingWindows.delete(windowId);
  }
}

async function restorePreviousGroups(windowId, previous, savedToCurrent, allowExisting = true) {
  let restoredCount = 0;
  for (const group of previous || []) {
    const tabIds = group.tabIds.map(id => savedToCurrent.get(id)).filter(Number.isInteger);
    const current = (await Promise.all(tabIds.map(id => chrome.tabs.get(id).catch(() => null))))
      .filter(tab => tab?.windowId === windowId && tab.groupId === -1).map(tab => tab.id);
    if (!current.length) continue;
    const existing = await chrome.tabGroups.get(group.groupId).catch(() => null);
    if (allowExisting && existing?.windowId === windowId
      && existing.title === group.title && existing.color === group.color) {
      await chrome.tabs.group({ tabIds: current, groupId: group.groupId });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: current, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
    }
    restoredCount += current.length;
  }
  return restoredCount;
}

async function rollbackCreated(created) {
  const affected = new Set();
  for (const group of created) {
    try {
      const tabs = await chrome.tabs.query({ groupId: group.groupId });
      const own = tabs.filter(tab => group.tabIds.includes(tab.id)).map(tab => tab.id);
      if (own.length) {
        await chrome.tabs.ungroup(own);
        own.forEach(id => affected.add(id));
      }
    } catch {
      // A tab may have been closed or moved while the operation was running.
    }
  }
  return affected;
}

async function restoreTabOrder(windowId, originalOrder, affected) {
  for (let index = 0; index < originalOrder.length; index++) {
    const id = originalOrder[index];
    if (!affected.has(id)) continue;
    try {
      const tab = await chrome.tabs.get(id);
      if (tab.windowId === windowId && tab.groupId === -1 && !tab.pinned) {
        await chrome.tabs.move(id, { index });
      }
    } catch {
      // Other user actions since organization can make exact restoration impossible.
    }
  }
}

async function undoGroups(windowId) {
  const match = await resolveUndo(windowId);
  if (!match) throw new Error("找不到能安全对应当前标签的整理记录；分组可能已变化，未修改任何标签。");
  const { operation: lastOperation, restored } = match;

  const affected = new Set();
  const savedToCurrent = new Map(match.groups.flatMap(group => group.matches || [])
    .map(item => [item.savedId, item.currentId]));
  mutatingWindows.add(windowId);
  try {
    for (const group of match.groups) {
      let tabs;
      try {
        tabs = await chrome.tabs.query({ groupId: group.groupId, windowId });
      } catch {
        continue;
      }
      const own = tabs.filter(tab => group.tabIds.includes(tab.id)).map(tab => tab.id);
      if (!own.length) continue;
      await chrome.tabs.ungroup(own);
      own.forEach(id => affected.add(id));
    }

    const priorRestored = await restorePreviousGroups(windowId, lastOperation.previous, savedToCurrent, !restored);

    const originalOrder = restored
      ? await restoredOrderIds(lastOperation.originalSignatures || lastOperation.originalKeys || [], await chrome.tabs.query({ windowId }))
      : lastOperation.originalOrder;
    if (originalOrder) await restoreTabOrder(windowId, originalOrder, affected);
    const currentOrder = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index).map(tab => tab.id);
    const orderRestored = !lastOperation.previous?.length && Boolean(originalOrder)
      && currentOrder.length === originalOrder.length
      && currentOrder.every((id, index) => id === originalOrder[index]);
    const local = await chrome.storage.local.get("organizerOperations");
    await chrome.storage.local.set({ organizerOperations: (local.organizerOperations || []).filter(item => item.id !== lastOperation.id) });
    await chrome.storage.session.remove(`lastOperation:${lastOperation.windowId}`);
    return { ok: true, restoredCount: affected.size, priorRestored, orderRestored };
  } finally {
    mutatingWindows.delete(windowId);
  }
}
