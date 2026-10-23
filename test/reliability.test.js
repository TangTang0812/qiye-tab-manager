import test from "node:test";
import assert from "node:assert/strict";

function backgroundHarness({ failGroupAt = 0, pauseGroupAt = 0 } = {}) {
  let messageListener;
  let groupCalls = 0;
  let nextGroupId = 30;
  let resumeGroup;
  let signalGroupStarted;
  const groupStarted = new Promise(resolve => { signalGroupStarted = resolve; });
  const groupPause = new Promise(resolve => { resumeGroup = resolve; });
  const session = new Map();
  const local = new Map();
  const groups = new Map();
  let tabs = [1, 2, 3, 4, 5].map(id => ({
    id, title: `Page ${id}`, url: `https://site${id}.example/`, pinned: false, groupId: -1, windowId: 10
  }));
  const indexed = () => tabs.map((tab, index) => ({ ...tab, index }));

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: { async openPopup() {} },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    tabs: {
      onUpdated: { addListener() {} },
      async query(query) {
        return indexed().filter(tab => (query.windowId == null || tab.windowId === query.windowId)
          && (query.groupId == null || tab.groupId === query.groupId));
      },
      async get(id) {
        const tab = indexed().find(item => item.id === id);
        if (!tab) throw new Error("Tab not found");
        return tab;
      },
      async group({ tabIds, groupId }) {
        groupCalls++;
        if (groupCalls === pauseGroupAt) {
          signalGroupStarted();
          await groupPause;
        }
        if (groupCalls === failGroupAt) throw new Error("Forced grouping failure");
        const selected = tabs.filter(tab => tabIds.includes(tab.id));
        const index = Math.min(...selected.map(tab => tabs.indexOf(tab)));
        tabs = tabs.filter(tab => !tabIds.includes(tab.id));
        const targetGroupId = Number.isInteger(groupId) ? groupId : nextGroupId++;
        selected.forEach(tab => { tab.groupId = targetGroupId; });
        if (!groups.has(targetGroupId)) groups.set(targetGroupId,
          { id: targetGroupId, windowId: selected[0].windowId, title: "", color: "grey" });
        tabs.splice(index, 0, ...selected);
        return targetGroupId;
      },
      async ungroup(ids) {
        tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.groupId = -1; });
      },
      async move(id, { index }) {
        const at = tabs.findIndex(tab => tab.id === id);
        const [tab] = tabs.splice(at, 1);
        tabs.splice(index, 0, tab);
        return tab;
      }
    },
    tabGroups: {
      onUpdated: { addListener() {} },
      async get(id) {
        if (!tabs.some(tab => tab.groupId === id)) throw new Error("Group not found");
        return groups.get(id);
      },
      async update(id, values) { Object.assign(groups.get(id), values); }
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, local.get(key)])); },
        async set(values) { for (const [key, value] of Object.entries(values)) local.set(key, value); },
        async remove(key) { local.delete(key); }
      },
      session: {
        async get(keys) {
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, session.get(key)]));
        },
        async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
        async remove(key) { session.delete(key); }
      }
    }
  };

  return {
    async load() { await import(`../background.js?reliability=${Date.now()}-${Math.random()}`); },
    send(message) { return new Promise(resolve => messageListener(message, {}, resolve)); },
    ids() { return tabs.map(tab => tab.id); },
    groupIds() { return tabs.map(tab => tab.groupId); },
    tabGroup(id) { return tabs.find(tab => tab.id === id)?.groupId; },
    groupForTab(id) { return groups.get(this.tabGroup(id)); },
    renameTab(id, title) { tabs.find(tab => tab.id === id).title = title; },
    setUrl(id, url) { tabs.find(tab => tab.id === id).url = url; },
    setGroup(id, groupId) { tabs.find(tab => tab.id === id).groupId = groupId; },
    addTab(id, groupId = -1) {
      tabs.push({ id, title: `Page ${id}`, url: `https://site${id}.example/`, pinned: false,
        groupId, windowId: tabs[0].windowId });
    },
    addManualGroup(id, groupId = 99) {
      groups.set(groupId, { id: groupId, windowId: tabs[0].windowId, title: "Manual", color: "red" });
      this.addTab(id, groupId);
    },
    groupStarted,
    releaseGroup() { resumeGroup(); },
    session,
    local,
    restart() {
      for (const tab of tabs) {
        tab.id += 100;
        tab.windowId = 110;
        if (tab.groupId >= 0) tab.groupId += 100;
      }
      const oldGroups = [...groups.values()];
      groups.clear();
      for (const group of oldGroups) groups.set(group.id + 100,
        { ...group, id: group.id + 100, windowId: 110 });
      session.clear();
    }
  };
}

const proposedGroups = [
  { title: "First", color: "blue", tabIds: [1, 3] },
  { title: "Second", color: "green", tabIds: [2, 4, 5] }
];

test("a failed later group restores the original tab order and leaves no undo record", async () => {
  const harness = backgroundHarness({ failGroupAt: 2 });
  try {
    await harness.load();
    const result = await harness.send({ type: "apply", windowId: 10, groups: proposedGroups });
    assert.equal(result.ok, false);
    assert.match(result.error, /Forced grouping failure/);
    assert.deepEqual(harness.ids(), [1, 2, 3, 4, 5]);
    assert.deepEqual(harness.groupIds(), [-1, -1, -1, -1, -1]);
    assert.equal(harness.session.has("lastOperation:10"), false);
  } finally {
    delete globalThis.chrome;
  }
});

test("undo cannot overlap an in-progress apply in the same window", async () => {
  const harness = backgroundHarness({ pauseGroupAt: 1 });
  try {
    await harness.load();
    const applying = harness.send({ type: "apply", windowId: 10, groups: proposedGroups });
    await harness.groupStarted;
    const overlapping = await harness.send({ type: "undo", windowId: 10 });
    assert.equal(overlapping.ok, false);
    assert.match(overlapping.error, /正在处理标签/);
    harness.releaseGroup();
    assert.equal((await applying).ok, true);
    assert.equal((await harness.send({ type: "undo", windowId: 10 })).ok, true);
    assert.deepEqual(harness.ids(), [1, 2, 3, 4, 5]);
  } finally {
    harness.releaseGroup();
    delete globalThis.chrome;
  }
});

test("undo survives browser restart when restored native groups still match", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    assert.equal((await harness.send({ type: "apply", windowId: 10, groups: proposedGroups })).ok, true);
    assert.equal(harness.local.get("organizerOperations").length, 1);
    harness.restart();
    await harness.load();
    const status = await harness.send({ type: "undo-status", windowId: 110 });
    assert.deepEqual({ available: status.available, restored: status.restored }, { available: true, restored: true });
    const result = await harness.send({ type: "undo", windowId: 110 });
    assert.equal(result.ok, true);
    assert.equal(result.orderRestored, true);
    assert.deepEqual(harness.ids(), [101, 102, 103, 104, 105]);
    assert.deepEqual(harness.groupIds(), [-1, -1, -1, -1, -1]);
    assert.deepEqual(harness.local.get("organizerOperations"), []);
  } finally {
    delete globalThis.chrome;
  }
});

test("restart matching permits newer tabs in an owned group but undo leaves those tabs untouched", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    assert.equal((await harness.send({ type: "apply", windowId: 10, groups: proposedGroups })).ok, true);
    harness.addTab(6, harness.groupIds()[0]);
    harness.restart();
    await harness.load();
    const status = await harness.send({ type: "undo-status", windowId: 110 });
    assert.equal(status.available, true);
    assert.equal(status.revisitedCount, 6);
    const result = await harness.send({ type: "undo", windowId: 110 });
    assert.equal(result.ok, true);
    assert.equal(result.restoredCount, 5);
    assert.equal(result.orderRestored, false);
    assert.notEqual(harness.tabGroup(106), -1);
  } finally {
    delete globalThis.chrome;
  }
});

test("repeat organization revisits owned groups and undo restores the prior grouping", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    assert.equal((await harness.send({ type: "apply", windowId: 10, groups: proposedGroups })).ok, true);
    const prior = harness.groupIds();
    harness.addTab(6, prior[0]);
    harness.addTab(7);
    harness.addManualGroup(8);
    const status = await harness.send({ type: "undo-status", windowId: 10 });
    assert.equal(status.organizableCount, 7);
    assert.equal(status.revisitedCount, 6);
    const repeat = await harness.send({ type: "organize", windowId: 10, mode: "rules" });
    assert.equal(repeat.ok, true);
    assert.equal(repeat.tabCount, 7);
    const undone = await harness.send({ type: "undo", windowId: 10 });
    assert.equal(undone.ok, true);
    assert.equal(undone.priorRestored, 6);
    assert.equal(harness.tabGroup(8), 99);
    assert.equal(harness.tabGroup(7), -1);
    assert.equal(new Set([1, 2, 3, 4, 5, 6].map(id => harness.tabGroup(id))).size, 2);
    assert.equal((await harness.send({ type: "undo-status", windowId: 10 })).available, true);
  } finally {
    delete globalThis.chrome;
  }
});

test("repeat organization can be undone after restart, then the earlier undo remains available", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    assert.equal((await harness.send({ type: "apply", windowId: 10, groups: proposedGroups })).ok, true);
    harness.addTab(6, harness.groupIds()[0]);
    assert.equal((await harness.send({ type: "organize", windowId: 10, mode: "rules" })).ok, true);
    harness.restart();
    await harness.load();
    assert.equal((await harness.send({ type: "undo-status", windowId: 110 })).available, true);
    const repeatUndo = await harness.send({ type: "undo", windowId: 110 });
    assert.equal(repeatUndo.ok, true);
    assert.equal(repeatUndo.priorRestored, 6);
    assert.equal(repeatUndo.orderRestored, false);
    assert.equal((await harness.send({ type: "undo-status", windowId: 110 })).available, true);
    const firstUndo = await harness.send({ type: "undo", windowId: 110 });
    assert.equal(firstUndo.ok, true);
    assert.equal(firstUndo.restoredCount, 5);
    assert.notEqual(harness.tabGroup(106), -1);
  } finally {
    delete globalThis.chrome;
  }
});

test("preview is read-only, excludes manual groups and can apply its exact plan", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    assert.equal((await harness.send({ type: "apply", windowId: 10, groups: proposedGroups })).ok, true);
    harness.addTab(6, harness.groupIds()[0]);
    harness.addManualGroup(7);
    const before = harness.groupIds();
    const preview = await harness.send({ type: "preview", windowId: 10, mode: "rules" });
    assert.equal(preview.ok, true);
    assert.deepEqual(preview.tabs.map(tab => tab.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(harness.groupIds(), before);
    const applied = await harness.send({ type: "apply", windowId: 10, groups: preview.groups,
      tabs: preview.tabs, diagnostics: preview.diagnostics });
    assert.equal(applied.ok, true);
    assert.equal(applied.tabCount, 6);
    assert.equal(harness.tabGroup(7), 99);
  } finally {
    delete globalThis.chrome;
  }
});

test("a preview cannot be applied after the eligible tab set changes", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    const preview = await harness.send({ type: "preview", windowId: 10, mode: "rules" });
    assert.equal(preview.ok, true);
    harness.addTab(6);
    const result = await harness.send({ type: "apply", windowId: 10, groups: preview.groups });
    assert.equal(result.ok, false);
    assert.match(result.error, /未覆盖全部可整理标签/);
    assert.deepEqual(harness.groupIds(), [-1, -1, -1, -1, -1, -1]);
  } finally {
    delete globalThis.chrome;
  }
});

test("a preview cannot be applied after a tab title changes", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    const preview = await harness.send({ type: "preview", windowId: 10, mode: "rules" });
    harness.renameTab(1, "A different page");
    const result = await harness.send({ type: "apply", windowId: 10, groups: preview.groups, tabs: preview.tabs });
    assert.equal(result.ok, false);
    assert.match(result.error, /内容在生成建议后发生了变化/);
    assert.deepEqual(harness.groupIds(), [-1, -1, -1, -1, -1]);
  } finally {
    delete globalThis.chrome;
  }
});

test("all-scope preview includes manual groups, leaves unsupported tabs, and undo restores their membership", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    harness.addManualGroup(6, 99);
    harness.addTab(7, 99);
    harness.setUrl(7, "chrome-extension://example/options.html");
    const status = await harness.send({ type: "undo-status", windowId: 10 });
    assert.equal(status.organizableCount, 5);
    assert.equal(status.allCount, 6);
    const preview = await harness.send({ type: "preview", windowId: 10, mode: "rules", scopeMode: "all" });
    assert.equal(preview.ok, true);
    assert.equal(preview.scopeMode, "all");
    assert.deepEqual(preview.tabs.map(tab => tab.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    assert.equal(preview.tabs.find(tab => tab.id === 6).groupId, 99);
    const applied = await harness.send({ type: "apply", windowId: 10, groups: preview.groups,
      tabs: preview.tabs, scopeMode: preview.scopeMode });
    assert.equal(applied.ok, true);
    assert.equal(applied.tabCount, 6);
    assert.equal(harness.tabGroup(7), 99);
    assert.notEqual(harness.tabGroup(6), 99);
    const undone = await harness.send({ type: "undo", windowId: 10 });
    assert.equal(undone.ok, true);
    assert.equal(undone.priorRestored, 1);
    assert.equal(harness.tabGroup(6), 99);
    assert.equal(harness.groupForTab(6).title, "Manual");
    assert.equal(harness.tabGroup(7), 99);
  } finally {
    delete globalThis.chrome;
  }
});

test("all-scope preview refuses changed source group membership", async () => {
  const harness = backgroundHarness();
  try {
    await harness.load();
    harness.addManualGroup(6, 99);
    const preview = await harness.send({ type: "preview", windowId: 10, mode: "rules", scopeMode: "all" });
    assert.equal(preview.ok, true);
    harness.setGroup(6, -1);
    const applied = await harness.send({ type: "apply", windowId: 10, groups: preview.groups,
      tabs: preview.tabs, scopeMode: "all" });
    assert.equal(applied.ok, false);
    assert.match(applied.error, /内容在生成建议后发生了变化/);
    assert.equal(harness.tabGroup(6), -1);
  } finally {
    delete globalThis.chrome;
  }
});

test("a failed all-scope regrouping puts moved tabs back into a surviving manual group", async () => {
  const harness = backgroundHarness({ failGroupAt: 2 });
  try {
    await harness.load();
    harness.addManualGroup(6, 99);
    harness.addTab(7, 99);
    harness.setUrl(7, "chrome-extension://example/options.html");
    const result = await harness.send({ type: "apply", windowId: 10, scopeMode: "all", groups: [
      { title: "First", color: "blue", tabIds: [1, 6] },
      { title: "Second", color: "green", tabIds: [2, 3, 4, 5] }
    ] });
    assert.equal(result.ok, false);
    assert.match(result.error, /Forced grouping failure/);
    assert.deepEqual([1, 2, 3, 4, 5].map(id => harness.tabGroup(id)), [-1, -1, -1, -1, -1]);
    assert.equal(harness.tabGroup(6), 99);
    assert.equal(harness.tabGroup(7), 99);
    assert.equal(harness.groupForTab(6).title, "Manual");
    assert.equal(harness.local.get("organizerOperations"), undefined);
  } finally {
    delete globalThis.chrome;
  }
});
