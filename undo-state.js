import { correctionKey } from "./core.js";

async function signatureOf(tab) {
  if (!tab?.url) return `title:${correctionKey(tab)}`;
  let url = tab.url;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    url = parsed.href;
  } catch { /* Keep the browser-provided URL as-is. */ }
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return `url:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function matchingTabs(saved, current, signatures) {
  const available = new Map();
  for (const tab of current) {
    const key = saved.signatures ? signatures.get(tab.id) : correctionKey(tab);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(tab.id);
  }
  const matches = [];
  for (const savedId of saved.tabIds) {
    const key = saved.signatures?.[savedId] || saved.keys?.[savedId];
    const currentId = key && available.get(key)?.shift();
    if (Number.isInteger(currentId)) matches.push({ savedId, currentId });
  }
  return matches;
}

export async function makeUndoOperation(windowId, allTabs, created, diagnostics, timestamp = Date.now()) {
  const signatures = new Map(await Promise.all(allTabs.map(async tab => [tab.id, await signatureOf(tab)])));
  return {
    id: `${timestamp}:${windowId}:${crypto.randomUUID()}`,
    windowId,
    timestamp,
    originalOrder: allTabs.map(tab => tab.id),
    originalKeys: allTabs.map(correctionKey),
    originalSignatures: allTabs.map(tab => signatures.get(tab.id)),
    created: created.map(group => ({ ...group, color: group.color || "grey",
      signatures: Object.fromEntries(group.tabIds.map(id => [id, signatures.get(id)])) })),
    diagnostics
  };
}

export async function matchUndoOperation(operations, tabs, groups, windowId) {
  const signatures = new Map(await Promise.all(tabs.map(async tab => [tab.id, await signatureOf(tab)])));
  const candidates = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!Array.isArray(operation?.created) || !operation.created.length) continue;
    if (operation.windowId === windowId) {
      const direct = operation.created.map(saved => {
        const matches = matchingTabs(saved, tabs.filter(tab => tab.groupId === saved.groupId), signatures);
        return { groupId: saved.groupId, tabIds: matches.map(item => item.currentId), matches };
      }).filter(group => group.tabIds.length);
      if (direct.length) {
        candidates.push({ operation, groups: direct, restored: false });
        continue;
      }
    }
    const matchedIds = new Set();
    const restored = [];
    for (const saved of operation.created) {
      const matches = groups.map(group => ({ group, matched: matchingTabs(saved,
        tabs.filter(tab => tab.groupId === group.id), signatures) }))
        .filter(item => !matchedIds.has(item.group.id)
          && item.group.title === saved.title
          && (!saved.color || item.group.color === saved.color)
          && item.matched.length);
      if (matches.length > 1) { restored.length = 0; break; }
      if (!matches.length) continue;
      const groupId = matches[0].group.id;
      matchedIds.add(groupId);
      restored.push({ groupId, tabIds: matches[0].matched.map(item => item.currentId), matches: matches[0].matched });
    }
    if (restored.length) {
      candidates.push({ operation, groups: restored, restored: true });
    }
  }
  if (!candidates.length) return null;
  const ordered = candidates.sort((a, b) => b.operation.timestamp - a.operation.timestamp);
  return ordered.length > 1 && ordered[0].operation.timestamp === ordered[1].operation.timestamp
    ? null : ordered[0];
}

export async function restoredOrderIds(originalKeys, currentTabs) {
  if (originalKeys.length !== currentTabs.length || originalKeys.some(key => !key)) return null;
  const queues = new Map();
  for (const tab of currentTabs) {
    const key = originalKeys[0]?.startsWith("url:") || originalKeys[0]?.startsWith("title:")
      ? await signatureOf(tab) : correctionKey(tab);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(tab.id);
  }
  const ids = [];
  for (const key of originalKeys) {
    const id = queues.get(key)?.shift();
    if (!Number.isInteger(id)) return null;
    ids.push(id);
  }
  return [...queues.values()].some(queue => queue.length) ? null : ids;
}
