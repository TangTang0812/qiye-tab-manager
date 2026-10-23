import test from "node:test";
import assert from "node:assert/strict";

test("manual group release preserves grouping and reports stale or protected targets individually", async () => {
  let listener;
  const stored = new Map();
  const tabs = [
    { id: 1, index: 0, windowId: 10, groupId: 7, url: "https://a.test", title: "当前", active: true },
    { id: 2, index: 1, windowId: 10, groupId: 7, url: "https://b.test", title: "后台", active: false },
    { id: 3, index: 2, windowId: 10, groupId: 7, url: "https://c.test", title: "播放", audible: true },
    { id: 4, index: 3, windowId: 10, groupId: 8, url: "https://d.test", title: "移动" },
    { id: 5, index: 4, windowId: 10, groupId: 7, url: "https://e.test", title: "已释放", discarded: true },
    { id: 6, index: 5, windowId: 10, groupId: -1, url: "https://f.test", title: "导航" }
  ];
  globalThis.chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    action: { async openPopup() {} },
    tabs: {
      onUpdated: { addListener() {} },
      async query({ windowId }) { return tabs.filter(tab => tab.windowId === windowId).map(tab => ({ ...tab })); },
      async get(id) {
        const tab = tabs.find(item => item.id === id);
        if (!tab) throw new Error("No tab");
        return { ...tab };
      },
      async discard(id) {
        const tab = tabs.find(item => item.id === id);
        tab.discarded = true;
        return { ...tab };
      }
    },
    tabGroups: {
      onUpdated: { addListener() {} },
      async get(id) { return { id, windowId: 10, title: id === 7 ? "学习" : "工作", color: "blue", collapsed: id === 7 }; }
    },
    storage: {
      local: { async setAccessLevel() {} },
      session: {
        async get(key) { return { [key]: stored.get(key) }; },
        async set(values) { for (const [key, value] of Object.entries(values)) stored.set(key, structuredClone(value)); }
      }
    }
  };
  try {
    await import(`../background.js?performance=${Date.now()}`);
    const send = message => new Promise(resolve => listener(message, {}, resolve));
    const first = await send({ type: "performance-status", windowId: 10 });
    assert.equal(first.ok, true);
    assert.deepEqual(first.totals, { all: 6, eligible: 3, discarded: 1, protected: 2 });
    assert.equal(first.groups[0].title, "学习");
    assert.equal(first.groups[0].collapsed, true);

    const targets = [1, 2, 3, 4, 6].map(id => {
      const tab = tabs.find(item => item.id === id);
      return { id, groupId: tab.groupId, url: tab.url };
    });
    tabs.find(tab => tab.id === 4).windowId = 11;
    tabs.find(tab => tab.id === 6).url = "https://new.test";
    const result = await send({ type: "discard-tabs", windowId: 10, targets });
    assert.deepEqual({ ok: result.ok, released: result.released, skipped: result.skipped, failed: result.failed },
      { ok: true, released: 1, skipped: 4, failed: 0 });
    assert.deepEqual(result.reasons.map(item => item.reason), ["active", "audible", "moved", "changed"]);
    assert.equal(tabs.find(tab => tab.id === 2).discarded, true);
    assert.equal(tabs.find(tab => tab.id === 2).groupId, 7);
    assert.equal(stored.get("performanceOperation:10").status, "complete");

    stored.set("performanceOperation:10", { status: "running", requested: 3, results: [{ id: 2, result: "released" }] });
    const interrupted = await send({ type: "performance-status", windowId: 10 });
    assert.equal(interrupted.operation.status, "interrupted");
  } finally {
    delete globalThis.chrome;
  }
});
