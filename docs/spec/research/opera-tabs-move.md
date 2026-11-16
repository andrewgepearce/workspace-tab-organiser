# Opera tabs.move and workspaces

**Checked:** 9 November 2026

These notes are the BL-006 spike and the probe run that followed it. They record what Opera documents, what public reports say, and what Andrew confirmed in Opera 139 on 9 November 2026. D8 and D9 in the system design are the apply rules chosen from that run.

## Confirmed on Andrew's Opera 139

2 observations from 9 November 2026 are kept separate. The index ranges do not match, so they are not treated as the same capture.

### Current-window query

The system design records the `chrome.tabs.query({ currentWindow: true })` capture under Platform References. This note does not repeat the tab list. The points that matter for a later move are these.

- `tab.index` is window-wide. In that capture it runs from 0 to 15 and does not restart inside a workspace.
- The query result is grouped by workspace. It is not in index order. The reader in `extension/browser-tabs.js` sorts by numeric index when every tab has one.
- `workspaceId` is a string in that capture. `workspaceName` is present on every returned tab.
- Each workspace has 1 active tab.
- A new window shares all of the browser's workspaces, so a current-window query includes a tab from every workspace.
- The only pinned tab in that capture is in Test A, at index 6, after unpinned tabs at indexes 0 to 5. Test A in that capture occupies indexes 6 to 12.

### 3 move calls

Andrew then used a test window whose strips were not the capture above. Test A occupied window indexes 6 to 13, with 8 tabs and a pinned tab at index 6. Test B occupied indexes 14 to 16. Indexes 0 to 5 were other workspaces, with 1 tab each. BBC Sport was an unpinned Test A tab at index 7.

1. `tabs.move` for that tab with `index` 10. The tab ended at index 13, the last slot of Test A. The other tabs kept their relative order.
2. The same tab, then requested at index 14, which was Test B's first slot. It stayed at index 13, stayed in Test A, and the call reported no error.
3. The same tab, then requested at index 8. It stayed at index 13. There was no move and no error.

Andrew did not report an error on the first call. On these 3 calls the requested index was not the index Opera used, and the tab did not leave Test A. That is the whole of the evidence. It does not yet show that every later call clamps to the workspace end, or that a call can never leave the workspace. `tabs.onMoved` was not recorded for these 3 calls.

## What Opera documents

Checked again on 9 November 2026.

### Tabs differences

[Extension APIs Supported in Opera](https://help.opera.com/en/extensions/apis/) says that from Opera 77 the Tab type has `workspaceId` and `workspaceName`. The same row lists methods and events Opera does not support. Those are `InjectDetails`, `sendRequest`, `getSelected`, `getAllInWindow`, `highlight`, `onSelectionChanged`, `onActiveChanged`, `onHighlightChanged` and `onHighlighted`.

`tabs.query`, `tabs.move`, `tabs.update` and `tabs.onMoved` are not in that unsupported list. The page does not say that an omitted method was tested with workspaces. It also does not state the type of `workspaceId`.

The table's Opera-only rows are Addons and sidebarAction. There is no workspaces row and no `tabGroups` row.

### The tabs article does not document move

[Working With Tabs and Windows](https://help.opera.com/en/extensions/tab-window/) shows `tabs.create`, `tabs.query`, `tabs.update`, `tabs.remove`, `tabs.reload` and `tabs.duplicate`. It does not mention `tabs.move`, `tabs.onMoved`, an index argument or a workspace argument. The examples use callbacks.

[Permissions Declarations](https://help.opera.com/en/extensions/declare-permissions/) says the `tabs` permission is required if the extension uses `chrome.tabs` or `chrome.windows`. This package already requests `storage` and `tabs` for the preview. The probe added no permission. Apply uses the same permission. The manifest version for Apply is 0.4.0.

### Opera-specific `opr` surfaces

[Architecture Overview](https://help.opera.com/en/extensions/architecture-overview/) says Chromium APIs are called on `chrome` and Opera-specific APIs on `opr`. The documented `opr` surfaces checked for this note are:

- [Sidebar Action](https://help.opera.com/en/extensions/sidebar-action-api/), `opr.sidebarAction`
- [Add-ons](https://help.opera.com/en/extensions/addons-api/), `opr.addons.installExtension`

Neither page mentions workspaces, tab indexes or `tabs.move`. No `opr` workspace method was found in the supported-API list.

### No documented way to write a workspace

A forum question asks how to move a tab between workspaces. The writer says `tabs.move` has no `workspaceId` in its move properties, that assigning `tab.workspaceId` does not work, and that `tabs.create` cannot take a workspace either. The topic is marked deleted. The question text was still on the fetched page. The visible reply does not name a method.

<https://forums.opera.com/topic/67395/extension-development-how-to-move-tab-from-one-workspace-to-another>

The supported-API list agrees that the extra Tab fields are `workspaceId` and `workspaceName`, and it does not add a write method. Whether some undocumented function can still change a workspace was not tested. This spike does not call an undocumented function.

### Chrome's contract, which Opera does not restate

Opera's tabs article does not define `index`. The Chrome reference that Opera points at for APIs with no listed difference says `index` is the zero-based index of the tab within its window. That sentence has no workspace in it. Andrew's capture fits it if the window index runs through every workspace in the window.

Chrome documents `tabs.move` as moving 1 or more tabs to a new position in the current window, or to another window. Tabs can only be moved to and from windows whose type is `"normal"`. The `index` property is described as the position to move to, and `-1` places the tab at the end of the window. The return is a promise from Chrome 88. Opera 139 is based on Chromium 155, but this note does not claim that Opera's `tabs.move` returns a promise. The probe accepts a callback or a promise.

<https://developer.chrome.com/docs/extensions/reference/api/tabs#method-move>

Chrome's `tabs.onMoved` fires when a tab is moved within a window. The callback receives `tabId` and `moveInfo`, and `moveInfo` has `fromIndex`, `toIndex` and `windowId`. Chrome says only 1 event is fired, for the tab the caller moved directly, and that the tabs which shift out of the way do not get their own events. A move between windows does not fire `onMoved`. Opera does not list `onMoved` as an unsupported event. Whether Opera 139 fires it, and whether `toIndex` matches the next query, is unknown.

<https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onMoved>

## Other public reports

These are not Opera 139 results. They are not folded into Andrew's 3 calls.

### Requested index ignored on Opera 122

A forum report says `tabs.move` to `index - 1` left the tab where it was, and a request about 10 places away moved the tab by only a few positions. Some workspaces behaved and some did not. That workspace had no pinned tabs and no tab groups. Its indexes started at 8 rather than 0. The browser was Opera One 122.0.5643.150 on macOS, Chromium 138.0.7204.251. The page showed 1 reply. That reply's text was not in the page fetched on 9 November 2026, so the reply is unknown.

<https://forums.opera.com/topic/86637/extension-to-manage-tabs-changing-tab-index-is-via-tabs-api-is-unpredictable/>

This agrees that a requested index can be ignored, and that a workspace's indexes need not start at 0. It does not say the tab jumped to the last slot of the workspace. It is 17 major versions before Opera 139. It is not evidence for the clamp Andrew saw.

### String workspace ids in a console log

A Stack Overflow answer prints `workspaceId` as `'0'` and `'3'`, with `workspaceName` beside them. That agrees with Andrew's capture that the id is a string. It is a developer report, not a type in Opera's API page.

<https://stackoverflow.com/questions/66994576/opera-api-is-there-a-way-to-get-the-tabs-in-the-current-workspace>

### More than 1 active tab when several workspaces are open

A SingleFile report says saving the current page also offered pages from other workspaces, because those tabs were active too. The maintainer described comparing the `workspaceId` from the click with the `workspaceId` of the active tabs. That is an independent report of 1 active tab per workspace. D6 already follows Andrew's capture. It is not a finding about `tabs.move`.

<https://github.com/gildas-lormeau/SingleFile/issues/1808>

### Unofficial note, not used

An unofficial markdown note says Opera has no public API to create or manage workspaces, and that `workspaceId` and `workspaceName` are readable from Opera 77. The same note suggests `chrome.tabs.group` as a substitute. Opera's supported-API list does not include `tabGroups`. That suggestion was not tested and this extension does not call it.

<https://github.com/rennerdo30/chromium-tab-migrator/blob/main/opera_workspace.md>

### An internal symbol is not an extension API

The Opera 101 desktop changelog names `opera::AddNewTabToWorkspaceIfCurrent` and `opera::WorkspaceId` in crash DNA-109908. That is a browser symbol in a crash line. It is not documented as an extension method, and this spike does not call it.

<https://blogs.opera.com/desktop/changelog-for-101/>

## Probe run confirmed on 9 November 2026

Andrew ran `extension/dev/move-probe.html` in Opera 139. These points are confirmed from that run.

- `tabs.move` reads `index` as a position inside the tab's own workspace strip. `tabs.query` still reports window-wide indexes. Requesting local index 2 for a Test A tab put it at window index 8, which was Test A local position 2.
- Any requested index greater than or equal to the workspace length clamps to the last slot of that workspace. Every window-wide index tried in the run was at least that long, so each of those requests clamped.
- Requesting the tab's current local position does nothing.
- `tabs.onMoved` reports `fromIndex` and `toIndex` as workspace-local indexes.
- A moved tab stayed in its workspace. Tabs in other workspaces kept their order. Moves did not change the active tab. No error was raised.
- Index `-1` appends the tab to the end of its workspace.
- Moving an array of 2 tab ids appends both, in that order, to the end of the workspace.
- Sending tabs one by one to the end, in the desired order, restored Test A exactly. Sending each tab to its original window index did nothing.

The 3 earlier console calls fit this rule. Test A then had 8 tabs, so local positions were 0 to 7. Requested indexes 10, 14 and 8 were all at least 8, so each clamped to the last slot. The third call was already on that slot, which is why it did not move.

## Pinned tabs

The probe did not move a pinned tab. Index `-1` appends to the end of the whole workspace. When unpinned tabs follow the pins, that end is outside the pinned section. There is no confirmation that Opera would keep a pinned tab inside the pinned section. Apply therefore does not reorder pinned tabs. A pinned range that already matches the plan is left as it is. A pinned range that differs is reported as unsupported and those tabs are failed, without a move.

## Still unknown

No Chromium or Opera bug id for the workspace-local index was found on 9 November 2026. Whether `-1` on a pinned tab can stay inside the pinned section was not tested.

## Probe

`extension/dev/move-probe.html` stays in the extension, opened as `chrome-extension://<id>/dev/move-probe.html`. It is not linked from the popup. It queries the current window and then moves or activates a tab only when `workspaceName` is exactly `Test A`. Any other window is refused and no tab is moved. It does not create, close, reload or navigate a tab.

The page is kept so the same run can be repeated. Apply in the popup uses the confirmed `-1` sequence and does not call the probe.

## Sources

- <https://help.opera.com/en/extensions/apis/>
- <https://help.opera.com/en/extensions/tab-window/>
- <https://help.opera.com/en/extensions/declare-permissions/>
- <https://help.opera.com/en/extensions/architecture-overview/>
- <https://help.opera.com/en/extensions/sidebar-action-api/>
- <https://help.opera.com/en/extensions/addons-api/>
- <https://developer.chrome.com/docs/extensions/reference/api/tabs#method-move>
- <https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onMoved>
- <https://forums.opera.com/topic/67395/extension-development-how-to-move-tab-from-one-workspace-to-another>
- <https://forums.opera.com/topic/86637/extension-to-manage-tabs-changing-tab-index-is-via-tabs-api-is-unpredictable/>
- <https://stackoverflow.com/questions/66994576/opera-api-is-there-a-way-to-get-the-tabs-in-the-current-workspace>
- <https://github.com/gildas-lormeau/SingleFile/issues/1808>
- <https://github.com/rennerdo30/chromium-tab-migrator/blob/main/opera_workspace.md>
- <https://blogs.opera.com/desktop/changelog-for-101/>
