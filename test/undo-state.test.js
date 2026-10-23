import test from "node:test";
import assert from "node:assert/strict";
import { correctionKey } from "../core.js";
import { makeUndoOperation, matchUndoOperation, restoredOrderIds } from "../undo-state.js";

const original = [
  { id: 1, windowId: 10, groupId: -1, title: "Alpha", url: "https://a.test/" },
  { id: 2, windowId: 10, groupId: -1, title: "Beta", url: "https://b.test/" },
  { id: 3, windowId: 10, groupId: -1, title: "Gamma", url: "https://c.test/" }
];
const operation = await makeUndoOperation(10, original, [
  { groupId: 20, tabIds: [1, 3], title: "项目", color: "blue",
    keys: { 1: correctionKey(original[0]), 3: correctionKey(original[2]) } }
], null, 123);

test("restored group can be matched with new browser-scoped IDs", async () => {
  const tabs = [
    { ...original[0], id: 101, windowId: 11, groupId: 120 },
    { ...original[2], id: 103, windowId: 11, groupId: 120 },
    { ...original[1], id: 102, windowId: 11, groupId: -1 }
  ];
  const match = await matchUndoOperation([operation], tabs,
    [{ id: 120, title: "项目", color: "blue" }], 11);
  assert.equal(match?.restored, true);
  assert.deepEqual(match?.groups[0].tabIds, [101, 103]);
  assert.deepEqual(await restoredOrderIds(operation.originalSignatures, tabs), [101, 102, 103]);
});

test("changed or ambiguous restored groups are not silently undone", async () => {
  const tabs = [
    { ...original[0], id: 101, windowId: 11, groupId: 120 },
    { ...original[2], id: 103, windowId: 11, groupId: 120 }
  ];
  assert.equal(await matchUndoOperation([operation], tabs,
    [{ id: 120, title: "其他", color: "blue" }], 11), null);
  assert.equal(await matchUndoOperation([operation, { ...operation, id: "other" }], tabs,
    [{ id: 120, title: "项目", color: "blue" }], 11), null);
});

test("page title changes do not invalidate a restored group with the same URLs", async () => {
  const tabs = [
    { ...original[0], id: 101, windowId: 11, groupId: 120, title: "Alpha (3)" },
    { ...original[2], id: 103, windowId: 11, groupId: 120, title: "Gamma (new)" },
    { ...original[1], id: 102, windowId: 11, groupId: -1 }
  ];
  const match = await matchUndoOperation([operation], tabs,
    [{ id: 120, title: "项目", color: "blue" }], 11);
  assert.equal(match?.restored, true);
});
