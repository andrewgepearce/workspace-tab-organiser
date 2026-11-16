# Workspace Tab Organiser System Design Gaps

## Ambiguities

No material ambiguities remain after rule precedence, block placement, D4 workspace anchors and D5 explicit Save were decided.

## Undefined Terms

No material undefined terms were identified in this review.

## Missing Actors

No material missing actors were identified in this review.

## Weak Contracts

No material weak contracts remain. D4 and the arrangement planner tests fix the earliest-tab anchor. When automatic ordering is on, D24 places every user rule group in rule order, then automatic groups from A to Z, then single tabs by title. Anchors are kept when a workspace boundary separates blocks, and the plan records that boundary.

## Structural Gaps

No material structural gaps were identified in this review.

## Open Questions

- [important] The Manifest V2 skeleton loaded in Opera 139.0 on 6 November 2026. Andrew confirmed a successful preview in Opera on 9 November 2026. D6 allows 1 active tab per workspace and D7 checks the pinned-tab boundary inside each workspace. The options page, the `tabs` permission warning and `runtime.openOptionsPage` have not been checked. Those checks are manual. The probe run on 9 November 2026 confirmed workspace-local `tabs.move`. Apply is implemented from D8 and D9. BL-006 was merged in PR 7 as 973f473. Andrew's Apply check in Opera is still manual. See [Opera tabs.move research](research/opera-tabs-move.md). D10, D11 and D12 are implemented for automatic grouping of unmatched tabs. Andrew checked automatic groups in Opera on 10 November 2026. BL-008 was merged in PR 8 as bab8620.

The questions about index scope, `workspaceId` type and `workspaceName` are closed. Andrew's 9 November 2026 query shows a window-wide `index`, a string `workspaceId` and a `workspaceName` on every returned tab. See D7 in the system design.
- [minor] Rule export and import are outside the first version. Their priority should be considered only after the local workflow has been tested.
- [important] BL-007 is done. It was merged in PR 9 as 4497bc4. Andrew checked drag-only reorder and the edit icon in Opera on 10 November 2026. One trailing slash is still removed, and a further trailing slash is kept. See the system design.
- [important] BL-009 is done. It was merged in PR 10 as 10e08f0. D20 limits the popup to the current workspace. D21 detects that workspace from the newest `lastAccessed` among the active tabs in the current window. D22 is the compact preview.
- [important] BL-011 is done. It was merged in PR 11 as 084ccdc. D23 sorts a single unmatched tab by title, and by URL when it has no title. D24 lays out user rule groups, then automatic groups from A to Z, then those single tabs. D25 ignores a leading bracket count while sorting and does not change the displayed title.
- [important] BL-010 is in review. D26 saves a rule from the popup at once and refreshes the preview without applying moves. D27 uses the hostname plus the first path segment, or the hostname alone when the path is only `/`. D28 puts Add rule on each single unmatched tab and once on each Automatic card. Node tests passed. Andrew's check in Opera is still manual.
