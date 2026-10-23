const REASON_LABELS = Object.freeze({
  active: "当前标签",
  discarded: "已释放",
  pinned: "固定标签",
  audible: "正在播放音频",
  protected: "禁止自动丢弃",
  loading: "正在加载",
  split: "分屏标签",
  pdf: "PDF 页面",
  unsupported: "特殊页面",
  missing: "标签已关闭",
  moved: "已移出当前窗口",
  changed: "页面或分组已变化",
  failed: "释放失败"
});

export function releaseReason(tab) {
  if (!tab || !Number.isInteger(tab.id)) return "missing";
  if (tab.active) return "active";
  if (tab.discarded) return "discarded";
  if (tab.pinned) return "pinned";
  if (tab.audible) return "audible";
  if (tab.autoDiscardable === false) return "protected";
  if (tab.status === "loading" || tab.pendingUrl) return "loading";
  if (Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0) return "split";
  try {
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol)) return "unsupported";
    if (/\.pdf$/i.test(url.pathname)) return "pdf";
  } catch {
    return "unsupported";
  }
  return null;
}

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || REASON_LABELS.failed;
}

export function performanceGroups(tabs, groups = []) {
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const buckets = new Map();
  for (const tab of [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const groupId = Number.isInteger(tab.groupId) ? tab.groupId : -1;
    if (!buckets.has(groupId)) {
      const group = groupMap.get(groupId);
      buckets.set(groupId, {
        id: groupId,
        title: groupId < 0 ? "其他后台标签" : group?.title?.trim() || "未命名分组",
        color: groupId < 0 ? "grey" : group?.color || "grey",
        collapsed: Boolean(group?.collapsed),
        tabs: [], eligibleCount: 0, discardedCount: 0, protectedCount: 0
      });
    }
    const bucket = buckets.get(groupId);
    const reason = releaseReason(tab);
    let host = "";
    try { host = new URL(tab.url).hostname; } catch { /* Special pages have no site hostname. */ }
    bucket.tabs.push({
      id: tab.id,
      title: tab.title || host || "未命名标签",
      host,
      url: tab.url || "",
      reason,
      state: reason ? reasonLabel(reason) : "可释放"
    });
    if (!reason) bucket.eligibleCount++;
    else if (reason === "discarded") bucket.discardedCount++;
    else bucket.protectedCount++;
  }
  return [...buckets.values()];
}

export function performanceTotals(groups) {
  return groups.reduce((total, group) => ({
    all: total.all + group.tabs.length,
    eligible: total.eligible + group.eligibleCount,
    discarded: total.discarded + group.discardedCount,
    protected: total.protected + group.protectedCount
  }), { all: 0, eligible: 0, discarded: 0, protected: 0 });
}
