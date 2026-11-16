/**
 * Pure planning for the manual Opera tabs.move probe.
 *
 * The page in this directory imports these helpers and then talks to
 * chrome.tabs. Nothing here reads the DOM, storage or a browser API.
 * A tab URL is never copied into a snapshot or a report.
 */

/** Workspace the probe is allowed to move. The match is exact. */
export const TEST_A_WORKSPACE_NAME = "Test A";

/**
 * Wait before the delayed move, so a late reorder has time to settle.
 * Milliseconds.
 */
export const PRE_MOVE_DELAY_MS = 400;

/**
 * Wait after each move before the next query, so onMoved can arrive.
 * Milliseconds.
 */
export const MOVE_SETTLE_MS = 150;

/** Labels, in the order the page runs them. */
export const EXPERIMENT_LABELS = Object.freeze([
  "move-right-by-1",
  "move-right-by-2",
  "move-right-by-3",
  "move-left-by-1",
  "move-left-by-2",
  "move-to-first-unpinned",
  "move-to-index-minus-one",
  "move-two-tabs",
  "move-after-delay",
  "move-after-activate",
  "move-window-relative",
  "move-workspace-local",
]);

const URL_FIELDS = new Set(["url", "pendingUrl", "favIconUrl"]);

/**
 * @param {string} reason
 * @returns {{ ok: false, reason: string }}
 */
function skip(reason) {
  return { ok: false, reason };
}

/**
 * @param {Array<string | number>} tabIds
 * @param {number} index
 * @param {Object} [extra]
 * @returns {{ ok: true, tabIds: Array<string | number>, index: number, asArray: boolean, activateTabId: string | number | null, restoreActiveTabId: string | number | null, note: Object | null }}
 */
function request(tabIds, index, extra = {}) {
  return {
    ok: true,
    tabIds: tabIds.slice(),
    index,
    asArray: extra.asArray === true,
    activateTabId: extra.activateTabId === undefined ? null : extra.activateTabId,
    restoreActiveTabId: extra.restoreActiveTabId === undefined ? null : extra.restoreActiveTabId,
    note: extra.note === undefined ? null : extra.note,
  };
}

/**
 * @param {unknown} tab
 * @param {string} key
 * @returns {unknown}
 */
function readField(tab, key) {
  try {
    return tab[key];
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readIndex(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string | number | null}
 */
function readId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return null;
}

/**
 * Copy the fields the report is allowed to keep.
 * URL fields on the input are ignored.
 *
 * @param {unknown} tab
 * @returns {Object | null}
 */
export function snapshotTab(tab) {
  if (tab === null || typeof tab !== "object") {
    return null;
  }
  const id = readId(readField(tab, "id"));
  const index = readIndex(readField(tab, "index"));
  const workspaceName = readField(tab, "workspaceName");
  const workspaceId = readField(tab, "workspaceId");
  const title = readField(tab, "title");
  let storedId = null;
  if (typeof workspaceId === "string" || typeof workspaceId === "number") {
    storedId = workspaceId;
  }
  return {
    id,
    index,
    pinned: readField(tab, "pinned") === true,
    active: readField(tab, "active") === true,
    title: typeof title === "string" ? title : "",
    workspaceId: storedId,
    workspaceName: typeof workspaceName === "string" ? workspaceName : null,
  };
}

/**
 * Drop URL fields anywhere in a report value.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function omitUrlFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => omitUrlFields(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    if (URL_FIELDS.has(key)) {
      continue;
    }
    copy[key] = omitUrlFields(value[key]);
  }
  return copy;
}

/**
 * @param {Array<{ index: number }>} tabs
 * @returns {Array<{ index: number }>}
 */
export function sortByIndex(tabs) {
  return tabs
    .map((tab, position) => ({ tab, position }))
    .sort((left, right) => left.tab.index - right.tab.index || left.position - right.position)
    .map((entry) => entry.tab);
}

/**
 * @param {unknown} tabs
 * @returns {{ ok: true, tabs: Object[] } | { ok: false, reason: string, tabs: Object[] }}
 */
export function readProbeTabs(tabs) {
  if (!Array.isArray(tabs)) {
    return { ok: false, reason: "not-an-array", tabs: [] };
  }
  const parsed = [];
  const ids = new Set();
  const indexes = new Set();
  for (const tab of tabs) {
    const snap = snapshotTab(tab);
    if (
      snap === null ||
      snap.id === null ||
      snap.index === null ||
      snap.workspaceName === null ||
      snap.workspaceName === ""
    ) {
      return { ok: false, reason: "tab-metadata-missing", tabs: parsed };
    }
    if (ids.has(snap.id) || indexes.has(snap.index)) {
      return { ok: false, reason: "duplicate-index", tabs: parsed };
    }
    ids.add(snap.id);
    indexes.add(snap.index);
    parsed.push(snap);
  }
  return { ok: true, tabs: parsed };
}

/**
 * @param {Array<{ pinned: boolean }>} testA Tabs in index order.
 * @returns {boolean}
 */
export function pinnedBoundaryClear(testA) {
  let seenUnpinned = false;
  for (const tab of testA) {
    if (tab.pinned) {
      if (seenUnpinned) {
        return false;
      }
    } else {
      seenUnpinned = true;
    }
  }
  return true;
}

/**
 * Accept the current window only when Test A is one contiguous strip.
 *
 * @param {unknown} tabs
 * @returns {Object}
 */
export function guardTestAWindow(tabs) {
  const parsed = readProbeTabs(tabs);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      tabs: parsed.tabs,
      testA: [],
      start: null,
      end: null,
    };
  }
  const all = parsed.tabs;
  const testA = sortByIndex(all.filter((tab) => tab.workspaceName === TEST_A_WORKSPACE_NAME));
  if (testA.length === 0) {
    return { ok: false, reason: "test-a-missing", tabs: all, testA, start: null, end: null };
  }
  const start = testA[0].index;
  const end = testA[testA.length - 1].index;
  const inside = all.filter(
    (tab) => tab.workspaceName !== TEST_A_WORKSPACE_NAME && tab.index >= start && tab.index <= end,
  );
  if (inside.length > 0) {
    return { ok: false, reason: "foreign-index-inside-test-a", tabs: all, testA, start, end };
  }
  if (end - start + 1 !== testA.length) {
    return { ok: false, reason: "test-a-not-contiguous", tabs: all, testA, start, end };
  }
  if (!pinnedBoundaryClear(testA)) {
    return { ok: false, reason: "pinned-boundary-unclear", tabs: all, testA, start, end };
  }
  return { ok: true, reason: null, tabs: all, testA, start, end };
}

/**
 * @param {string} reason
 * @returns {string}
 */
export function refusalMessage(reason) {
  switch (reason) {
    case "not-an-array":
      return "The tab query did not return a list. Nothing was moved.";
    case "tab-metadata-missing":
      return "A tab in this window has no index, id or workspace name. Nothing was moved.";
    case "duplicate-index":
      return "This window has a repeated tab id or index. Nothing was moved.";
    case "test-a-missing":
      return "This window has no workspace named exactly Test A. Nothing was moved.";
    case "test-a-not-contiguous":
      return "Test A is not one contiguous index range. Nothing was moved.";
    case "foreign-index-inside-test-a":
      return "Another workspace sits inside the Test A index range. Nothing was moved.";
    case "pinned-boundary-unclear":
      return "Pinned and unpinned Test A tabs are mixed. Nothing was moved.";
    case "tabs-api-missing":
      return "chrome.tabs is not available on this page. Nothing was moved.";
    default:
      return "The probe refused to run. Nothing was moved.";
  }
}

/**
 * @param {Array<{ pinned: boolean }>} testA
 * @returns {Array<{ pinned: boolean }>}
 */
export function unpinnedTabs(testA) {
  return testA.filter((tab) => tab.pinned !== true);
}

/**
 * @param {Object[]} testA
 * @param {"left" | "right"} direction
 * @param {number} steps
 * @returns {Object}
 */
export function selectShift(testA, direction, steps) {
  if ((direction !== "left" && direction !== "right") || !Number.isInteger(steps) || steps < 1) {
    return skip("bad-shift");
  }
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return skip("no-unpinned-tab");
  }
  const first = unpinned[0].index;
  const last = unpinned[unpinned.length - 1].index;
  const delta = direction === "left" ? -steps : steps;
  for (const tab of unpinned) {
    const index = tab.index + delta;
    if (index >= first && index <= last) {
      return request([tab.id], index, {
        note: { direction, steps, fromIndex: tab.index },
      });
    }
  }
  return skip("no-room-inside-test-a");
}

/**
 * Move the last unpinned tab onto the first unpinned slot.
 *
 * @param {Object[]} testA
 * @returns {Object}
 */
export function selectFirstUnpinned(testA) {
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length < 2) {
    return skip("no-room-inside-test-a");
  }
  const target = unpinned[0].index;
  const tab = unpinned[unpinned.length - 1];
  if (tab.index === target) {
    return skip("already-there");
  }
  return request([tab.id], target, { note: { fromIndex: tab.index, slot: "first-unpinned" } });
}

/**
 * @param {Object[]} testA
 * @returns {Object}
 */
export function selectNegativeOne(testA) {
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return skip("no-unpinned-tab");
  }
  const tab = unpinned[0];
  return request([tab.id], -1, { note: { fromIndex: tab.index, index: -1 } });
}

/**
 * @param {Object[]} testA
 * @returns {Object}
 */
export function selectTwoTabs(testA) {
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length < 2) {
    return skip("fewer-than-2-unpinned");
  }
  const pair = [unpinned[0], unpinned[1]];
  const target = unpinned[unpinned.length - 1].index;
  return request(
    pair.map((tab) => tab.id),
    target,
    {
      asArray: true,
      note: { fromIndexes: pair.map((tab) => tab.index) },
    },
  );
}

/**
 * Prefer a 1-step move to the right, then to the left.
 *
 * @param {Object[]} testA
 * @returns {Object}
 */
export function selectAfterDelay(testA) {
  const right = selectShift(testA, "right", 1);
  if (right.ok) {
    return right;
  }
  return selectShift(testA, "left", 1);
}

/**
 * @param {Object[]} testA
 * @param {{ id: string | number, index: number }} tab
 * @param {number} delta
 * @returns {number | null}
 */
function shiftIndex(testA, tab, delta) {
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return null;
  }
  const index = tab.index + delta;
  if (index < unpinned[0].index || index > unpinned[unpinned.length - 1].index) {
    return null;
  }
  if (index === tab.index) {
    return null;
  }
  return index;
}

/**
 * @param {Object[]} testA
 * @returns {Object}
 */
export function selectActivateThenMove(testA) {
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return skip("no-unpinned-tab");
  }
  const active = testA.filter((tab) => tab.active === true);
  if (active.length !== 1) {
    return skip("active-tab-not-singular");
  }
  const original = active[0];
  const subject = unpinned.find((tab) => tab.id !== original.id) || unpinned[0];
  const index = shiftIndex(testA, subject, 1);
  const fallback = index === null ? shiftIndex(testA, subject, -1) : index;
  if (fallback === null) {
    return skip("no-room-inside-test-a");
  }
  return request([subject.id], fallback, {
    activateTabId: subject.id,
    restoreActiveTabId: original.id,
    note: { fromIndex: subject.index, activateTabId: subject.id },
  });
}

/**
 * Choose n for the window-index and workspace-local pair.
 * `workspaceStart + n` is an unpinned Test A slot.
 * n itself is outside that workspace when such an n exists.
 * 2 is preferred.
 *
 * @param {Object[]} testA
 * @returns {Object}
 */
export function chooseComparisonOffset(testA) {
  const unpinned = unpinnedTabs(testA);
  if (testA.length === 0 || unpinned.length === 0) {
    return { ok: false, reason: "no-unpinned-tab" };
  }
  const start = testA[0].index;
  const end = testA[testA.length - 1].index;
  const first = unpinned[0].index;
  const last = unpinned[unpinned.length - 1].index;
  const candidates = [];
  for (let n = 0; n <= end - start; n += 1) {
    const windowIndex = start + n;
    if (windowIndex >= first && windowIndex <= last) {
      candidates.push(n);
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: "no-room-inside-test-a" };
  }
  const outside = candidates.filter((n) => n < start || n > end);
  let n = candidates[0];
  if (outside.includes(2)) {
    n = 2;
  } else if (outside.length > 0) {
    n = outside[0];
  } else if (candidates.includes(2)) {
    n = 2;
  }
  const localHitsPinned = testA.some((tab) => tab.pinned === true && tab.index === n);
  return {
    ok: true,
    n,
    windowIndex: start + n,
    localIndex: n,
    inconclusive: start + n === n,
    localHitsPinned,
  };
}

/**
 * @param {Object[]} testA
 * @param {number | null} n
 * @returns {Object}
 */
export function selectWindowRelative(testA, n) {
  if (!Number.isInteger(n) || n < 0) {
    return skip("no-comparison-offset");
  }
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return skip("no-unpinned-tab");
  }
  const index = testA[0].index + n;
  if (!unpinned.some((tab) => tab.index === index)) {
    return skip("window-index-not-inside-test-a");
  }
  const subject = [...unpinned].reverse().find((tab) => tab.index !== index);
  if (!subject) {
    return skip("already-there");
  }
  return request([subject.id], index, {
    note: { interpretation: "window", n, windowIndex: index, localIndex: n },
  });
}

/**
 * @param {Object[]} testA
 * @param {number | null} n
 * @param {boolean} localHitsPinned
 * @returns {Object}
 */
export function selectWorkspaceLocal(testA, n, localHitsPinned) {
  if (!Number.isInteger(n)) {
    return skip("no-comparison-offset");
  }
  const unpinned = unpinnedTabs(testA);
  if (unpinned.length === 0) {
    return skip("no-unpinned-tab");
  }
  if (localHitsPinned) {
    return skip("local-index-is-pinned-slot");
  }
  const subject = [...unpinned].reverse().find((tab) => tab.index !== n) || unpinned[unpinned.length - 1];
  return request([subject.id], n, {
    note: {
      interpretation: "workspace-local",
      n,
      windowIndex: testA[0].index + n,
      localIndex: n,
    },
  });
}

/**
 * @param {string} label
 * @param {Object[]} testA
 * @param {{ n: number | null, inconclusive: boolean, localHitsPinned: boolean }} context
 * @returns {Object}
 */
export function planExperiment(label, testA, context) {
  switch (label) {
    case "move-right-by-1":
      return selectShift(testA, "right", 1);
    case "move-right-by-2":
      return selectShift(testA, "right", 2);
    case "move-right-by-3":
      return selectShift(testA, "right", 3);
    case "move-left-by-1":
      return selectShift(testA, "left", 1);
    case "move-left-by-2":
      return selectShift(testA, "left", 2);
    case "move-to-first-unpinned":
      return selectFirstUnpinned(testA);
    case "move-to-index-minus-one":
      return selectNegativeOne(testA);
    case "move-two-tabs":
      return selectTwoTabs(testA);
    case "move-after-delay":
      return selectAfterDelay(testA);
    case "move-after-activate":
      return selectActivateThenMove(testA);
    case "move-window-relative":
      return selectWindowRelative(testA, context.n);
    case "move-workspace-local":
      if (context.inconclusive) {
        return skip("same-numeric-index");
      }
      return selectWorkspaceLocal(testA, context.n, context.localHitsPinned);
    default:
      return skip("unknown-experiment");
  }
}

/**
 * @param {Array<string | number>} tabIds
 * @param {Object[]} testA
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertTestAIds(tabIds, testA) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    return { ok: false, reason: "no-tab-ids" };
  }
  const allowed = new Set(testA.map((tab) => tab.id));
  for (const id of tabIds) {
    if (!allowed.has(id)) {
      return { ok: false, reason: "tab-outside-test-a" };
    }
  }
  return { ok: true };
}

/**
 * @param {Array<string | number>} tabIds
 * @param {Object[]} testA
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertUnpinnedTestAIds(tabIds, testA) {
  const allowed = assertTestAIds(tabIds, testA);
  if (!allowed.ok) {
    return allowed;
  }
  for (const id of tabIds) {
    const tab = testA.find((entry) => entry.id === id);
    if (!tab || tab.pinned === true) {
      return { ok: false, reason: "pinned-tab" };
    }
  }
  return { ok: true };
}

/**
 * @param {Object[]} tabs
 * @returns {Array<string | number>}
 */
export function activeIds(tabs) {
  return tabs.filter((tab) => tab.active === true).map((tab) => tab.id);
}

/**
 * @param {Array<string | number>} left
 * @param {Array<string | number>} right
 * @returns {boolean}
 */
export function sameIdOrder(tabs, ids) {
  if (tabs.length !== ids.length) {
    return false;
  }
  for (let index = 0; index < ids.length; index += 1) {
    if (tabs[index].id !== ids[index]) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Array<string | number>} left
 * @param {Array<string | number>} right
 * @returns {boolean}
 */
function sameIdSet(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = left.map((id) => String(id)).sort();
  const sortedRight = right.map((id) => String(id)).sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

/**
 * @param {Object[]} before
 * @param {Object[]} after
 * @param {Array<string | number>} movedIds
 * @returns {boolean}
 */
export function othersKeptRelativeOrder(before, after, movedIds) {
  const moved = new Set(movedIds);
  const beforeIds = before.filter((tab) => !moved.has(tab.id)).map((tab) => tab.id);
  const afterIds = after.filter((tab) => !moved.has(tab.id)).map((tab) => tab.id);
  if (beforeIds.length !== afterIds.length) {
    return false;
  }
  return beforeIds.every((id, index) => id === afterIds[index]);
}

/**
 * @param {Object[]} tabs
 * @returns {Array<string | number>}
 */
export function foreignIds(tabs) {
  return sortByIndex(tabs.filter((tab) => tab.workspaceName !== TEST_A_WORKSPACE_NAME)).map((tab) => tab.id);
}

/**
 * Keep an error string only when it cannot carry a URL.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function publicError(error) {
  const message = error && error.message ? String(error.message) : "tabs call failed";
  if (message.includes("://")) {
    return "tabs call failed";
  }
  return message;
}

/**
 * @param {Object} input
 * @returns {Object}
 */
export function buildExperimentRecord(input) {
  const beforeTabs = input.beforeTabs || [];
  const afterTabs = input.afterTabs || beforeTabs;
  const beforeTestA = input.beforeTestA || [];
  const afterTestA = input.afterTestA || [];
  const requestInfo = input.request || null;
  const subjects = requestInfo ? requestInfo.tabIds : [];
  const subjectResults = subjects.map((id) => {
    const before = beforeTabs.find((tab) => tab.id === id) || null;
    const after = afterTabs.find((tab) => tab.id === id) || null;
    return {
      id,
      title: after ? after.title : before ? before.title : "",
      requestedIndex: requestInfo.index,
      beforeIndex: before ? before.index : null,
      observedIndex: after ? after.index : null,
      beforePinned: before ? before.pinned === true : null,
      observedPinned: after ? after.pinned === true : null,
      beforeWorkspaceName: before ? before.workspaceName : null,
      observedWorkspaceName: after ? after.workspaceName : null,
      observedWorkspaceId: after ? after.workspaceId : null,
      stayedInTestA: Boolean(after && after.workspaceName === TEST_A_WORKSPACE_NAME),
      indexChanged: before && after ? before.index !== after.index : null,
    };
  });
  const activeBefore = activeIds(beforeTestA);
  const activeImmediatelyBeforeMove = activeIds(input.activeImmediatelyBeforeMove || beforeTestA);
  const activeAfterMove = activeIds(input.activeAfterMove || afterTestA);
  const activeAfter = activeIds(afterTestA);
  const onMoved = (input.onMoved || []).map((event) => ({
    tabId: event.tabId,
    fromIndex: event.fromIndex,
    toIndex: event.toIndex,
    windowId: event.windowId,
  }));
  return {
    label: input.label,
    skipped: Boolean(input.skipReason),
    skipReason: input.skipReason || null,
    requested: requestInfo
      ? {
          tabIds: requestInfo.tabIds.slice(),
          index: requestInfo.index,
          asArray: requestInfo.asArray === true,
        }
      : null,
    subjects: subjectResults,
    error: input.error || null,
    activeBefore,
    activeImmediatelyBeforeMove,
    activeAfterMove,
    activeAfter,
    activeChangedByMove: !sameIdSet(activeImmediatelyBeforeMove, activeAfterMove),
    activeTabChanged: !sameIdSet(activeBefore, activeAfterMove),
    activeRestored: input.activeRestored === undefined ? null : input.activeRestored,
    onMoved,
    orderBefore: beforeTestA.map((tab) => tab.id),
    orderAfter: afterTestA.map((tab) => tab.id),
    workspaceStartBefore: beforeTestA.length === 0 ? null : beforeTestA[0].index,
    workspaceEndBefore: beforeTestA.length === 0 ? null : beforeTestA[beforeTestA.length - 1].index,
    workspaceStartAfter: afterTestA.length === 0 ? null : afterTestA[0].index,
    workspaceEndAfter: afterTestA.length === 0 ? null : afterTestA[afterTestA.length - 1].index,
    othersKeptRelativeOrder: othersKeptRelativeOrder(beforeTestA, afterTestA, subjects),
    foreignOrderBefore: foreignIds(beforeTabs),
    foreignOrderAfter: foreignIds(afterTabs),
    notes: input.notes || null,
  };
}

/**
 * Single-tab moves that stayed in Test A and changed index.
 *
 * @param {Object[]} experiments
 * @returns {Array<{ requestedIndex: number, observedIndex: number, workspaceEndAfter: number | null }>}
 */
function informativeMoves(experiments) {
  const found = [];
  for (const experiment of experiments) {
    if (!experiment || experiment.skipped || experiment.error) {
      continue;
    }
    if (!experiment.subjects || experiment.subjects.length !== 1) {
      continue;
    }
    const subject = experiment.subjects[0];
    if (subject.stayedInTestA !== true || subject.indexChanged !== true) {
      continue;
    }
    found.push({
      requestedIndex: subject.requestedIndex,
      observedIndex: subject.observedIndex,
      workspaceEndAfter: experiment.workspaceEndAfter,
    });
  }
  return found;
}

/**
 * @param {Object[]} experiments
 * @returns {"unknown" | "honours-requested-index" | "clamps-to-workspace-end" | "mixed"}
 */
export function classifyMoves(experiments) {
  const informative = informativeMoves(experiments);
  if (informative.length === 0) {
    return "unknown";
  }
  if (informative.every((item) => item.observedIndex === item.requestedIndex)) {
    return "honours-requested-index";
  }
  if (informative.every((item) => item.observedIndex === item.workspaceEndAfter)) {
    return "clamps-to-workspace-end";
  }
  return "mixed";
}

/**
 * @param {Object[]} experiments
 * @returns {boolean}
 */
export function negativeOneMovesInside(experiments) {
  const experiment = experiments.find((item) => item && item.label === "move-to-index-minus-one");
  if (!experiment || experiment.skipped || experiment.error || !experiment.subjects) {
    return false;
  }
  const subject = experiment.subjects[0];
  return Boolean(subject && subject.stayedInTestA === true && subject.indexChanged === true);
}

/**
 * @param {string} classification
 * @param {boolean} negativeOneMoves
 * @returns {string[]}
 */
export function chooseRestoreMethods(classification, negativeOneMoves) {
  const extra = negativeOneMoves ? ["append-via-index-minus-one"] : [];
  if (classification === "honours-requested-index") {
    return ["original-index", "append-to-workspace-end"].concat(extra);
  }
  if (classification === "clamps-to-workspace-end") {
    return ["append-to-workspace-end", "original-index"].concat(extra);
  }
  return ["original-index", "append-to-workspace-end"].concat(extra);
}

/**
 * @param {Object[]} testA
 * @param {Object[]} originalTestA
 * @returns {Object}
 */
export function planOriginalIndexStep(testA, originalTestA) {
  for (const original of originalTestA) {
    if (original.pinned === true) {
      continue;
    }
    const current = testA.find((tab) => tab.id === original.id);
    if (!current) {
      return { ok: false, reason: "tab-missing" };
    }
    if (current.workspaceName !== TEST_A_WORKSPACE_NAME) {
      return { ok: false, reason: "tab-left-test-a" };
    }
    if (current.index !== original.index) {
      return { ok: true, done: false, skip: false, tabId: original.id, index: original.index };
    }
  }
  return { ok: true, done: true, skip: false };
}

/**
 * @param {Object[]} testA
 * @param {Array<string | number>} originalUnpinnedIds
 * @param {number} cursor
 * @param {"end" | "minus-one"} mode
 * @returns {Object}
 */
export function planAppendStep(testA, originalUnpinnedIds, cursor, mode) {
  if (originalUnpinnedIds.length === 0) {
    return { ok: true, done: true, skip: false };
  }
  const tabId = originalUnpinnedIds[cursor % originalUnpinnedIds.length];
  const tab = testA.find((entry) => entry.id === tabId);
  if (!tab || tab.workspaceName !== TEST_A_WORKSPACE_NAME) {
    return { ok: false, reason: "tab-missing" };
  }
  const end = testA[testA.length - 1].index;
  const index = mode === "minus-one" ? -1 : end;
  const nextCursor = cursor + 1;
  if (mode !== "minus-one" && tab.index === end) {
    return { ok: true, done: false, skip: true, tabId, index, nextCursor };
  }
  return { ok: true, done: false, skip: false, tabId, index, nextCursor };
}

/**
 * @param {Object} parts
 * @returns {Object}
 */
export function buildReport(parts) {
  return omitUrlFields({
    probe: "opera-tabs-move",
    manifestVersion: parts.manifestVersion || null,
    startedAt: parts.startedAt,
    finishedAt: parts.finishedAt,
    refused: parts.refused === true,
    refusalReason: parts.refusalReason || null,
    message: parts.message || null,
    delaysMs: {
      preMove: parts.preMoveDelayMs,
      settle: parts.settleMs,
    },
    snapshot: parts.snapshot || null,
    experiments: parts.experiments || [],
    restore: parts.restore || null,
    limits: [
      "Only tabs in the current window whose workspaceName is exactly Test A are passed to tabs.move or tabs.update.",
      "The probe does not create, close, reload or navigate a tab.",
      "Observed indexes come from a fresh tabs.query after each move.",
    ],
  });
}

/**
 * @param {Object} report
 * @returns {string}
 */
export function statusLine(report) {
  if (report.refused) {
    return report.message || refusalMessage(report.refusalReason);
  }
  if (report.restore && report.restore.succeeded === true) {
    return "Finished. Test A is back in its original order.";
  }
  return "Finished. Test A order was not restored. See the report.";
}
