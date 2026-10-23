import test from "node:test";
import assert from "node:assert/strict";

test("applying and undoing suggestions changes only new native groups", async () => {
  let messageListener;
  let contextMenuListener;
  let tabUpdatedListener;
  let groupUpdatedListener;
  let nextGroupId = 20;
  let localSettings = { mode: "rules", endpoint: "", model: "" };
  let localApiKey = "";
  let organizerCorrections = [];
  const store = new Map();
  const openedPopups = [];
  let tabs = [
    { id: 1, title: "Pinned", url: "https://a.test", pinned: true, groupId: -1, windowId: 10 },
    { id: 2, title: "IndexTTS", url: "https://b.test", pinned: false, groupId: -1, windowId: 10 },
    { id: 3, title: "Existing A", url: "https://c.test", pinned: false, groupId: 7, windowId: 10 },
    { id: 4, title: "Existing B", url: "https://d.test", pinned: false, groupId: 7, windowId: 10 },
    { id: 5, title: "FunASR", url: "https://e.test", pinned: false, groupId: -1, windowId: 10 },
    { id: 6, title: "Unrelated", url: "https://f.test", pinned: false, groupId: -1, windowId: 10 }
  ];
  const groups = new Map([[7, { title: "User group", color: "red" }]]);
  const indexed = () => tabs.map((tab, index) => ({ ...tab, index }));
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: { async openPopup(options) { openedPopups.push(options); } },
    contextMenus: { create() {}, onClicked: { addListener(listener) { contextMenuListener = listener; } } },
    tabs: {
      onUpdated: { addListener(listener) { tabUpdatedListener = listener; } },
      async query(query) {
        return indexed().filter(tab =>
          (query.windowId == null || tab.windowId === query.windowId)
          && (query.groupId == null || tab.groupId === query.groupId));
      },
      async get(id) {
        const tab = indexed().find(tab => tab.id === id);
        if (!tab) throw new Error("Tab not found");
        return tab;
      },
      async group({ tabIds }) {
        const selected = tabs.filter(tab => tabIds.includes(tab.id));
        const index = Math.min(...selected.map(tab => tabs.indexOf(tab)));
        tabs = tabs.filter(tab => !tabIds.includes(tab.id));
        selected.forEach(tab => { tab.groupId = nextGroupId; });
        tabs.splice(index, 0, ...selected);
        groups.set(nextGroupId, { title: "", color: "grey" });
        return nextGroupId++;
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
      onUpdated: { addListener(listener) { groupUpdatedListener = listener; } },
      async get(id) { return { id, windowId: 10, ...groups.get(id) }; },
      async update(id, properties) { Object.assign(groups.get(id), properties); }
    },
    storage: {
      local: {
        async get() { return { organizerSettings: localSettings, organizerCorrections, organizerApiKey: localApiKey }; },
        async set(value) { if (value.organizerCorrections) organizerCorrections = value.organizerCorrections; },
        async remove(key) { if (key === "organizerCorrections") organizerCorrections = []; }
      },
      session: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store.get(key)])); },
        async set(value) { for (const [key, item] of Object.entries(value)) store.set(key, item); },
        async remove(key) { store.delete(key); }
      }
    }
  };
  await import(`../background.js?test=${Date.now()}`);
  const send = message => new Promise(resolve => messageListener(message, {}, resolve));

  await contextMenuListener({ menuItemId: "organize-current-window" }, { windowId: 10 });
  assert.deepEqual(openedPopups, [{ windowId: 10 }]);

  const incomplete = await send({
    type: "apply", windowId: 10,
    groups: [{ title: "语音", color: "purple", tabIds: [2, 5] }]
  });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /未覆盖全部/);

  const applied = await send({
    type: "apply", windowId: 10,
    groups: [
      { title: "语音", color: "purple", tabIds: [2, 5, 1, 3] },
      { title: "待核对", color: "grey", tabIds: [6] }
    ]
  });
  assert.deepEqual({ ok: applied.ok, groupCount: applied.groupCount, tabCount: applied.tabCount },
    { ok: true, groupCount: 2, tabCount: 3 });
  assert.equal(groups.get(7).title, "User group");
  assert.deepEqual(indexed().filter(tab => tab.groupId === 7).map(tab => tab.id), [3, 4]);
  assert.deepEqual(indexed().filter(tab => tab.groupId === 20).map(tab => tab.id), [2, 5]);
  assert.deepEqual(indexed().filter(tab => tab.groupId === 21).map(tab => tab.id), [6]);

  const undone = await send({ type: "undo", windowId: 10 });
  assert.deepEqual(undone, { ok: true, restoredCount: 3, priorRestored: 0, orderRestored: true });
  assert.deepEqual(indexed().map(tab => tab.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(indexed().filter(tab => tab.groupId === 7).map(tab => tab.id), [3, 4]);
  assert.equal(store.has("lastOperation:10"), false);

  const noAISettings = await send({ type: "organize", windowId: 10, mode: "ai" });
  assert.equal(noAISettings.ok, false);
  assert.match(noAISettings.error, /填写 AI 接口/);

  const oneClick = await send({ type: "organize", windowId: 10, mode: "rules" });
  assert.deepEqual({ ok: oneClick.ok, tabCount: oneClick.tabCount }, { ok: true, tabCount: 3 });
  assert.equal(store.has("lastOperation:10"), true);
  await send({ type: "undo", windowId: 10 });

  localSettings = { mode: "ai", basis: "topic", endpoint: "https://api.example.test/v1/chat/completions", model: "test-model", hadApiKey: true, testedAt: Date.now() };
  localApiKey = "persistent-key";
  localSettings.testedAt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer persistent-key");
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      async text() { return JSON.stringify({ choices: [{ message: { content: '{"groups":[{"title":"语音","color":"purple","tabIds":[2,5]}]}' } }] }); } };
  };
  try {
    const aiOneClick = await send({ type: "organize", windowId: 10, mode: "ai" });
    assert.deepEqual({ ok: aiOneClick.ok, groupCount: aiOneClick.groupCount, tabCount: aiOneClick.tabCount },
      { ok: true, groupCount: 2, tabCount: 3 });
    assert.equal(aiOneClick.diagnostics.reviewCount, 1);
    assert.equal(aiOneClick.diagnostics.omittedCount, 1);
    assert.deepEqual(store.get("lastOperation:10").diagnostics, aiOneClick.diagnostics);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(typeof tabUpdatedListener, "function");
  assert.equal(typeof groupUpdatedListener, "function");
  const operation = store.get("lastOperation:10");
  const voiceGroup = operation.created.find(group => group.tabIds.includes(2));
  const moved = tabs.find(tab => tab.id === 6);
  moved.groupId = voiceGroup.groupId;
  tabUpdatedListener(6, { groupId: voiceGroup.groupId }, indexed().find(tab => tab.id === 6));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(organizerCorrections.length, 1);
  assert.equal(organizerCorrections[0].title, "语音");
  groupUpdatedListener({ id: voiceGroup.groupId, windowId: 10, title: "语音与音频" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(organizerCorrections.length, 3);
  assert.equal(organizerCorrections.filter(item => item.title === "语音与音频").length, 2);
  assert.equal((await send({ type: "clear-memory" })).ok, true);
  assert.equal(organizerCorrections.length, 0);
  assert.equal(store.has("lastOperation:10"), true);
  delete globalThis.chrome;
});
