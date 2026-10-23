import test from "node:test";
import assert from "node:assert/strict";

test("presentation preference routes toolbar and context menu without changing tab operations", async () => {
  let actionClick;
  let contextMenuClick;
  let messageListener;
  let startupListener;
  const popupPaths = [];
  const openedPanels = [];
  const stored = {};
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener(listener) { startupListener = listener; } },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: {
      onClicked: { addListener(listener) { actionClick = listener; } },
      async setPopup({ popup }) { popupPaths.push(popup); }
    },
    sidePanel: {
      async open({ windowId }) { openedPanels.push(windowId); }
    },
    contextMenus: {
      create() {},
      onClicked: { addListener(listener) { contextMenuClick = listener; } }
    },
    tabs: { onUpdated: { addListener() {} } },
    tabGroups: { onUpdated: { addListener() {} } },
    storage: {
      local: {
        async get() { return { ...stored }; },
        async set(values) { Object.assign(stored, values); }
      }
    }
  };
  try {
    await import(`../background.js?presentation=${Date.now()}`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(popupPaths.at(-1), "", "new installs should open the side panel by default");

    actionClick({ windowId: 9 });
    assert.deepEqual(openedPanels, [9]);

    const send = message => new Promise(resolve => messageListener(message, {}, resolve));
    assert.deepEqual(await send({ type: "set-presentation-mode", mode: "popup" }), { ok: true, mode: "popup" });
    assert.equal(popupPaths.at(-1), "popup.html");
    assert.equal(stored.presentationMode, "popup");
    startupListener();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(popupPaths.at(-1), "popup.html", "stored preference should be restored on browser startup");

    assert.deepEqual(await send({ type: "set-presentation-mode", mode: "sidepanel" }), { ok: true, mode: "sidepanel" });
    assert.equal(popupPaths.at(-1), "");
    assert.equal(stored.presentationMode, "sidepanel");

    await contextMenuClick({ menuItemId: "organize-current-window" }, { windowId: 9 });
    assert.deepEqual(openedPanels, [9, 9]);
  } finally {
    delete globalThis.chrome;
  }
});
