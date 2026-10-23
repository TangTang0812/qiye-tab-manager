import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const themeInit = readFileSync(new URL("../theme-init.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("popup script references existing, unique element IDs", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML IDs must be unique");
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.ok(htmlIds.includes(id), `Missing popup element: ${id}`);
  }
  for (const [, references] of html.matchAll(/\baria-(?:describedby|controls|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(/\s+/)) assert.ok(htmlIds.includes(id), `Missing ARIA target: ${id}`);
  }
});

test("organizing and memory management are peer modules", () => {
  assert.match(html, /id="organize-tab"[^>]*role="tab"[^>]*aria-controls="main-view"/);
  assert.match(html, /id="performance-tab"[^>]*role="tab"[^>]*aria-controls="performance-view"/);
  assert.match(html, /id="main-view"[^>]*role="tabpanel"[^>]*aria-labelledby="organize-tab"/);
  assert.match(html, /id="performance-view"[^>]*role="tabpanel"[^>]*aria-labelledby="performance-tab"/);
  assert.doesNotMatch(html, /performance-entry|performance-open|performance-back/);
  assert.match(html, /id="performance-filter-eligible"/);
  assert.match(html, /id="performance-filter-all"/);
  assert.match(html, /id="performance-select-all"/);
  assert.match(html, /id="performance-clear-selection"/);
  assert.match(script, /group\.eligibleCount > 0/);
  assert.doesNotMatch(script, /performanceSelectionInitialized/);
});

test("direct-file preview uses clearly labeled sample data and cannot release tabs", () => {
  assert.match(script, /state\.previewOnly = true/);
  assert.match(script, /state\.performance = previewPerformanceData/);
  assert.match(script, /示例数据，不能操作真实标签/);
  assert.match(script, /\$\("performance-discard"\)\.disabled = [^;]*state\.previewOnly/);
  assert.match(html, /id="performance-safety-hint"/);
  assert.match(html, /未保存内容可能丢失/);
  assert.doesNotMatch(html, /id="performance-status-detail"/);
});

test("production identity and compact controls keep necessary disclosures", () => {
  assert.equal(manifest.name, "栖页 · 标签整理与内存管理");
  assert.equal(manifest.short_name, "栖页");
  assert.equal(manifest.version, "1.3.0");
  assert.match(html, /<title>栖页<\/title>/);
  assert.match(html, /AI 发送标题与域名/);
  assert.match(html, /本机保存 · 未加密/);
  assert.match(html, /未保存内容可能丢失/);
  assert.doesNotMatch(html, /id="performance-list-summary"|id="performance-select-hint"|id="undo-hint"/);
  assert.doesNotMatch(html, /id="info-mark"|class="icon-sprite"/);
});

test("appearance modes and about details are available on both surfaces", () => {
  assert.match(html, /<script src="theme-init\.js"><\/script>[\s\S]*?<link rel="stylesheet"/);
  assert.equal((html.match(/class="icon-button appearance-button"/g) || []).length, 2);
  for (const mode of ["system", "light", "dark"]) {
    assert.equal((html.match(new RegExp(`data-theme-option="${mode}"`, "g")) || []).length, 2);
  }
  assert.match(html, /id="about-title">关于/);
  assert.match(html, /id="app-version">1\.3\.0/);
  assert.match(html, /<dd>iTang<\/dd>/);
    assert.match(html, /href="https:\/\/github\.com\/TangTang0812\/qiye-tab-manager"[^>]*rel="noopener noreferrer"/);
  assert.match(themeInit, /document\.documentElement\.dataset\.theme/);
  assert.match(script, /localStorage\.setItem\("qiyeThemeMode", chosen\)/);
  assert.match(styles, /:root\[data-theme="light"\]/);
  assert.match(styles, /:root:not\(\[data-theme="dark"\]\):not\(\[data-theme="light"\]\)/);
});

test("first-use scope choice, compact counts, spotlight guide and functional icons are present", () => {
  assert.match(html, /id="scope-eligible-count"/);
  assert.match(html, /id="scope-total-count"/);
  assert.match(html, /name="scope-mode" value="incremental"/);
  assert.match(html, /name="scope-mode" value="all"/);
  assert.match(html, /id="scope-confirm"[^>]*disabled/);
  assert.match(html, /id="tour" class="tour" hidden/);
  assert.equal((html.match(/class="tour-shade"/g) || []).length, 4);
  assert.match(html, /id="replay-tour"[\s\S]*?<svg/);
  assert.match(html, /class="github-link"[^>]*>[\s\S]*?<svg/);
  assert.match(script, /organizerScopeMode/);
  assert.match(script, /organizerTourDone/);
  assert.match(script, /state\.scopeMode === "all" \? state\.allOrganizableCount/);
  assert.doesNotMatch(script, /当前窗口 · .*可整理标签 \/ 共/);
});

test("appearance initializes before paint and rejects stale theme values", () => {
  for (const [saved, expected] of [["light", "light"], ["dark", "dark"], ["system", "system"], ["unknown", "system"], [null, "system"]]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(themeInit, {
      document,
      localStorage: { getItem: () => saved }
    });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(themeInit, {
    document,
    localStorage: { getItem: () => { throw new Error("unavailable"); } }
  });
  assert.equal(document.documentElement.dataset.theme, "system");
});

test("popup and side panel share controls, with an explicit SVG panel action", () => {
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.doesNotMatch(JSON.stringify(manifest.action), /default_popup/);
  assert.match(html, /id="open-sidepanel"[^>]*aria-label="在侧边栏打开"/);
  assert.match(html, /id="open-sidepanel"[\s\S]*?<svg[\s\S]*?<\/svg>/);
  assert.match(html, /name="presentation" value="sidepanel" checked/);
  assert.match(html, /name="presentation" value="popup"/);
  assert.equal(panelHtml, html.replace('data-surface="popup"', 'data-surface="panel"'));
  assert.doesNotMatch(html, /id="ai-status"/);
  assert.match(script, /if \(message\) toast\(message, kind \|\| "info"\)/);
  assert.match(script, /panelLanding/);
  assert.doesNotMatch(styles, /\.performance-groups\s*\{[^}]*max-height/);
});
