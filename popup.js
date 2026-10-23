import { isEligibleTab } from "./core.js";
import { endpointOriginPattern, listAIModels, rememberApiKeyRequirement, testAIConnection } from "./ai.js";

const $ = id => document.getElementById(id);
const previewPerformanceData = {
  totals: { all: 6, eligible: 3, discarded: 2, protected: 1 },
  groups: [
    {
      id: 1, title: "示例 · 学习资料", color: "blue", collapsed: false,
      eligibleCount: 2, discardedCount: 1, protectedCount: 0,
      tabs: [
        { id: 101, title: "课程笔记", host: "example.com", url: "https://example.com/notes", reason: null, state: "可释放" },
        { id: 102, title: "参考文档", host: "example.com", url: "https://example.com/docs", reason: null, state: "可释放" },
        { id: 103, title: "旧版资料", host: "example.com", url: "https://example.com/archive", reason: "discarded", state: "已释放" }
      ]
    },
    {
      id: 2, title: "示例 · 工作页面", color: "green", collapsed: false,
      eligibleCount: 1, discardedCount: 1, protectedCount: 1,
      tabs: [
        { id: 104, title: "项目看板", host: "example.com", url: "https://example.com/project", reason: null, state: "可释放" },
        { id: 105, title: "归档页面", host: "example.com", url: "https://example.com/old", reason: "discarded", state: "已释放" },
        { id: 106, title: "固定的工作页", host: "example.com", url: "https://example.com/pinned", reason: "pinned", state: "固定标签" }
      ]
    }
  ]
};
const state = {
  windowId: null,
  tabs: [],
  organizableCount: 0,
  allOrganizableCount: 0,
  revisitedCount: 0,
  scopeMode: null,
  scopeEditorOpen: false,
  tourLoaded: false,
  tourDone: false,
  tourActive: false,
  tourStep: 0,
  mode: "rules",
  basis: "site",
  language: "auto",
  settings: { endpoint: "", model: "", hadApiKey: false, testedAt: 0 },
  apiKey: "",
  memoryCount: 0,
  previewPlan: null,
  performance: null,
  performanceError: "",
  previewOnly: false,
  presentationMode: "sidepanel",
  activeModule: "main",
  settingsReturnModule: "main",
  showAllPerformanceGroups: false,
  selectedPerformanceTabs: new Set(),
  expandedPerformanceGroups: new Set(),
  performanceRefreshToken: 0,
  busy: false,
  busyKind: ""
};

function eligibleCount() {
  return state.scopeMode === "all" ? state.allOrganizableCount
    : state.scopeMode === "incremental" ? state.organizableCount : 0;
}

function renderScopePicker() {
  const ready = Number.isInteger(state.windowId);
  const count = eligibleCount();
  $("scope-eligible-count").textContent = ready && state.scopeMode ? String(count) : "—";
  $("scope-total-count").textContent = ready ? String(state.tabs.length) : "—";
  $("scope-incremental-count").textContent = ready ? String(state.organizableCount) : "—";
  $("scope-all-count").textContent = ready ? String(state.allOrganizableCount) : "—";
  $("scope-current").hidden = !state.scopeMode || state.scopeEditorOpen;
  $("scope-setup").hidden = Boolean(state.scopeMode) && !state.scopeEditorOpen;
  $("scope-current-name").textContent = state.scopeMode === "all" ? "全部重整" : "继续整理";
  $("scope-change").setAttribute("aria-expanded", String(state.scopeEditorOpen));
  $("scope-cancel").hidden = !state.scopeMode;
  const choice = document.querySelector('input[name="scope-mode"]:checked')?.value;
  $("scope-confirm").disabled = state.busy || state.previewOnly || !ready || !choice;
  $("scope-confirm").textContent = choice === "all" ? "确认改动现有分组" : "确认整理范围";
  for (const radio of document.querySelectorAll('input[name="scope-mode"]')) radio.disabled = state.busy || state.previewOnly || !ready;
  $("scope-change").disabled = state.busy;
  $("scope-cancel").disabled = state.busy;
}

function openScopeEditor() {
  if (state.busy) return;
  state.scopeEditorOpen = true;
  if (state.scopeMode) document.querySelector(`input[name="scope-mode"][value="${state.scopeMode}"]`).checked = true;
  updateUI();
  (document.querySelector('input[name="scope-mode"]:checked')
    || document.querySelector('input[name="scope-mode"]'))?.focus();
}

async function confirmScopeChoice() {
  if (state.busy || state.previewOnly || !Number.isInteger(state.windowId)) return;
  const chosen = document.querySelector('input[name="scope-mode"]:checked')?.value;
  if (!["incremental", "all"].includes(chosen)) return;
  state.scopeMode = chosen;
  state.scopeEditorOpen = false;
  updateUI();
  $("scope-change").focus();
  try {
    await chrome.storage.local.set({ organizerScopeMode: chosen });
  } catch {
    toast("整理范围已切换，但保存偏好失败；下次打开可能需要重新选择。", "error");
  }
}

function aiReady() {
  const form = currentAIForm();
  return Boolean(form.endpoint && form.model
    && form.endpoint === state.settings.endpoint
    && form.model === state.settings.model
    && form.apiKey === state.apiKey
    && (!state.settings.hadApiKey || form.apiKey));
}

function currentAIForm() {
  return {
    endpoint: $("endpoint").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("api-key").value.trim()
  };
}

function setApiKeyVisibility(visible) {
  const input = $("api-key");
  const button = $("toggle-api-key");
  input.type = visible ? "text" : "password";
  button.dataset.visible = String(visible);
  const action = visible ? "隐藏 API Key" : "显示 API Key";
  button.setAttribute("aria-label", action);
  button.title = action;
}

function toggleApiKeyVisibility() {
  setApiKeyVisibility($("api-key").type === "password");
}

function currentFormWasTested() {
  const form = currentAIForm();
  return Boolean(state.settings.testedAt
    && form.endpoint === state.settings.endpoint
    && form.model === state.settings.model
    && form.apiKey === state.apiKey);
}

function notice(message, kind = "") {
  const element = $("notice");
  element.textContent = message;
  element.className = `notice ${kind}`.trim();
  element.hidden = !message;
}

function aiStatus(message, kind = "") {
  if (message) toast(message, kind || "info");
}

function toast(message, kind = "success") {
  const stack = $("toast-stack");
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  item.setAttribute("role", kind === "error" ? "alert" : "status");
  stack.prepend(item);
  while (stack.children.length > 3) stack.lastElementChild.remove();
  window.setTimeout(() => item.remove(), kind === "error" ? 7000 : 3200);
}

function closeInfoTips(except = null, dismissVisible = false) {
  for (const tip of document.querySelectorAll('.info-tip[data-open="true"]')) {
    if (tip === except) continue;
    delete tip.dataset.open;
    tip.querySelector(".info-trigger").setAttribute("aria-expanded", "false");
  }
  if (dismissVisible) {
    for (const tip of document.querySelectorAll(".info-tip")) {
      if (tip.matches(":hover") || tip.contains(document.activeElement)) tip.dataset.dismissed = "true";
    }
  }
}

function initInfoTips() {
  for (const tip of document.querySelectorAll(".info-tip")) {
    const trigger = tip.querySelector(".info-trigger");
    trigger.setAttribute("aria-expanded", "false");
    tip.addEventListener("mouseleave", () => delete tip.dataset.dismissed);
    trigger.addEventListener("blur", () => delete tip.dataset.dismissed);
    trigger.addEventListener("click", () => {
      delete tip.dataset.dismissed;
      const isOpen = tip.dataset.open === "true";
      closeInfoTips(tip);
      if (isOpen) delete tip.dataset.open;
      else tip.dataset.open = "true";
      trigger.setAttribute("aria-expanded", String(!isOpen));
    });
  }
  document.addEventListener("click", event => {
    if (!event.target.closest(".info-tip")) closeInfoTips();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeInfoTips(null, true);
  });
}

function closeAppearanceMenus() {
  for (const control of document.querySelectorAll(".appearance-control")) {
    control.querySelector(".appearance-menu").hidden = true;
    control.querySelector(".appearance-button").setAttribute("aria-expanded", "false");
  }
}

function applyThemeMode(mode, persist = false) {
  const chosen = ["light", "dark"].includes(mode) ? mode : "system";
  document.documentElement.dataset.theme = chosen;
  const label = { system: "跟随系统", light: "浅色", dark: "深色" }[chosen];
  for (const button of document.querySelectorAll(".appearance-button")) {
    button.title = `外观：${label}`;
    button.setAttribute("aria-label", `切换外观，当前${label}`);
  }
  for (const option of document.querySelectorAll("[data-theme-option]")) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === chosen));
  }
  if (persist) {
    try { localStorage.setItem("qiyeThemeMode", chosen); }
    catch { toast("外观已切换，但当前环境无法保存偏好。", "error"); }
  }
}

function initAppearance() {
  applyThemeMode(document.documentElement.dataset.theme);
  for (const control of document.querySelectorAll(".appearance-control")) {
    const trigger = control.querySelector(".appearance-button");
    const menu = control.querySelector(".appearance-menu");
    trigger.addEventListener("click", () => {
      const shouldOpen = menu.hidden;
      closeAppearanceMenus();
      if (shouldOpen) {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      }
    });
    for (const option of menu.querySelectorAll("[data-theme-option]")) {
      option.addEventListener("click", () => {
        applyThemeMode(option.dataset.themeOption, true);
        closeAppearanceMenus();
        trigger.focus();
      });
    }
  }
  document.addEventListener("click", event => {
    if (!event.target.closest(".appearance-control")) closeAppearanceMenus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeAppearanceMenus();
  });
  window.addEventListener("storage", event => {
    if (event.key === "qiyeThemeMode") applyThemeMode(event.newValue);
  });
}

const tourSteps = [
  { target: () => state.scopeMode ? document.querySelector(".scope-picker") : $("scope-setup"),
    title: "先确定整理范围", copy: () => state.scopeMode
      ? "这里显示当前范围和数量；点“更改”可切换。继续整理保留手动分组，全部重整会重新归类现有分组。"
      : "“继续整理”保留手动分组；“全部重整”会重新归类现有分组。先看数量，再由你明确确认。" },
  { target: () => $("strategy"), title: "选择整理方式",
    copy: "本地规则不联网；AI 智能需要先到设置里配置接口。两种方式都遵守你选择的整理范围。" },
  { target: () => $("organize"), title: "执行前可先预览",
    copy: "主按钮会直接整理。想先检查建议，请用它下方的“预览建议”；AI 预览也会调用模型。" },
  { target: () => $("performance-tab"), title: "内存管理是独立模块",
    copy: "在这里可按标签组选择后台页面并手动释放；标签与分组会留在原位。" },
  { target: () => $("settings-button"), title: "设置与外观",
    copy: "齿轮里可修改打开方式、命名和 AI 配置；旁边的半明半暗图标可切换外观。" }
];

function placeTourPart(element, left, top, width, height) {
  Object.assign(element.style, {
    left: `${Math.max(0, left)}px`, top: `${Math.max(0, top)}px`,
    width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px`
  });
}

function positionTour() {
  if (!state.tourActive) return;
  const target = tourSteps[state.tourStep].target();
  if (!target || target.hidden || !target.getClientRects().length) return;
  const rect = target.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const left = Math.max(0, Math.min(width, rect.left - 5));
  const right = Math.max(left, Math.min(width, rect.right + 5));
  const top = Math.max(0, Math.min(height, rect.top - 5));
  const bottom = Math.max(top, Math.min(height, rect.bottom + 5));
  const shades = document.querySelectorAll(".tour-shade");
  placeTourPart(shades[0], 0, 0, width, top);
  placeTourPart(shades[1], 0, bottom, width, height - bottom);
  placeTourPart(shades[2], 0, top, left, bottom - top);
  placeTourPart(shades[3], right, top, width - right, bottom - top);
  placeTourPart($("tour-ring"), left, top, right - left, bottom - top);
  const card = $("tour-card");
  const cardHeight = card.offsetHeight;
  const cardWidth = card.offsetWidth;
  const cardLeft = Math.max(12, Math.min(width - cardWidth - 12, left));
  const cardTop = bottom + cardHeight + 10 <= height - 10 ? bottom + 10
    : top - cardHeight - 10 >= 10 ? top - cardHeight - 10
      : Math.max(10, height - cardHeight - 10);
  card.style.left = `${cardLeft}px`;
  card.style.top = `${cardTop}px`;
}

function showTourStep() {
  const step = tourSteps[state.tourStep];
  $("tour-progress").textContent = `${state.tourStep + 1} / ${tourSteps.length}`;
  $("tour-title").textContent = step.title;
  $("tour-copy").textContent = typeof step.copy === "function" ? step.copy() : step.copy;
  $("tour-next").textContent = state.tourStep === tourSteps.length - 1 ? "完成" : "下一步";
  step.target()?.scrollIntoView({ block: "nearest" });
  requestAnimationFrame(positionTour);
  $("tour-next").focus();
}

function startTour(replay = false) {
  if (state.tourActive || !Number.isInteger(state.windowId) || state.previewOnly
    || state.activeModule !== "main" || (!replay && (!state.tourLoaded || state.tourDone))) return;
  state.tourActive = true;
  state.tourStep = 0;
  $("tour").hidden = false;
  showTourStep();
}

function finishTour() {
  if (!state.tourActive) return;
  state.tourActive = false;
  state.tourDone = true;
  $("tour").hidden = true;
  $("organize-tab").focus();
  void chrome.storage.local.set({ organizerTourDone: true }).catch(() => {});
}

function initTour() {
  $("tour-next").addEventListener("click", () => {
    if (state.tourStep === tourSteps.length - 1) finishTour();
    else { state.tourStep += 1; showTourStep(); }
  });
  $("tour-skip").addEventListener("click", finishTour);
  $("replay-tour").addEventListener("click", () => {
    showView("main");
    startTour(true);
  });
  window.addEventListener("resize", positionTour);
  document.addEventListener("scroll", positionTour, true);
  document.addEventListener("keydown", event => {
    if (!state.tourActive) return;
    if (event.key === "Escape") { event.preventDefault(); finishTour(); }
    if (event.key === "Tab") {
      const first = $("tour-skip");
      const last = $("tour-next");
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

function updateUI() {
  const count = eligibleCount();
  const windowBusy = state.busy || state.performance?.operation?.status === "running";
  renderScopePicker();
  $("preference-summary").textContent = `${state.basis === "topic" ? "自动归类" : "同站合并"} · ${state.language === "zh" ? "中文" : state.language === "en" ? "English" : "名称自动"}`;
  $("scope").textContent = Number.isInteger(state.windowId) ? "当前窗口" : "无法读取当前窗口";
  $("organize").disabled = windowBusy || !Number.isInteger(state.windowId) || !state.scopeMode || count === 0;
  $("organize").textContent = state.busy && state.busyKind === "organize"
    ? state.mode === "ai" ? "AI 正在分析并整理…" : "正在整理…"
    : !state.scopeMode ? "先选择整理范围"
      : count === 0 ? "没有待整理标签"
      : state.mode === "ai" && !aiReady() ? "先完成 AI 设置"
        : `${state.scopeMode === "all" ? "全部重整" : state.revisitedCount ? "再次整理" : "一键整理"} ${count} 个标签`;
  $("preview-button").disabled = windowBusy || !Number.isInteger(state.windowId) || !state.scopeMode || count === 0;
  $("preview-button").textContent = state.busyKind === "preview" ? "正在生成建议…" : "预览建议";
  $("safety-note").textContent = !state.scopeMode
    ? "请先选择整理范围；继续整理保留手动分组，全部重整会改动现有分组。"
    : state.scopeMode === "all"
    ? "将重新归类当前窗口所有可处理标签，包含手动分组；固定、分屏及不支持的页面不变。"
    : state.revisitedCount
    ? `会重新整理本扩展创建的分组（${state.revisitedCount} 个标签）及未分组标签；手动分组不变。`
    : "创建 Chrome 原生分组；固定标签和手动分组不变。";
  $("ai-disclosure-wrap").hidden = state.mode !== "ai";
  $("ai-disclosure").textContent = state.scopeMode === "all"
    ? "全部重整时，现有手动分组中可处理标签的标题与网站域名也会发送至你配置的 AI 接口；不发送完整网址和网页正文。预览同样会调用模型。"
    : "仅将本次参与整理标签的标题、网站域名、归一化网站标识和临时编号发送至你配置的 AI 接口；预览也会调用模型。";
  $("settings-state").hidden = state.mode !== "ai";
  const aiConfigured = aiReady();
  const aiStatusText = aiConfigured
    ? currentFormWasTested() ? "AI 已验证" : "AI 已配置（未测试）"
    : state.settings.endpoint || state.settings.model ? "AI 配置未完成" : "AI 尚未配置";
  $("settings-state").textContent = aiStatusText;
  $("settings-state-inline").textContent = aiStatusText.replace("AI ", "");
  $("settings-state-inline").className = `status-badge ${aiConfigured ? currentFormWasTested() ? "ready" : "pending" : ""}`.trim();
  $("strategy").disabled = windowBusy;
  $("basis").disabled = windowBusy;
  $("language").disabled = windowBusy;
  $("save-settings").disabled = windowBusy;
  $("get-models").disabled = windowBusy;
  $("test-connection").disabled = windowBusy;
  $("clear-memory").disabled = windowBusy || state.memoryCount === 0;
  $("preview-back").disabled = windowBusy;
  $("preview-cancel").disabled = windowBusy;
  $("preview-apply").disabled = windowBusy || !state.previewPlan;
  $("preview-apply").textContent = state.busyKind === "apply-preview" ? "正在整理…" : "按此整理";
  $("get-models").setAttribute("aria-label", state.busyKind === "models" ? "正在获取模型列表" : "获取模型列表");
  $("get-models").title = state.busyKind === "models" ? "正在获取模型列表" : "获取模型列表";
  $("test-connection").textContent = state.busyKind === "test" ? "正在测试…" : "测试连接";
  for (const id of ["endpoint", "model", "api-key"]) $(id).disabled = windowBusy;
  if (windowBusy) $("undo").disabled = true;
  const performance = state.performance;
  $("settings-button").disabled = windowBusy;
  $("open-sidepanel").disabled = windowBusy || state.previewOnly || !Number.isInteger(state.windowId);
  for (const radio of document.querySelectorAll('input[name="presentation"]')) radio.disabled = windowBusy || state.previewOnly;
  $("organize-tab").disabled = windowBusy;
  $("performance-tab").disabled = windowBusy;
  $("performance-filter-eligible").disabled = windowBusy || !performance?.groups?.length;
  $("performance-filter-all").disabled = windowBusy || !performance?.groups?.length;
  $("performance-refresh").disabled = state.busy || !Number.isInteger(state.windowId);
  $("performance-settings").disabled = state.busy || state.previewOnly;
  const selectedCount = selectedPerformanceTargets().length;
  $("performance-selected-count").textContent = selectedCount;
  $("performance-select-all").disabled = windowBusy || state.previewOnly || !performance?.totals?.eligible || selectedCount === performance.totals.eligible;
  $("performance-clear-selection").disabled = windowBusy || state.previewOnly || selectedCount === 0;
  $("performance-discard").disabled = windowBusy || state.previewOnly || !Number.isInteger(state.windowId) || selectedCount === 0 || selectedCount > 500;
  $("performance-discard").textContent = state.previewOnly ? "预览不可释放" : state.busyKind === "discard"
    ? "正在释放…" : performance?.operation?.status === "running"
      ? "正在释放…" : selectedCount > 500 ? "每次最多 500 个" : selectedCount ? `释放 ${selectedCount} 个标签` : "先选择标签";
  for (const checkbox of $("performance-groups").querySelectorAll('input[type="checkbox"]')) {
    checkbox.disabled = windowBusy || state.previewOnly || checkbox.dataset.empty === "true";
  }
}

async function updateUndo() {
  const status = await chrome.runtime.sendMessage({ type: "undo-status", windowId: state.windowId });
  if (!status?.ok) throw new Error(status?.error || "无法读取撤销状态。");
  state.organizableCount = status.organizableCount ?? state.tabs.filter(isEligibleTab).length;
  state.allOrganizableCount = status.allCount ?? state.organizableCount;
  state.revisitedCount = status.revisitedCount || 0;
  updateUI();
  $("undo").disabled = state.busy || state.performance?.operation?.status === "running" || !status.available;
  const undoDescription = status.undoScopeMode === "all"
    ? "撤销最近一次全部重整，并尽量恢复原有分组；若分组已变化将停止以避免误操作"
    : status.restored
      ? "已核对重启后的分组；仅撤销栖页创建的分组"
      : "仅撤销栖页创建的分组";
  $("undo").title = undoDescription;
  $("undo").setAttribute("aria-description", undoDescription);
  const diagnostic = $("review-diagnostic");
  const counts = status.diagnostics;
  const parts = [];
  if (counts?.reviewCount) {
    parts.push(`待核对 ${counts.reviewCount} 个；首轮模型标记 ${counts.modelReviewCount || 0}，漏报补入 ${counts.omittedCount || 0}${counts.hostedCount ? `，托管域名纠偏 ${counts.hostedCount}` : ""}${counts.capacityCount ? `，分组上限 ${counts.capacityCount}` : ""}`);
  }
  if (counts?.recoveredCount) parts.push(`已补回 ${counts.recoveredCount} 个关联页面`);
  if (counts?.clusteredCount) parts.push(`其中 ${counts.clusteredCount} 个同页归组`);
  if (counts?.secondPassRecoveredCount) parts.push(`AI 复核补回 ${counts.secondPassRecoveredCount} 个`);
  if (counts?.renamedCount) parts.push(`复核优化 ${counts.renamedCount} 个组名`);
  if (counts?.learnedCount) parts.push(`应用 ${counts.learnedCount} 条手动调整`);
  if (counts?.secondPassFailed) parts.push("AI 复核未完成，已保留首轮结果");
  diagnostic.textContent = parts.join("；");
  $("review-info").hidden = !parts.length;
  $("review-summary").textContent = counts?.reviewCount
    ? `待核对 ${counts.reviewCount} · 查看明细`
    : "查看整理明细";
}

async function refreshMemoryCount() {
  const stored = await chrome.storage.local.get("organizerCorrections");
  state.memoryCount = Array.isArray(stored.organizerCorrections) ? stored.organizerCorrections.length : 0;
  $("memory-count").textContent = `已记住 ${state.memoryCount} 条 · 仅用于自动归类`;
  updateUI();
}

async function clearMemory() {
  if (state.busy || !state.memoryCount) return;
  if (!window.confirm(`清除已记住的 ${state.memoryCount} 条手动调整？当前标签分组不会改变。`)) return;
  state.busy = true;
  updateUI();
  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-memory" });
    if (!response?.ok) throw new Error(response?.error || "清除失败，请重试。");
    await refreshMemoryCount();
    aiStatus("已清除调整记忆，当前标签分组未改变。", "success");
  } catch (error) {
    aiStatus(error.message, "error");
  } finally {
    state.busy = false;
    updateUI();
  }
}

async function findWindowId() {
  if (typeof chrome === "undefined" || !chrome.windows?.getCurrent) {
    throw new Error("请从 Chrome 工具栏的扩展图标打开；直接打开页面无法读取当前窗口。");
  }
  const current = await chrome.windows.getCurrent();
  if (current?.type === "normal") return current.id;
  const focused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  return focused?.id ?? null;
}

async function refreshTabs() {
  if (!Number.isInteger(state.windowId)) throw new Error("没有找到 Chrome 普通窗口。");
  state.tabs = await chrome.tabs.query({ windowId: state.windowId });
  updateUI();
  await updateUndo();
}

function openAISettings() {
  showView("settings");
  const form = currentAIForm();
  const field = !form.endpoint ? $("endpoint")
    : state.settings.hadApiKey && !form.apiKey ? $("api-key")
      : !form.model ? $("model") : $("save-settings");
  field.focus();
}

function openSidePanel() {
  if (typeof chrome === "undefined" || !chrome.sidePanel?.open || !Number.isInteger(state.windowId)) {
    toast("请从 Chrome 扩展图标打开后再切换侧边栏。", "error");
    return;
  }
  void chrome.storage.session.set({ panelLanding: {
    windowId: state.windowId, module: state.activeModule, requestedAt: Date.now()
  } }).catch(() => {});
  void chrome.sidePanel.open({ windowId: state.windowId }).catch(error => toast(error.message || "无法打开侧边栏。", "error"));
}

function applyPanelLanding(landing) {
  if (document.body.dataset.surface !== "panel" || landing?.windowId !== state.windowId
    || !Number.isFinite(landing.requestedAt) || Date.now() - landing.requestedAt > 30_000) return;
  if (landing.module === "performance") void openPerformance();
  else showView("main");
}

async function choosePresentationMode(mode) {
  if (state.busy || state.previewOnly || mode === state.presentationMode) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "set-presentation-mode", mode });
    if (!response?.ok) throw new Error(response?.error || "无法切换打开方式。");
    state.presentationMode = mode;
    toast(`已设为${mode === "popup" ? "弹窗" : "侧边栏"}；下次点击工具栏图标生效。`);
  } catch (error) {
    document.querySelector(`input[name="presentation"][value="${state.presentationMode}"]`).checked = true;
    toast(error.message, "error");
  }
}

function showView(view, returnFocus) {
  closeInfoTips();
  closeAppearanceMenus();
  const isSettings = view === "settings";
  const isPreview = view === "preview";
  const isPerformance = view === "performance";
  if (isSettings) state.settingsReturnModule = state.activeModule;
  if (!isSettings && !isPreview) state.activeModule = isPerformance ? "performance" : "main";
  if (!isSettings) setApiKeyVisibility(false);
  $("workspace-shell").hidden = isSettings || isPreview;
  $("main-view").hidden = isSettings || isPreview || isPerformance;
  $("settings").hidden = !isSettings;
  $("preview-view").hidden = !isPreview;
  $("performance-view").hidden = !isPerformance;
  for (const [module, tabId] of [["main", "organize-tab"], ["performance", "performance-tab"]]) {
    const selected = state.activeModule === module;
    $(tabId).setAttribute("aria-selected", String(selected));
    $(tabId).tabIndex = selected ? 0 : -1;
  }
  if (isSettings) $("settings-back").focus();
  else if (isPreview) $("preview-back").focus();
  else $(returnFocus || (isPerformance ? "performance-tab" : "organize-tab")).focus();
  updateUI();
  if (view === "main" && !state.tourActive) requestAnimationFrame(() => startTour());
}

function closePreview() {
  if (state.busy) return;
  state.previewPlan = null;
  showView("main");
  updateUI();
}

function selectedPerformanceTargets() {
  if (!state.performance) return [];
  return state.performance.groups
    .flatMap(group => group.tabs.filter(tab => !tab.reason && state.selectedPerformanceTabs.has(tab.id))
      .map(tab => ({ id: tab.id, groupId: group.id, url: tab.url })));
}

function performanceNotice(message, kind = "") {
  const element = $("performance-notice");
  element.textContent = message;
  element.className = `notice ${kind}`.trim();
  element.hidden = !message;
}

function renderPerformance() {
  const data = state.performance;
  const eligible = data?.totals?.eligible || 0;
  const discarded = data?.totals?.discarded || 0;
  const status = $("performance-status");
  status.dataset.state = state.previewOnly ? "preview" : !data ? state.performanceError ? "unavailable" : "loading" : eligible ? "ready" : "clear";
  $("performance-title").textContent = state.previewOnly ? "内存管理 · 界面预览" : !data
    ? state.performanceError ? "暂时无法读取标签状态" : "正在核对后台标签"
    : eligible ? `${eligible} 个后台标签可以释放` : "当前没有待释放的后台标签";
  const statusCopy = state.previewOnly ? "示例数据，不能操作真实标签" : !data
    ? state.performanceError || "正在读取当前窗口…" : "";
  $("performance-status-copy").textContent = statusCopy;
  $("performance-status-copy").parentElement.hidden = !statusCopy;
  $("performance-scope").textContent = state.previewOnly ? "演示内容 · 非当前窗口" : Number.isInteger(state.windowId)
    ? `当前窗口 · 共 ${data?.totals?.all || 0} 个标签`
    : "无法读取当前窗口";
  $("performance-eligible").textContent = data?.totals?.eligible ?? "—";
  $("performance-discarded").textContent = data?.totals?.discarded ?? "—";
  $("performance-protected").textContent = data?.totals?.protected ?? "—";
  const visibleGroups = data?.groups?.filter(group => state.showAllPerformanceGroups || group.eligibleCount > 0) || [];
  $("performance-filter-eligible").setAttribute("aria-pressed", String(!state.showAllPerformanceGroups));
  $("performance-filter-all").setAttribute("aria-pressed", String(state.showAllPerformanceGroups));
  const list = $("performance-groups");
  if (!visibleGroups.length) {
    const empty = document.createElement("p");
    empty.className = "performance-empty";
    empty.textContent = !data ? "从 Chrome 扩展图标打开后，在这里选择分组。"
      : data.groups.length ? "没有待释放的分组。切换到“全部分组”可查看其他标签。"
        : "当前窗口没有可管理的标签。";
    list.replaceChildren(empty);
    return;
  }
  const colors = {
    grey: "#9aa0a6", blue: "#8ab4f8", red: "#f28b82", yellow: "#fdd663",
    green: "#81c995", pink: "#f6aea9", purple: "#c58af9", cyan: "#78d9ec", orange: "#fcad70"
  };
  list.replaceChildren(...visibleGroups.map(group => {
    const section = document.createElement("section");
    section.className = "performance-group";
    const eligibleTabs = group.tabs.filter(tab => !tab.reason);
    const header = document.createElement("div");
    header.className = "performance-group-header";
    const label = document.createElement("label");
    label.className = "performance-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const chosen = eligibleTabs.filter(tab => state.selectedPerformanceTabs.has(tab.id)).length;
    checkbox.checked = eligibleTabs.length > 0 && chosen === eligibleTabs.length;
    checkbox.indeterminate = chosen > 0 && chosen < eligibleTabs.length;
    checkbox.disabled = state.previewOnly || state.busy || state.performance?.operation?.status === "running" || group.eligibleCount === 0;
    checkbox.dataset.empty = String(group.eligibleCount === 0);
    checkbox.setAttribute("aria-label", `选择分组 ${group.title} 中的 ${group.eligibleCount} 个可释放标签`);
    checkbox.addEventListener("change", () => {
      for (const tab of eligibleTabs) {
        if (checkbox.checked) state.selectedPerformanceTabs.add(tab.id);
        else state.selectedPerformanceTabs.delete(tab.id);
      }
      checkbox.indeterminate = false;
      for (const member of section.querySelectorAll(".performance-tab-choice input")) {
        member.checked = checkbox.checked;
      }
      updateUI();
    });
    const dot = document.createElement("span");
    dot.className = "preview-color";
    dot.style.setProperty("--group-color", colors[group.color] || colors.grey);
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "performance-group-name";
    name.textContent = group.title;
    label.append(checkbox, dot, name);
    const toggle = document.createElement("button");
    toggle.className = "performance-group-toggle";
    toggle.type = "button";
    const expanded = state.expandedPerformanceGroups.has(group.id);
    toggle.textContent = expanded ? "收起" : "展开";
    toggle.setAttribute("aria-expanded", String(expanded));
    const memberId = `performance-members-${group.id}`;
    toggle.setAttribute("aria-controls", memberId);
    toggle.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${group.title}中的标签`);
    toggle.addEventListener("click", () => {
      if (state.expandedPerformanceGroups.has(group.id)) state.expandedPerformanceGroups.delete(group.id);
      else state.expandedPerformanceGroups.add(group.id);
      renderPerformance();
      const replacement = [...$("performance-groups").querySelectorAll(".performance-group-toggle")]
        .find(button => button.getAttribute("aria-controls") === memberId);
      replacement?.focus();
    });
    header.append(label, toggle);
    const meta = document.createElement("p");
    meta.className = "performance-group-meta";
    meta.textContent = `${group.eligibleCount} 可释放${group.discardedCount ? ` · ${group.discardedCount} 已释放` : ""}${group.protectedCount ? ` · ${group.protectedCount} 受保护` : ""}`;
    const members = document.createElement("ul");
    members.id = memberId;
    members.className = "performance-tab-list";
    members.hidden = !expanded;
    for (const tab of group.tabs) {
      const item = document.createElement("li");
      const identity = document.createElement("span");
      identity.className = "performance-tab-name";
      identity.textContent = tab.title;
      if (tab.host) {
        const host = document.createElement("span");
        host.className = "performance-tab-host";
        host.textContent = tab.host;
        identity.append(host);
      }
      const status = document.createElement("span");
      status.className = `performance-tab-state${tab.reason ? "" : " eligible"}`;
      status.textContent = tab.state;
      if (tab.reason) {
        const protectedIdentity = document.createElement("span");
        protectedIdentity.className = "performance-tab-choice";
        const placeholder = document.createElement("span");
        placeholder.className = "performance-tab-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        protectedIdentity.append(placeholder, identity);
        item.append(protectedIdentity, status);
      } else {
        const choice = document.createElement("label");
        choice.className = "performance-tab-choice";
        const memberCheckbox = document.createElement("input");
        memberCheckbox.type = "checkbox";
        memberCheckbox.checked = state.selectedPerformanceTabs.has(tab.id);
        memberCheckbox.disabled = state.previewOnly || state.busy || state.performance?.operation?.status === "running";
        memberCheckbox.setAttribute("aria-label", `选择标签：${tab.title}`);
        memberCheckbox.addEventListener("change", () => {
          if (memberCheckbox.checked) state.selectedPerformanceTabs.add(tab.id);
          else state.selectedPerformanceTabs.delete(tab.id);
          const selected = eligibleTabs.filter(member => state.selectedPerformanceTabs.has(member.id)).length;
          checkbox.checked = selected === eligibleTabs.length;
          checkbox.indeterminate = selected > 0 && selected < eligibleTabs.length;
          updateUI();
        });
        choice.append(memberCheckbox, identity);
        item.append(choice, status);
      }
      members.append(item);
    }
    section.append(header, meta, members);
    return section;
  }));
}

async function refreshPerformance() {
  if (!Number.isInteger(state.windowId) || typeof chrome === "undefined") return;
  const token = ++state.performanceRefreshToken;
  try {
    const response = await chrome.runtime.sendMessage({ type: "performance-status", windowId: state.windowId });
    if (token !== state.performanceRefreshToken) return;
    if (!response?.ok) throw new Error(response?.error || "无法读取后台标签状态。");
    state.performance = response;
    state.performanceError = "";
    const eligibleIds = new Set(response.groups.flatMap(group => group.tabs.filter(tab => !tab.reason).map(tab => tab.id)));
    state.selectedPerformanceTabs = new Set([...state.selectedPerformanceTabs].filter(id => eligibleIds.has(id)));
    if (response.operation?.status === "interrupted" && !$("performance-notice").textContent) {
      const finished = response.operation.results.filter(item => item.result === "released").length;
      performanceNotice(`上次操作中断，已记录 ${finished} 个成功释放的标签。请刷新状态后按需继续。`, "partial");
    }
    if (response.operation?.status === "running") {
      performanceNotice(`正在释放后台标签，已处理 ${response.operation.results.length}/${response.operation.requested} 个。`);
      window.setTimeout(() => void refreshPerformance(), 700);
    }
    if (response.operation?.status === "complete" && response.operation.summary
      && Date.now() - response.operation.startedAt < 10 * 60 * 1000
      && (!$("performance-notice").textContent || $("performance-notice").textContent.startsWith("正在释放后台标签"))) {
      const { released, skipped, failed, reasons } = response.operation.summary;
      const detail = reasons.length ? `原因：${reasons.map(item => `${item.label} ${item.count}`).join("、")}。` : "";
      performanceNotice(`已释放 ${released} 个后台标签；标签和分组仍在原位。${skipped || failed ? `跳过 ${skipped} 个，失败 ${failed} 个。${detail}` : ""}`,
        skipped || failed ? "partial" : "success");
    }
    renderPerformance();
    updateUI();
  } catch (error) {
    if (token !== state.performanceRefreshToken) return;
    state.performance = null;
    state.performanceError = `${error.message} 请刷新状态。`;
    renderPerformance();
    updateUI();
  }
}

async function openPerformance() {
  if (state.busy) return;
  showView("performance");
  renderPerformance();
  await refreshPerformance();
}

async function discardSelectedPerformanceTabs() {
  if (state.busy || state.performance?.operation?.status === "running") return;
  const targets = selectedPerformanceTargets();
  if (!targets.length) return;
  state.busy = true;
  state.busyKind = "discard";
  performanceNotice("正在释放所选后台标签…");
  updateUI();
  try {
    const response = await chrome.runtime.sendMessage({ type: "discard-tabs", windowId: state.windowId, targets });
    if (!response?.ok) throw new Error(response?.error || "释放未完成，请刷新状态。");
    const details = response.reasons?.length
      ? `未处理原因：${response.reasons.map(item => `${item.label} ${item.count}`).join("、")}。` : "";
    performanceNotice(`已释放 ${response.released} 个后台标签；标签、分组和位置未改变。${response.skipped || response.failed ? `跳过 ${response.skipped} 个，失败 ${response.failed} 个。${details}` : ""}`,
      response.skipped || response.failed ? "partial" : "success");
    state.selectedPerformanceTabs.clear();
    await refreshPerformance();
    await refreshTabs().catch(() => {});
  } catch (error) {
    performanceNotice(`${error.message} 已释放的标签仍保留在原分组，请刷新状态核对。`, "error");
    await refreshPerformance();
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
  }
}

async function openChromePerformanceSettings() {
  try {
    await chrome.tabs.create({ url: "chrome://settings/performance" });
  } catch {
    performanceNotice("无法自动打开设置；请在 Chrome 地址栏输入 chrome://settings/performance。", "error");
  }
}

function renderPreview() {
  const plan = state.previewPlan;
  const tabs = new Map(plan.tabs.map(tab => [tab.id, tab]));
  const count = plan.groups.reduce((total, group) => total + group.tabIds.length, 0);
  $("preview-summary").textContent = `${plan.scopeMode === "all" ? "将重新整理" : "将整理"} ${count} 个标签，创建 ${plan.groups.length} 个 Chrome 原生分组。${plan.scopeMode === "all" ? "现有手动分组也会改变；" : ""}当前尚未移动标签。`;
  const colors = {
    grey: "#9aa0a6", blue: "#8ab4f8", red: "#f28b82", yellow: "#fdd663",
    green: "#81c995", pink: "#f6aea9", purple: "#c58af9", cyan: "#78d9ec", orange: "#fcad70"
  };
  const list = $("preview-groups");
  list.replaceChildren(...plan.groups.map(group => {
    const details = document.createElement("details");
    details.className = "preview-group";
    const summary = document.createElement("summary");
    const dot = document.createElement("span");
    dot.className = "preview-color";
    dot.style.setProperty("--group-color", colors[group.color] || colors.grey);
    dot.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "preview-group-title";
    title.textContent = group.title;
    const size = document.createElement("span");
    size.className = "preview-group-count";
    size.textContent = `${group.tabIds.length} 个`;
    summary.append(dot, title, size);
    const members = document.createElement("ul");
    members.className = "preview-tabs";
    for (const id of group.tabIds) {
      const tab = tabs.get(id);
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = tab?.title || "未命名标签";
      const host = document.createElement("span");
      host.className = "preview-tab-host";
      host.textContent = tab?.host || "本地页面";
      item.append(name, host);
      members.append(item);
    }
    details.append(summary, members);
    return details;
  }));
}

async function preview() {
  if (state.busy) return;
  if (!state.scopeMode) { openScopeEditor(); return; }
  if (state.mode === "ai" && !aiReady()) {
    openAISettings();
    aiStatus("请先填写并保存 API 地址、模型及所需的 API Key。", "error");
    return;
  }
  state.busy = true;
  state.busyKind = "preview";
  notice("");
  updateUI();
  try {
    if (state.mode === "ai") await requestOrigin(state.settings.endpoint);
    await refreshTabs();
    if (!eligibleCount()) throw new Error("当前窗口没有可整理的标签。");
    const response = await chrome.runtime.sendMessage({
      type: "preview", windowId: state.windowId, mode: state.mode,
      basis: state.basis, language: state.language, scopeMode: state.scopeMode
    });
    if (!response?.ok) throw new Error(response?.error || "无法生成预览，请重试。");
    state.previewPlan = { groups: response.groups, tabs: response.tabs, diagnostics: response.diagnostics,
      scopeMode: response.scopeMode };
    renderPreview();
    showView("preview");
  } catch (error) {
    notice(error.message, "error");
    try { await refreshTabs(); } catch { /* Keep the preview error visible. */ }
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
  }
}

async function applyPreview() {
  if (state.busy || !state.previewPlan) return;
  state.busy = true;
  state.busyKind = "apply-preview";
  updateUI();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "apply", windowId: state.windowId,
      groups: state.previewPlan.groups, tabs: state.previewPlan.tabs,
      diagnostics: state.previewPlan.diagnostics, scopeMode: state.previewPlan.scopeMode
    });
    if (!response?.ok) throw new Error(response?.error || "应用预览失败，请重新预览。");
    state.previewPlan = null;
    showView("main");
    await refreshTabs();
    notice(`已按预览整理 ${response.tabCount} 个标签，创建 ${response.groupCount} 个原生分组。可在下方撤销。`, "success");
  } catch (error) {
    state.previewPlan = null;
    showView("main");
    notice(`${error.message} 如标签页有变化，请重新预览。`, "error");
    try { await refreshTabs(); } catch { /* Keep the apply error visible. */ }
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
    await updateUndo();
  }
}

async function organize() {
  if (state.busy) return;
  if (!state.scopeMode) { openScopeEditor(); return; }
  if (state.mode === "ai" && !aiReady()) {
    openAISettings();
    aiStatus(state.settings.hadApiKey && !state.apiKey
      ? "请填写并保存 API Key 后再使用。"
      : "请先填写 API 地址和模型；测试连接是可选的。", "error");
    return;
  }
  state.busy = true;
  state.busyKind = "organize";
  notice("");
  updateUI();
  try {
    if (state.mode === "ai") await requestOrigin(state.settings.endpoint);
    await refreshTabs();
    if (!eligibleCount()) throw new Error("当前窗口没有可整理的标签。");
    const response = await chrome.runtime.sendMessage({
      type: "organize",
      windowId: state.windowId,
      mode: state.mode,
      basis: state.basis,
      language: state.language,
      scopeMode: state.scopeMode
    });
    if (!response?.ok) throw new Error(response?.error || "整理失败，请重试。");
    await refreshTabs();
    notice(`已整理 ${response.tabCount} 个标签，创建 ${response.groupCount} 个原生分组。可在下方撤销。`, "success");
  } catch (error) {
    notice(error.message, "error");
    try { await refreshTabs(); } catch { /* Preserve the actionable error above. */ }
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
    await updateUndo();
  }
}

async function undo() {
  if (state.busy) return;
  state.busy = true;
  state.busyKind = "undo";
  notice("");
  updateUI();
  try {
    const response = await chrome.runtime.sendMessage({ type: "undo", windowId: state.windowId });
    if (!response?.ok) throw new Error(response?.error || "撤销失败，请重试。");
    await refreshTabs();
    const ungrouped = Math.max(0, response.restoredCount - response.priorRestored);
    const untouched = Math.max(0, state.tabs.length - response.restoredCount);
    const order = response.orderRestored ? "标签顺序已恢复。" : "标签顺序未完全恢复，可按需手动调整。";
    notice(`已撤销上次分组：${response.restoredCount} 个标签离开本次分组；${response.priorRestored} 个回到旧组，${ungrouped} 个保持未分组。\n当前窗口另有 ${untouched} 个标签不在本次撤销范围。${order}`, response.orderRestored ? "success" : "partial");
  } catch (error) {
    notice(error.message, "error");
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
    await updateUndo();
  }
}

async function persistDraft(endpoint, model, apiKey, testedAt = null) {
  const unchanged = endpoint === state.settings.endpoint
    && model === state.settings.model
    && apiKey === state.apiKey;
  const nextTestedAt = testedAt === null ? unchanged ? state.settings.testedAt : 0 : testedAt;
  const hadApiKey = rememberApiKeyRequirement({ endpoint, apiKey }, state.settings, state.apiKey);
  const nextSettings = { ...state.settings, endpoint, model, hadApiKey, testedAt: nextTestedAt };
  await chrome.storage.local.set({
    organizerSettings: { ...nextSettings, mode: state.mode, basis: state.basis, language: state.language },
    organizerApiKey: apiKey
  });
  await chrome.storage.session.remove("organizerApiKey").catch(() => {});
  state.settings = nextSettings;
  state.apiKey = apiKey;
  updateUI();
}

async function saveSettings() {
  if (state.busy) return;
  const { endpoint, model, apiKey } = currentAIForm();
  try {
    if (endpoint) endpointOriginPattern(endpoint);
    await persistDraft(endpoint, model, apiKey);
    aiStatus("");
    toast("设置已保存；测试连接可稍后进行。");
  } catch (error) {
    aiStatus("");
    toast(error.message, "error");
    $("endpoint").focus();
  }
}

async function requestOrigin(endpoint) {
  const pattern = endpointOriginPattern(endpoint);
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error("未获得该 API 地址的访问权限，无法连接。");
}

async function getModels() {
  if (state.busy) return;
  const endpoint = $("endpoint").value.trim();
  const model = $("model").value.trim();
  const apiKey = $("api-key").value.trim();
  state.busy = true;
  state.busyKind = "models";
  updateUI();
  try {
    if (!endpoint) throw new Error("请先填写 API 基础地址。");
    await requestOrigin(endpoint);
    await persistDraft(endpoint, model, apiKey);
    aiStatus("");
    const models = await listAIModels(endpoint, apiKey);
    const list = $("model-list");
    list.replaceChildren(...models.slice(0, 500).map(id => {
      const option = document.createElement("option");
      option.value = id;
      return option;
    }));
    $("model-status").hidden = false;
    $("model-status").textContent = `已载入 ${models.length} 个模型${models.length > 500 ? "，显示前 500 个" : ""}`;
    aiStatus(`已获取 ${models.length} 个模型，请选择或填写模型 ID。`, "success");
    $("model").focus();
  } catch (error) {
    aiStatus(error.message, "error");
    if (!endpoint) window.setTimeout(() => $("endpoint").focus(), 0);
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
  }
}

async function testConnection() {
  if (state.busy) return;
  const endpoint = $("endpoint").value.trim();
  const model = $("model").value.trim();
  const apiKey = $("api-key").value.trim();
  state.busy = true;
  state.busyKind = "test";
  updateUI();
  try {
    if (!endpoint || !model) throw new Error("请填写 API 基础地址并选择模型。");
    await requestOrigin(endpoint);
    await persistDraft(endpoint, model, apiKey);
    aiStatus("");
    await testAIConnection(endpoint, model, apiKey);
    await persistDraft(endpoint, model, apiKey, Date.now());
    toast("连接成功，设置已保存。");
    notice("");
  } catch (error) {
    aiStatus("");
    toast(error.message, "error");
  } finally {
    state.busy = false;
    state.busyKind = "";
    updateUI();
  }
  if (!endpoint) $("endpoint").focus();
  else if (!model) $("model").focus();
}

async function chooseMode(mode) {
  closeInfoTips();
  if (state.busy) return;
  state.mode = mode;
  await chrome.storage.local.set({ organizerSettings: { ...state.settings, mode, basis: state.basis, language: state.language } });
  updateUI();
  if (mode === "ai" && !aiReady()) {
    openAISettings();
    aiStatus(state.settings.hadApiKey && !state.apiKey
      ? "请填写 API Key，再保存设置。"
      : "请先填写 API 地址和模型；测试连接是可选的。", "");
  } else {
    notice("");
  }
}

async function choosePreference() {
  if (state.busy) return;
  state.basis = $("basis").value === "topic" ? "topic" : "site";
  state.language = ["zh", "en"].includes($("language").value) ? $("language").value : "auto";
  updateUI();
  await chrome.storage.local.set({
    organizerSettings: { ...state.settings, mode: state.mode, basis: state.basis, language: state.language }
  });
}

async function init() {
  initAppearance();
  initTour();
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    $("app-version").textContent = chrome.runtime.getManifest().version;
  }
  if (typeof chrome !== "undefined") {
    try {
      await chrome.storage?.local?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    } catch { /* Storage remains usable if this privacy hardening fails. */ }
  }
  initInfoTips();
  $("scope-change").addEventListener("click", openScopeEditor);
  $("scope-cancel").addEventListener("click", () => {
    state.scopeEditorOpen = false;
    updateUI();
    $("scope-change").focus();
  });
  $("scope-confirm").addEventListener("click", confirmScopeChoice);
  for (const radio of document.querySelectorAll('input[name="scope-mode"]')) {
    radio.addEventListener("change", updateUI);
  }
  $("organize").addEventListener("click", organize);
  $("preview-button").addEventListener("click", preview);
  $("preview-back").addEventListener("click", closePreview);
  $("preview-cancel").addEventListener("click", closePreview);
  $("preview-apply").addEventListener("click", applyPreview);
  $("organize-tab").addEventListener("click", () => {
    if (!state.busy) showView("main");
  });
  $("performance-tab").addEventListener("click", openPerformance);
  for (const [index, id] of ["organize-tab", "performance-tab"].entries()) {
    $(id).addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
      $(next === 0 ? "organize-tab" : "performance-tab").click();
    });
  }
  for (const [id, showAll] of [["performance-filter-eligible", false], ["performance-filter-all", true]]) {
    $(id).addEventListener("click", () => {
      state.showAllPerformanceGroups = showAll;
      renderPerformance();
      updateUI();
    });
  }
  $("performance-select-all").addEventListener("click", () => {
    if (!state.performance || state.busy) return;
    state.selectedPerformanceTabs = new Set(state.performance.groups
      .flatMap(group => group.tabs.filter(tab => !tab.reason).map(tab => tab.id)));
    renderPerformance();
    updateUI();
  });
  $("performance-clear-selection").addEventListener("click", () => {
    state.selectedPerformanceTabs.clear();
    renderPerformance();
    updateUI();
  });
  $("performance-refresh").addEventListener("click", () => {
    performanceNotice("");
    void refreshPerformance();
  });
  $("performance-discard").addEventListener("click", discardSelectedPerformanceTabs);
  $("performance-settings").addEventListener("click", openChromePerformanceSettings);
  $("undo").addEventListener("click", undo);
  $("settings-button").addEventListener("click", () => showView("settings"));
  $("open-sidepanel").addEventListener("click", openSidePanel);
  for (const radio of document.querySelectorAll('input[name="presentation"]')) {
    radio.addEventListener("change", () => choosePresentationMode(radio.value));
  }
  $("settings-back").addEventListener("click", () => showView(state.settingsReturnModule));
  $("save-settings").addEventListener("click", saveSettings);
  $("get-models").addEventListener("click", getModels);
  $("test-connection").addEventListener("click", testConnection);
  $("toggle-api-key").addEventListener("click", toggleApiKeyVisibility);
  $("clear-memory").addEventListener("click", clearMemory);
  $("basis").addEventListener("change", choosePreference);
  $("language").addEventListener("change", choosePreference);
  for (const id of ["endpoint", "model", "api-key"]) {
    $(id).addEventListener("input", () => {
      aiStatus("");
      if (id === "endpoint" || id === "api-key") {
        $("model-list").replaceChildren();
        $("model-status").hidden = true;
      }
      updateUI();
    });
  }
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => chooseMode(radio.value));
  }
  if (typeof chrome !== "undefined") {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.organizerCorrections) void refreshMemoryCount();
      if (area === "local" && changes.organizerScopeMode) {
        const mode = changes.organizerScopeMode.newValue;
        state.scopeMode = ["incremental", "all"].includes(mode) ? mode : null;
        state.scopeEditorOpen = false;
        updateUI();
      }
      if (area === "session" && changes.panelLanding) applyPanelLanding(changes.panelLanding.newValue);
      if (area === "local" && changes.presentationMode) {
        state.presentationMode = changes.presentationMode.newValue === "popup" ? "popup" : "sidepanel";
        document.querySelector(`input[name="presentation"][value="${state.presentationMode}"]`).checked = true;
      }
    });
    let windowRefreshTimer = null;
    const scheduleWindowRefresh = () => {
      if (state.busy || !Number.isInteger(state.windowId)) return;
      window.clearTimeout(windowRefreshTimer);
      windowRefreshTimer = window.setTimeout(() => {
        void Promise.allSettled([refreshTabs(), refreshPerformance()]);
      }, 240);
    };
    chrome.tabs?.onUpdated?.addListener((_id, _change, tab) => {
      if (tab?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onCreated?.addListener(tab => {
      if (tab?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onActivated?.addListener(info => {
      if (info?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onRemoved?.addListener((_id, info) => {
      if (info?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onMoved?.addListener((_id, info) => {
      if (info?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onAttached?.addListener((_id, info) => {
      if (info?.newWindowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabs?.onDetached?.addListener((_id, info) => {
      if (info?.oldWindowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabGroups?.onCreated?.addListener(group => {
      if (group?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabGroups?.onUpdated?.addListener(group => {
      if (group?.windowId === state.windowId) scheduleWindowRefresh();
    });
    chrome.tabGroups?.onRemoved?.addListener(group => {
      if (group?.windowId === state.windowId) scheduleWindowRefresh();
    });
  }
  if (typeof chrome === "undefined" || !chrome.windows?.getCurrent) {
    notice("请从 Chrome 工具栏的扩展图标打开；直接打开页面无法读取当前窗口。", "error");
    state.performanceError = "本地文件预览只展示界面；请从 Chrome 工具栏的扩展图标打开，才能读取当前窗口。";
    state.performance = previewPerformanceData;
    state.previewOnly = true;
    renderPerformance();
    updateUI();
    return;
  }
  try {
    state.windowId = await findWindowId();
    const [local, session] = await Promise.all([
      chrome.storage.local.get(["organizerSettings", "organizerApiKey", "presentationMode", "organizerScopeMode", "organizerTourDone"]),
      chrome.storage.session.get(["organizerApiKey", "panelLanding"])
    ]);
    state.settings = { ...state.settings, ...local.organizerSettings };
    state.scopeMode = ["incremental", "all"].includes(local.organizerScopeMode) ? local.organizerScopeMode : null;
    state.tourDone = local.organizerTourDone === true;
    state.tourLoaded = true;
    state.presentationMode = local.presentationMode === "popup" ? "popup" : "sidepanel";
    document.querySelector(`input[name="presentation"][value="${state.presentationMode}"]`).checked = true;
    state.apiKey = local.organizerApiKey || session.organizerApiKey || "";
    if (!local.organizerApiKey && session.organizerApiKey) {
      await chrome.storage.local.set({ organizerApiKey: session.organizerApiKey });
      await chrome.storage.session.remove("organizerApiKey");
    }
    state.mode = state.settings.mode === "ai" ? "ai" : "rules";
    state.basis = state.settings.basis === "topic" ? "topic" : "site";
    state.language = ["zh", "en"].includes(state.settings.language) ? state.settings.language : "auto";
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    $("basis").value = state.basis;
    $("language").value = state.language;
    $("endpoint").value = state.settings.endpoint || "";
    $("model").value = state.settings.model || "";
    $("api-key").value = state.apiKey;
    await refreshMemoryCount();
    await refreshTabs();
    await refreshPerformance();
    applyPanelLanding(session.panelLanding);
    requestAnimationFrame(() => startTour());
  } catch (error) {
    notice(error.message, "error");
    updateUI();
  }
}

init();
