# How the extension is built

These notes describe the modules. Behaviour for people installing the extension is in the README.

## URL matching

`extension/matching.js` assigns each HTTP or HTTPS URL to the first matching Organiser Rule. Import `validateRule`, `validateRules`, `matchUrl`, `matchTabs`, and `createRuleId`. The module does not read storage or change tabs. It was not load-tested in Opera.

A rule has a stable `id`, a non-empty `label`, a `hostname`, and an optional `pathPrefix`. Hostnames are compared exactly after WHATWG URL canonicalisation, so comparison is case-insensitive and international names use punycode. `example.com` does not match `www.example.com`, a parent host, or a deeper subdomain. A trailing-dot host is a different hostname. Ports are ignored. An asterisk is rejected so a hostname cannot act as a subdomain pattern.

An omitted path prefix matches every path on that host. A prefix must start with `/` and is compared case-sensitively with the URL path. Percent-encoding hex digits are uppercased before comparison. One trailing slash is ignored on the prefix and the path, except that the prefix `/` matches every path. The path must equal the prefix or continue at a `/` segment boundary, so `/product` matches `/product` and `/product/guide` and does not match `/production`. Query strings and fragments are ignored. A configured prefix that the URL parser would rewrite, including `.` or `..` segments, is invalid. Tab URLs are matched only after the parser resolves those segments.

Rules keep the order they are given. The first match wins, including when a later rule is longer or more specific. Reversing the specification's `docs.example.com/product` and `docs.example.com` rules changes which label is selected. Valid `http` and `https` URLs with no matching rule are unmatched. Any other scheme, including `opera:` and `chrome:` pages, is rejected as unsupported. Malformed URLs and invalid rule lists are rejected without throwing, and the result does not include the URL.

## Rule editing

`extension/rule-draft.js` keeps an in-page draft. `extension/rule-store.js` persists that list through an injected storage adapter. The options page passes `chrome.storage.local` and does not call synchronised storage, managed storage or a remote service. D5 is explicit Save. Nothing is written until Save, and Save writes the whole ordered list in 1 write only when `validateRules` accepts it. An invalid label, hostname or path prefix is shown on that rule and field, and the previous list stays in storage. Discard reloads the saved rules. The page warns on `beforeunload` when there are unsaved edits.

Each resting rule is one card: a dotted grip, the derived name in bold, the hostname, the path, an edit icon and a delete icon. There is no label field. The name is the hostname plus the full path, or the hostname alone when there is no path. `https://www.bbc.co.uk/sport/football?x=1#a` gives hostname `www.bbc.co.uk`, path prefix `/sport/football` and name `www.bbc.co.uk/sport/football`. One trailing slash is removed. A bare origin, including `https://www.bbc.co.uk/`, leaves the path prefix blank and the name is `www.bbc.co.uk`. The scheme, port, query and fragment are dropped. An address that is not HTTP or HTTPS, or that cannot be read, shows a message and does not add a rule. A second rule with the same hostname and path is rejected.

The URL field stays hidden until **Add from URL**, or until the edit icon on a card. Enter, or leaving the field with a valid URL, creates or updates the row and removes the field. Escape removes a new row, or puts an edited row back as it was. Drag the grip to reorder. The delete icon removes the row from the draft. Discard puts the saved list back. An older saved label still loads. The row shows the derived name, and the next Save stores that name. Each new rule gets a stable identifier from `createRuleId`. That identifier stays put across moves and deletion of another rule. A blank path prefix matches every path on that hostname. Reopen the options page to see the saved order.

Opera’s manifest reference lists `options_page` and does not list `options_ui`, so the manifest uses `options_page`. The manifest permissions are `storage` and `tabs`. The options page was not load-tested in Opera.

## Arrangement planning

`extension/arrangement.js` exports `planArrangement`. It calls the ordered matcher and returns a serialisable plan for one window. It does not move, create, close, reload or navigate a tab. The preview calls it. It was not load-tested in Opera.

Pass tabs in current window order and Organiser Rules in display order. A Contiguous Block is the matching tabs that share a label, a workspace, and a pinned or unpinned category. The block starts with its earliest matching tab. Other selected tabs follow in their original relative order. Adjacent blocks inside that workspace and pin category follow Organiser Rule order. D4 keeps every anchor across a workspace boundary: those blocks are not combined, a tab is not written into another workspace's slot, and the plan records the boundary. Unmatched and rejected tabs are not selected. Their relative order stays. The plan keeps 1 active tab id per workspace, plus tab ids, pin categories and workspace metadata. It does not copy tab URLs.

When the default rule is on, tabs that match no rule are grouped by hostname and the first path segment if at least 2 tabs in the same workspace and pin category share that key. A single tab stays unmatched. Those groups sort after adjacent rule groups and keep the original tab order inside the group. Pass `{ groupUnmatchedTabs: false }` to `planArrangement` to turn this off. Omitting it leaves the default rule on.

An invalid rule list, mixed window ids, a pinned tab after an unpinned tab in the same workspace, duplicate tab ids and more than 1 active tab in the same workspace are rejected without throwing. Opera marks 1 tab active in each workspace, and a pin in one workspace may follow an unpinned tab in another. Both shapes are accepted. Passing a non-array tab list throws. A missing or empty workspace id is one unavailable workspace.

## Preview

`extension/browser-tabs.js` reads the active tabs with `chrome.tabs.query({ active: true, currentWindow: true })` and the current window with `chrome.tabs.query({ currentWindow: true })`. The workspace with the newest `lastAccessed` is the only one previewed and applied. Apply uses the same module to call `tabs.move` with index `-1` and to restore an active tab. `extension/preview.js` passes that workspace and the saved rules to `planArrangement` and returns display data. `extension/apply-plan.js` plans the moves. `extension/apply.js` runs them after checking the Preview still matches the same scope. The popup renders the preview and, after Apply, the result. URLs are not shown.

The heading is the workspace name. The first line is a summary, for example **4 tabs to move into 2 groups, 3 unmatched**. Each group is a card with its name, a **Rule** or **Automatic** tag, the tab count and titles on 1 line. The full title is the tooltip. A pinned card also says **Pinned**. Unmatched tabs sit under **Unmatched (3)**, collapsed. Non-web tabs collapse into 1 line such as **6 non-web tabs ignored**. A missing workspace name is **Workspace unavailable**. If `lastAccessed` or the workspace id is missing, the heading is **This window** and the popup says it is showing every workspace. Titles are shown. Full URLs are not.

No saved rules, with the default rule turned off, produces its own message and a link to the options page and does not read tab URLs. With the default rule on, an empty rule list still groups eligible tabs, and the popup still links to the options page. The link calls `chrome.runtime.openOptionsPage` when Opera provides it. Otherwise the link uses the options page URL. Corrupt saved rules are reported and left unchanged. A planning failure, including a pinned tab after an unpinned tab in the same workspace, is explained in plain language. **Cancel** closes the popup and does not move a tab.

The manifest permission `tabs` is required to read the URL and title of every tab in the current window. Opera's permissions page says `tabs` is required to use the tabs API. Opera's tabs article requests it before calling `chrome.tabs.query`. The shared tabs reference says this permission is what makes `url` and `title` available. `activeTab` covers only the active tab, so it cannot preview the rest of the window. Host permissions are not requested. Opera may warn about `tabs` when you reload the extension. That warning was not checked in Opera during this change.

Andrew confirmed a successful preview in Opera on 9 November 2026.
