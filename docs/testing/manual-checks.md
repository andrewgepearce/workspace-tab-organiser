# Manual checks

Run these in Opera when a change needs a browser check. The popup does not link to the move probe.

## Load in Opera

The unpacked `extension` directory was loaded automatically into an isolated Opera 139.0 profile on 6 November 2026. The extension appeared as enabled with no manifest, runtime, or installation errors. Its popup rendered the expected name, version 0.1.0 and manifest 2. The regular browser profile was not changed.

1. Open `opera://extensions`. Opera’s own getting-started page also accepts `opera:extensions` if the longer address does not open.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select the `extension` directory in this repository.
4. After later edits, use **Reload** on `opera://extensions`. Opera may warn that the extension can read browsing data because the manifest requests `tabs`. The exact warning text was not checked here. The permission lets the preview read titles and URLs in the current window. It does not send them anywhere.
5. Open the toolbar popup. The footer should show **Workspace Tab Organiser**, version **0.10.0** and an **Options** link. It should not show the description or the manifest version.
6. The options page has **Group unmatched tabs automatically**, on by default. With that box on, groups are ordered from A to Z and a single unmatched tab is sorted by its title. Choose **Save** after changing it. With that box on, an empty rule list still groups and sorts eligible tabs. With it off and no rules saved, the popup says so and unmatched tabs stay where they are. The footer **Options** link opens the options page. The architecture overview says the details-page link appears for an `options_page`. The exact label was not checked in this environment.
7. Prepare 1 window that contains all of the following, then open the popup again:
   - tabs in 2 workspaces, with at least 1 matching rule in each
   - 1 pinned tab that matches a rule
   - 1 `opera://` page, for example `opera://extensions`
   - 1 HTTP or HTTPS tab that matches no rule
8. The heading should be the workspace you opened the popup from. The other workspace should not be listed. A pinned match shows a **Pinned** tag. The unmatched tab should sit under **Unmatched**. The `opera://` page should sit under **non-web tabs ignored**. The page should not show a full URL. **Apply** and **Cancel** stay visible while the list scrolls. **Apply** is enabled when at least 1 tab would move, including a single tab that would be sorted, and otherwise shows a short reason. **Cancel** closes the popup and does not move a tab. Switch to the other workspace, close the popup if it is still open, and open it again. The heading and the list should change to that workspace.
9. Choose **Cancel**. The popup closes. The tabs, their order, their pin state and their workspaces should be unchanged.
10. On the options page, choose **Add from URL** and paste `https://www.bbc.co.uk/sport/football?x=1#a`, then press Enter. The row should show the bold name `www.bbc.co.uk/sport/football`, hostname `www.bbc.co.uk` and path `/sport/football`, with a dotted grip, an edit icon and a delete icon. The URL field should be gone. Add a second rule from a different URL. Drag the first row by its grip onto the other row. Choose the edit icon, change the URL, and press Enter. Press Escape on another edit and the row should stay as it was. Choose the delete icon on one row, then **Discard**, and the row should return. Choose **Save**. Close the page and open it again. The saved order and the edited name should remain. Open the popup. The preview should use that order: the first saved rule wins when both could match, and the block name should be the derived name.
11. Choose **Add from URL** and paste `ftp://example.com/a`. The row should keep the field open and show an error. Press Escape. The new row should disappear. Add a URL whose hostname and path match a rule you already saved, then choose **Save**. Nothing should be written, and the page should say that hostname and path are already used.
12. Choose **Discard** after an unsaved edit. The list should return to the last saved rules.

The 6 November 2026 load check used an isolated development profile and saw version 0.1.0. These manual steps are for the current package, version 0.10.0, and do not use that profile. Chromium 155.0.0.0 and Opera 139.0.0.0 were observed in the page user agent during the earlier check. Andrew confirmed a successful preview in Opera on 9 November 2026. He checked the one-line rule rows and automatic groups in Opera on 10 November 2026. He checked Add rule in Opera before this version. The current-workspace popup has not had its own load note. Andrew also confirmed that the expected popup was visible in his regular Opera browser during the 0.1.0 check.

## Add a rule from the popup

Use a workspace with no saved rules, and leave **Group unmatched tabs automatically** on. Open at least 2 tabs that share a hostname and first path segment, so they form an Automatic card, plus 1 other HTTP or HTTPS tab that stays under **Unmatched**. An `opera://` page should not offer **Add rule**.

1. Open the popup in that workspace. Each single unmatched tab has **Add rule**. Each Automatic card has it once. A rule card does not.
2. Press **Add rule** on one single tab, then on one Automatic card. Each press saves immediately. The notice says **Rule added**. The new rules are at the end of the saved list. Nothing moves yet.
3. The preview should show those rule groups first, then any remaining automatic groups from A to Z, then the remaining single tabs by title. **Apply** should be enabled when the summary says tabs would move.
4. Open the options page. The new rules should be at the end, with the derived name, hostname and path. Close it and open the popup again if it closed.
5. Choose **Apply**. The matching tabs should move into those groups. Open the popup again. It should say nothing to move.
6. Press **Add rule** for a host and path that is already saved. The popup should say that hostname and path are already used, and the list should not gain a duplicate.

## Automatic groups

Save no rule that matches the sites below, and leave **Group unmatched tabs automatically** on. In 1 workspace, open these tabs:

1. `https://www.bbc.co.uk/sport`
2. `https://www.bbc.co.uk/sport/football`
3. `https://en.wikipedia.org/wiki/London`
4. `https://example.com/`

Open the popup in that workspace. The heading should be the workspace name. BBC Sport and Football should be 1 card labelled `www.bbc.co.uk/sport`, tagged **Automatic**, and that card comes before the single tabs. Under **Unmatched (2)**, Example Domain comes before London, because single tabs are sorted by title. The summary should count the tabs that would move. Choose **Apply**. The BBC group should sit first, then Example Domain, then London. Open the popup again. It should say nothing to move. Then turn the checkbox off, choose **Save**, and open the popup again. Nothing should be grouped or sorted.

## Apply in the test window

Use the test window whose Test A strip is, in order, pinned Opera Wikipedia, BBC Sport, Example Domain, Home - BBC News, London - Wikipedia, Technology BBC News and Extensions. Test B is BBC Weather, Tab Wikipedia and Example Domain. Save these rules in this order.

1. Label `BBC News`, hostname `www.bbc.co.uk`, path prefix `/news`.
2. Label `www.bbc.co.uk`, hostname `www.bbc.co.uk`, path prefix `/`.
3. Label `Wikipedia`, hostname `en.wikipedia.org`, path prefix `/`.

Open the popup from Test A. The heading should be **Test A**. Test B's tabs should not be listed. **Apply** should be enabled. Choose it. Test B should stay in its current order. Test A should become:

1. Opera (web browser) - Wikipedia, still pinned.
2. Home - BBC News.
3. Technology | Latest News & Updates | BBC News.
4. BBC Sport - Scores, Fixtures, News - Live Sport.
5. London - Wikipedia.
6. Example Domain.
7. Extensions.

The result should report 4 moved tabs and no failures. London and Extensions are sent to the end with the other unpinned tabs and land where they already were, so they count as already in place. Other workspaces should be unchanged. If a tab moves between the preview and Apply, nothing is moved and the popup shows a new preview.

## Move probe

Apply is implemented. A manual probe of `tabs.move` remains at [extension/dev/move-probe.html](../../extension/dev/move-probe.html). The popup does not link to it. Findings are in [Opera tabs.move research](../spec/research/opera-tabs-move.md).

1. On `opera://extensions`, reload Workspace Tab Organiser and copy its id.
2. Open the test window and go to `chrome-extension://<id>/dev/move-probe.html`.
3. That window needs a workspace named exactly `Test A`. Anything else is refused, and no other workspace is moved.
4. Choose **Run probe**. It reorders tabs inside Test A, then tries to put that order back.
5. Choose **Copy report**. The same JSON is on the page and in the console. It has titles and no URLs.
