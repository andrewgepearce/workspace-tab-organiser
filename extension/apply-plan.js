/**
 * Pure apply planning for one Opera window.
 *
 * `tabs.move` on Opera 139 reads `index` as a position inside the tab's own
 * workspace. `index` -1 appends to the end of that workspace. This module
 * turns a finished arrangement plan into those operations. It does not call
 * a browser API and it does not copy a URL.
 *
 * Pinned tabs are not given an end move. A confirmed -1 lands at the end of
 * the whole workspace, after any unpinned tabs, so it would leave the pinned
 * section. The probe did not show a pinned tab staying inside that section.
 * A pinned range that is already correct is left alone. A pinned range that
 * differs is reported unsupported and is not moved.
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function workspaceKey(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

/**
 * @param {string | null} left
 * @param {string | null} right
 * @returns {number}
 */
function compareKeys(left, right) {
  const a = left === null ? "" : left;
  const b = right === null ? "" : right;
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Stable fingerprint of the plan Apply is allowed to carry out.
 * Workspaces are ordered by id. Tabs stay in planned order.
 * Active tabs are ordered by workspace id, then tab id.
 *
 * @param {Object} plan
 * @returns {{ workspaces: Object[], active: Object[] } | null}
 */
export function previewFingerprint(plan) {
  if (!plan || plan.ok !== true || !Array.isArray(plan.tabs) || !Array.isArray(plan.activeTabIds)) {
    return null;
  }
  /** @type {Map<string | null, Object[]>} */
  const groups = new Map();
  for (const tab of plan.tabs) {
    const key = workspaceKey(tab.workspaceId);
    const group = groups.get(key) || [];
    group.push(tab);
    groups.set(key, group);
  }
  const workspaces = [...groups.entries()]
    .sort((left, right) => compareKeys(left[0], right[0]))
    .map(([key, tabs]) => ({
      workspaceId: key,
      tabs: tabs
        .slice()
        .sort((left, right) => left.plannedIndex - right.plannedIndex || 0)
        .map((tab) => ({ id: tab.id, pinned: tab.pinned === true })),
    }));
  const active = plan.activeTabIds
    .map((record) => ({
      workspaceId: workspaceKey(record.workspaceId),
      tabId: record.tabId,
    }))
    .sort((left, right) => {
      const byWorkspace = compareKeys(left.workspaceId, right.workspaceId);
      if (byWorkspace !== 0) {
        return byWorkspace;
      }
      const a = String(left.tabId);
      const b = String(right.tabId);
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    });
  return { workspaces, active };
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameFingerprint(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @param {Object[]} tabs
 * @returns {Object[]}
 */
function byOriginal(tabs) {
  return tabs.slice().sort((left, right) => left.originalIndex - right.originalIndex);
}

/**
 * @param {Object[]} tabs
 * @returns {Object[]}
 */
function byPlanned(tabs) {
  return tabs.slice().sort((left, right) => left.plannedIndex - right.plannedIndex);
}

/**
 * @param {Object} tab
 * @returns {string}
 */
function titleOf(tab) {
  if (tab && typeof tab.title === "string" && tab.title.trim() !== "") {
    return tab.title.trim();
  }
  return "Untitled tab";
}

/**
 * @param {Object} tab
 * @returns {string}
 */
function workspaceNameOf(tab) {
  if (tab && typeof tab.workspaceName === "string" && tab.workspaceName.trim() !== "") {
    return tab.workspaceName.trim();
  }
  return "Workspace unavailable";
}

/**
 * @param {Object[]} current
 * @param {Object[]} target
 * @param {boolean} pinned
 * @returns {Object}
 */
function planCategory(current, target, pinned) {
  const workspaceName = workspaceNameOf(target[0] || current[0]);
  const targetIds = target.map((tab) => tab.id);
  let diff = current.length;
  if (current.length !== target.length) {
    diff = 0;
  } else {
    for (let index = 0; index < current.length; index += 1) {
      if (current[index].id !== target[index].id) {
        diff = index;
        break;
      }
    }
  }
  const unchangedIds = current.slice(0, diff).map((tab) => tab.id);
  if (diff === current.length && current.length === target.length) {
    return {
      pinned,
      supported: true,
      changed: false,
      targetIds,
      unchangedIds,
      moves: [],
      failures: [],
    };
  }
  const suffix = target.slice(diff);
  if (pinned) {
    return {
      pinned,
      supported: false,
      changed: true,
      targetIds,
      unchangedIds,
      moves: [],
      failures: suffix.map((tab) => ({
        tabId: tab.id,
        title: titleOf(tab),
        workspaceName,
        detail: "Pinned reordering is not supported, so this tab was left in place.",
      })),
    };
  }
  return {
    pinned,
    supported: true,
    changed: true,
    targetIds,
    unchangedIds,
    moves: suffix.map((tab) => ({
      tabId: tab.id,
      index: -1,
      title: titleOf(tab),
      workspaceName,
      pinned: false,
    })),
    failures: [],
  };
}

/**
 * Operations for D9. Each move asks Opera for workspace-local index -1.
 * Tabs before the first difference are not included.
 *
 * @param {Object} plan
 * @returns {{ workspaces: Object[] }}
 */
export function planApplyMoves(plan) {
  /** @type {Map<string | null, Object[]>} */
  const groups = new Map();
  for (const tab of plan.tabs) {
    const key = workspaceKey(tab.workspaceId);
    const group = groups.get(key) || [];
    group.push(tab);
    groups.set(key, group);
  }
  const workspaces = [...groups.entries()]
    .map(([key, tabs]) => ({
      workspaceId: key,
      firstIndex: Math.min(...tabs.map((tab) => tab.originalIndex)),
      categories: [false, true]
        .map((pinned) => {
          const members = tabs.filter((tab) => tab.pinned === pinned);
          if (members.length === 0) {
            return null;
          }
          return planCategory(byOriginal(members), byPlanned(members), pinned);
        })
        .filter((category) => category !== null),
    }))
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((workspace) => ({
      workspaceId: workspace.workspaceId,
      categories: workspace.categories,
    }));
  return { workspaces };
}

/**
 * A tab is moved when its window index changed and it finished in the planned place.
 * A tab that finished where it started counts as unchanged, even if a later
 * suffix move had to pick it up and put it back.
 *
 * @param {Object} category
 * @param {Array<string | number>} actualIds
 * @param {Array<string | number>} relocatedIds
 * @returns {{ movedIds: Array<string | number>, unchangedIds: Array<string | number>, failures: Object[] }}
 */
export function classifyCategory(category, actualIds, relocatedIds) {
  const relocated = new Set(relocatedIds);
  const prior = new Map(category.failures.map((failure) => [failure.tabId, failure]));
  const movedIds = [];
  const unchangedIds = [];
  const failures = [];
  for (let index = 0; index < category.targetIds.length; index += 1) {
    const tabId = category.targetIds[index];
    if (actualIds[index] === tabId) {
      if (relocated.has(tabId)) {
        movedIds.push(tabId);
      } else {
        unchangedIds.push(tabId);
      }
      continue;
    }
    const known = prior.get(tabId);
    const move = category.moves.find((item) => item.tabId === tabId);
    failures.push(
      known || {
        tabId,
        title: move ? move.title : "Untitled tab",
        workspaceName: move ? move.workspaceName : "Workspace unavailable",
        detail: "The tab was not in the planned position after the move.",
      },
    );
  }
  return { movedIds, unchangedIds, failures };
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function counted(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {{ moved: number, unchanged: number, unmatched: number, failed: number, failures: Object[] }} counts
 * @returns {Object}
 */
export function buildApplyReport(counts) {
  const failures = counts.failures.map((failure) => ({
    title: failure.title,
    workspaceName: failure.workspaceName,
    detail: failure.detail,
  }));
  const moved = counts.moved;
  const unchanged = counts.unchanged;
  const unmatched = counts.unmatched;
  const failed = counts.failed;
  return {
    ok: failed === 0,
    moved,
    unchanged,
    unmatched,
    failed,
    failures,
    message: `Moved ${counted(moved, "tab", "tabs")}. ${counted(unchanged, "tab was", "tabs were")} already in place. ${counted(unmatched, "tab did", "tabs did")} not match a rule. ${counted(failed, "tab failed", "tabs failed")}.`,
  };
}
