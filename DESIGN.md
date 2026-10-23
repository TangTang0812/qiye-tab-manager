# Design notes · 栖页 1.3.0

The Chrome tab strip is the output. The side panel is the default control surface; the popup remains an optional compact surface. Both use the same script, CSS, and synchronized markup.

## Presentation experiment

- This build remains separate from the 1.0.0 extension. The 1.1.0 archive is kept as a rollback point; the installed 1.1.0 folder path remains unchanged to preserve its extension ID and settings.
- A compact, native SVG appearance action sits beside Settings on the main surfaces and is repeated in the Settings header. A three-choice menu controls system, light or dark mode; color tokens change text and controls together. The preference is stored locally and applied before CSS loads.
- Settings ends with a concise About section for version, author and GitHub. The product name no longer says trial.
- Version 1.3.0 adds a required first-use organization-scope choice. Incremental mode retains manually created groups; all-scope mode intentionally reclassifies their eligible members, with a clear warning and fresh counts before confirmation. Preview/apply revalidates original group membership. A five-step, skippable spotlight tour introduces the critical controls; About offers replay.
- The header now says only "current window". A compact two-column metric row below it shows eligible and total tabs without wrapping. Functional SVGs distinguish scope choices, scope editing, tour replay and the author's GitHub link.
- The toolbar defaults to a global side panel in the current window. A settings radio switches the next toolbar click to popup or back to side panel. The popup has a functional SVG control that opens the panel directly.
- Chrome owns left/right placement and panel width. The UI therefore expands with the available width and has one scrolling page, not a 250px nested list. Header and release action remain discoverable while browsing.
- Model-list, save, test, and settings errors use one top notification system. Essential risk disclosures remain near the action.

## Two peer modules

- “标签整理” and “内存管理” are peer-level tabs below one shared product header. The memory workflow is no longer a card buried under organizing controls. Settings returns to the module that opened it.
- The performance view takes a cue from Edge's task-first panel: one calm status card gives the current tab state, followed by the actionable group list, a clear release control, and a persistent operation receipt. This does not mimic Edge's browser-only memory measurements or system-pressure diagnosis.
- The default list shows groups with eligible tabs. When none remain, the status card says so and the list has a useful empty state; the explicit “待释放 / 全部分组” switch reveals already-discarded and protected groups for verification.
- The new view groups tabs by their existing native Chrome group, preserving group name and color. Nothing is selected by default. A user can select a group, expand it to pick individual pages, or select/clear all eligible tabs; the selected count stays near the release action.
- The view reports observable tab counts only: eligible, already discarded and protected. It does not imply per-tab memory measurements or browser-wide pressure.
- The action explains that tabs and groups stay in place, pages reload on activation and unsaved page state may be lost. There is no close action or false undo promise.
- Per-tab state details and partial outcomes use text as well as color; native checkboxes, 44px controls and a persistent live result support keyboard and assistive-technology use.
- This is a separate unpacked extension with its own identity and no default keyboard shortcut, so the original installation and settings remain untouched.

## Shape and hierarchy

- The 420px action popup shows the target window, local/AI strategies, a compact preference summary, and one full-width primary action in the first view. The root and body both keep a minimum width so Chrome cannot collapse the popup to an intrinsic narrow column.
- The gear icon opens an independent settings view inside the same popup. Settings contain grouping preference, naming language and optional AI configuration; the action view stays focused on one-click organization.
- Grouping preferences use user-facing language: “自动归类” (shared topic/task signals) and “同站合并” (keep related subdomains together), rather than internal “topic/project” terminology.
- Save/test outcomes appear as brief top-of-popup notices. New notices stack above older ones without overlap; inline model-list detail remains near the field. Undo remains a visible secondary action.
- Chrome-like neutral surfaces and one blue action accent keep the popup familiar beside the browser toolbar. The type scale is explicit: 18px title, 16px body, 15px secondary and 14px caption, with no 11–12px copy.
- “栖页” names the combined organizing and rest workflow while the primary button remains the verb “一键整理”. The shared SVG mark depicts one tab group and a resting crescent; it is rasterized for Chrome's toolbar icons.
- The action view keeps only scope, AI data details and result diagnostics behind compact text triggers. The AI data disclosure, local unencrypted Key cue, release risk, operational success and errors stay visible.

## Interaction and safety

- Clicking “一键整理” directly computes and applies a complete grouping plan in the service worker. It does not require a second confirmation step, per the user's chosen workflow.
- Pinned and split-view tabs remain protected in either scope. Incremental mode also protects existing manual groups; all-scope mode can regroup their eligible members only after explicit scope confirmation. A repeat incremental run may revisit groups that this extension can identify from its stored operation history, including pages later inserted into those groups. The extension never closes or navigates a tab.
- The service worker rechecks all eligible tab IDs before applying and keeps an undo history in local storage. After a browser restart, it matches restored groups by unique name, color and known member URL signatures; newly added members are allowed but not affected by an older undo. Ambiguous groups are never ungrouped. Undo of a repeat run reconstructs the previous native groups; their Chrome-assigned IDs and exact tab positions may differ. Duplicate concurrent runs are rejected.
- Local rules do not access the network. AI mode accepts a base URL or complete Chat Completions URL, derives `/models` and `/chat/completions`, and requests permission for that origin. The Key is stored persistently in local extension storage, with trusted-context access only; the UI explicitly discloses that local storage is not an encrypted vault.
- AI setup follows address and Key → fetch models (manual ID fallback) → choose model → save. “测试连接（可选）” sends a fixed short prompt, never tab data; saving does not depend on a successful test. Actual grouping sends titles, hostnames and IDs, not full URLs or page bodies.
- HTML, non-JSON and HTTP errors are translated into actionable messages instead of exposing a raw JSON parser exception or remote response body.
- Uncertain tabs are placed in a grey “待核对” native group instead of claiming unwarranted classification confidence.
- Grouping basis is user-selectable. Site mode consolidates multiple ungrouped tabs from the same site (including subdomains). Topic/project mode permits cross-site groups, with simple local project-token detection or richer AI semantics. The language preference informs local names and AI prompts; brand names remain intact. The 24-group limit is preserved without dropping tabs.
- The model-discovery action is a labeled, keyboard-accessible SVG icon immediately after the model-ID field, keeping the input and its lookup action together. Opening the source file directly shows a recovery message instead of a raw Chrome API exception.

## Removed complexity

- The 980×820 independent manager window, editable preview cards, separate generate/apply steps and per-tab dropdowns were removed from the default workflow. Users can inspect and adjust the resulting native groups in Chrome itself, then undo if needed.

## Verification

- Automated tests cover complete assignment, duplicate/ineligible IDs, singleton groups, AI omissions, stale/incomplete plans, one-click background application and undo.
- Version 0.4.0 tests cover endpoint normalization, model-list retrieval, a tab-free connection probe, HTML/HTTP failure messages, and the existing one-click grouping and undo paths. The installed extension was reloaded and visually checked in Chrome: model retrieval, connection test and the readable type scale were present, and the popup showed “需重填 Key” after session storage cleared. No provider request or tab-grouping action was triggered; a real connection test remains for the user to perform with their Key.
- Version 0.5.0 tests cover same-site consolidation across Bilibili subdomains, repairing a split AI response, and prioritizing site buckets under the 24-group cap. The user's previous 70-tab grouping was undone before reloading this version; the new strategy has not been applied to live tabs yet.
- Version 0.6.1 clarifies the Edge-style strategy in the compact popup and hardens direct-file preview behavior. It does not automatically reorganize any live Chrome tabs.
- Version 0.6.0 tests cover cross-site project grouping, language preferences, AI mode-specific reconciliation, and omission handling at the group limit. This release changes the popup's grouping preferences and model-discovery control; it does not automatically reorganize any live Chrome tabs.
- Version 0.7.0 adds the independent settings view, a separate save action, optional connection testing, and SVG model discovery control. It does not automatically reorganize any live Chrome tabs.
- Version 0.8.0 strengthens AI automatic classification with conservative review recovery, hosted-domain correction, broader names for mixed speech projects, and a persisted count breakdown for review sources. It leaves the existing native groups untouched until the user explicitly runs a new organization.
- Version 0.9.0 merges duplicate AI topic group names and corrects high-confidence API/deployment misclassifications observed in the user's 71-tab run. It adds no new preference or automatic live-tab mutation.
- Version 0.10.0 adds three internal quality layers: same-site/title review clustering, one bounded AI review of remaining uncertainty with failure fallback, and exact site/title memory from user moves or renames of extension-created groups. A compact count/reset control lives in settings; no live tabs are regrouped by updating the files.
- Version 0.10.2 restores affected tab positions after a partial grouping failure, serializes organize/apply/undo per window, clears a stale missing-Key requirement when changing to a different keyless endpoint, and starts first-time host permission requests before asynchronous tab refresh. The model field markup remains unchanged by request.
- Version 0.11.0 persists the configured Key and undo snapshots locally, safely resolves restored groups after browser restart, and moves save/test outcomes to a non-overlapping transient top notice stack. It does not reorganize any live tabs on update.
- Version 0.11.1 adds a keyboard-accessible SVG visibility toggle beside the API Key field. Keys stay masked by default and are hidden again on leaving settings; the button's action label and icon update with the current state.
- Version 0.12.0 adds repeat organization of extension-owned groups plus ungrouped tabs, including pages Chrome inserted into old groups. It preserves manual groups, keeps prior undo steps, and tolerates new group members when matching undo snapshots across browser restarts. The popup names the repeat action and its scope.
- Version 0.13.0 keeps direct one-click organization as the primary action and adds a secondary, read-only preview within the same popup. Preview lists proposed native groups and their members; applying it revalidates the eligible tab set, titles and hosts. AI planning now receives only those eligible tabs, so manual groups and pinned tabs stay outside the provider request. Undo copy separates affected, formerly grouped, newly ungrouped and untouched tabs, and only claims order restoration after comparing actual tab order. The UI discloses that AI preview also invokes the configured model.
- Version 0.13.1 compresses secondary explanations into accessible information tips and makes the footer's undo action single-line again. The short AI data notice stays visible; behavior, storage and grouping are unchanged.
- Version 0.13.2 applies the same progressive disclosure to settings. Field labels and inputs remain visible; explanatory copy moves to each heading's information tip. A compact “本机保存 · 未加密” cue stays visible beside API Key. Configuration and grouping behavior are unchanged.
- Version 0.15.0 turns the organizing and performance workflows into peer modules, introduces a state-led performance panel and actionable-group filter, and improves the direct-file preview empty state. The original, 0.14.0, and 0.15.0 folders are independent.
- Version 0.15.1 reduces visible explanatory copy to task-essential status and icon-triggered details, replaces the ambiguous single filter with explicit choices and bulk controls, and removes implicit selection. A clearly labeled, non-operable sample shows group layout in a direct-file preview.
- Version 1.0.0 keeps the existing dependency-free popup and functionality, removes redundant text and information SVGs, and unifies the product name and icon across the popup, manifest and context menu. The original backups remain available.
