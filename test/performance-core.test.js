import test from "node:test";
import assert from "node:assert/strict";
import { performanceGroups, performanceTotals, releaseReason } from "../performance-core.js";

const webTab = overrides => ({
  id: 1, index: 0, windowId: 10, groupId: 7, url: "https://example.test/page",
  title: "Example", active: false, pinned: false, audible: false,
  discarded: false, autoDiscardable: true, status: "complete", ...overrides
});

test("release policy protects visible state and only accepts stable web pages", () => {
  assert.equal(releaseReason(webTab()), null);
  for (const [change, reason] of [
    [{ active: true }, "active"],
    [{ discarded: true }, "discarded"],
    [{ pinned: true }, "pinned"],
    [{ audible: true }, "audible"],
    [{ autoDiscardable: false }, "protected"],
    [{ status: "loading" }, "loading"],
    [{ pendingUrl: "https://next.test" }, "loading"],
    [{ splitViewId: 42 }, "split"],
    [{ url: "https://example.test/file.pdf" }, "pdf"],
    [{ url: "chrome://settings/performance" }, "unsupported"],
    [{ url: "file:///Users/example/private.html" }, "unsupported"],
    [{ url: undefined }, "unsupported"]
  ]) assert.equal(releaseReason(webTab(change)), reason);
  assert.equal(releaseReason(webTab({ splitViewId: -1 })), null);
});

test("group aggregation retains native group identity and separates eligible, released and protected tabs", () => {
  const tabs = [
    webTab({ id: 1, index: 2, groupId: 7 }),
    webTab({ id: 2, index: 3, groupId: 7, discarded: true }),
    webTab({ id: 3, index: 4, groupId: 7, audible: true }),
    webTab({ id: 4, index: 5, groupId: -1 }),
    webTab({ id: 5, index: 6, groupId: 8, active: true })
  ];
  const groups = performanceGroups(tabs, [
    { id: 7, title: "学习资料", color: "blue", collapsed: true },
    { id: 8, title: "工作", color: "green", collapsed: false }
  ]);
  assert.deepEqual(groups.map(group => [group.id, group.title, group.eligibleCount, group.discardedCount, group.protectedCount]), [
    [7, "学习资料", 1, 1, 1], [-1, "其他后台标签", 1, 0, 0], [8, "工作", 0, 0, 1]
  ]);
  assert.equal(groups[0].collapsed, true);
  assert.equal(groups[0].tabs[2].state, "正在播放音频");
  assert.deepEqual(performanceTotals(groups), { all: 5, eligible: 2, discarded: 1, protected: 2 });
});
