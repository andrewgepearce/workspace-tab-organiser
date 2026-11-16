/**
 * Detect the current Opera workspace from active tabs.
 *
 * The caller passes the active tabs from the current window. Opera returns
 * 1 active tab per workspace. A highlight flag is false on all of them,
 * and the last focused window can be empty when devtools has focus.
 * This module reads neither.
 *
 * The current workspace is the workspace id of the tab with the newest
 * `lastAccessed`. A tab with no finite `lastAccessed` is not a candidate.
 * When several candidates share that time, the first one in the query
 * result is kept. If no candidate exists, or the newest tab has no
 * workspace id, the caller uses the whole window.
 *
 * This module does not read storage, touch the DOM or call a browser API.
 */

/** Shown when the current workspace cannot be detected. */
export const WINDOW_SCOPE_NOTE = "The current workspace could not be detected, so this preview includes every workspace in the window.";

/** Shown when the detected tab has a workspace id and no usable name. */
export const WORKSPACE_NAME_UNAVAILABLE = "Workspace unavailable";

/**
 * @typedef {Object} WorkspaceScope
 * @property {"workspace" | "window"} mode
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {string | null} note
 */

/**
 * Read a finite number. A throwing getter is treated as missing.
 *
 * @param {unknown} tab
 * @param {string} key
 * @returns {number | null}
 */
function readNumber(tab, key) {
  if (tab === null || typeof tab !== "object") {
    return null;
  }
  try {
    const value = tab[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {unknown} tab
 * @returns {string | null}
 */
function readWorkspaceId(tab) {
  if (tab === null || typeof tab !== "object") {
    return null;
  }
  try {
    const value = tab.workspaceId;
    if (typeof value === "string" && value !== "") {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {unknown} tab
 * @returns {string | null}
 */
function readWorkspaceName(tab) {
  if (tab === null || typeof tab !== "object") {
    return null;
  }
  try {
    const value = tab.workspaceName;
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @returns {WorkspaceScope}
 */
function windowScope() {
  return {
    mode: "window",
    workspaceId: null,
    workspaceName: null,
    note: WINDOW_SCOPE_NOTE,
  };
}

/**
 * Detect the current workspace from the active-tab query result.
 *
 * @param {unknown} tabs
 * @returns {WorkspaceScope}
 */
export function detectCurrentWorkspace(tabs) {
  if (!Array.isArray(tabs)) {
    return windowScope();
  }

  let best = null;
  let bestAccessed = null;
  for (const tab of tabs) {
    const accessed = readNumber(tab, "lastAccessed");
    if (accessed === null) {
      continue;
    }
    if (bestAccessed === null || accessed > bestAccessed) {
      bestAccessed = accessed;
      best = tab;
    }
  }

  if (best === null) {
    return windowScope();
  }

  const workspaceId = readWorkspaceId(best);
  if (workspaceId === null) {
    return windowScope();
  }

  const workspaceName = readWorkspaceName(best);
  return {
    mode: "workspace",
    workspaceId,
    workspaceName: workspaceName === null ? WORKSPACE_NAME_UNAVAILABLE : workspaceName,
    note: null,
  };
}

/**
 * Keep the tabs that belong to a detected workspace.
 * A window scope returns a shallow copy of the list.
 * A non-array is returned unchanged so the planner can reject it.
 *
 * @param {unknown} tabs
 * @param {WorkspaceScope | null | undefined} scope
 * @returns {unknown}
 */
export function tabsInScope(tabs, scope) {
  if (!Array.isArray(tabs)) {
    return tabs;
  }
  if (!scope || scope.mode !== "workspace" || typeof scope.workspaceId !== "string" || scope.workspaceId === "") {
    return tabs.slice();
  }
  return tabs.filter((tab) => readWorkspaceId(tab) === scope.workspaceId);
}
