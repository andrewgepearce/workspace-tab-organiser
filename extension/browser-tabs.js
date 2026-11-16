import { detectCurrentWorkspace, tabsInScope } from "./workspace.js";

/**
 * Read tabs in the current Opera window.
 *
 * Pass a chrome-like object. Tests pass a fake. The popup passes `chrome`.
 * `query` reads the current window. When every tab has a numeric index,
 * the returned list follows that index so the planner sees window order.
 * Otherwise the list keeps the order `query` returned.
 * `moveTabInWorkspace` and `activateTab` are the only mutating calls.
 * A move always asks for workspace-local index -1. An update only sets
 * `active`. This module does not create, close, reload or navigate a tab.
 *
 * The tab objects still carry URLs because matching needs them. This module
 * does not store, log or transmit those URLs.
 */

/**
 * Read a finite tab index. A throwing getter is treated as missing.
 *
 * @param {unknown} tab
 * @returns {number | null}
 */
function readIndex(tab) {
  if (tab === null || typeof tab !== "object") {
    return null;
  }
  try {
    const index = tab.index;
    if (typeof index === "number" && Number.isFinite(index)) {
      return index;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Copy the list into window order when every tab exposes an index.
 *
 * @param {object[]} tabs
 * @returns {object[]}
 */
function orderByIndex(tabs) {
  const indexes = tabs.map((tab) => readIndex(tab));
  if (indexes.some((index) => index === null)) {
    return tabs.slice();
  }
  return tabs
    .map((tab, position) => ({ tab, position, index: indexes[position] }))
    .sort((left, right) => left.index - right.index || left.position - right.position)
    .map((entry) => entry.tab);
}

/**
 * Report a query failure without reading the error text.
 * Opera and Chrome put the failure on `runtime.lastError`.
 *
 * @param {{ runtime?: { lastError?: unknown } }} browser
 * @returns {boolean}
 */
function queryFailed(browser) {
  const runtime = browser && browser.runtime;
  return Boolean(runtime && runtime.lastError);
}

/**
 * Read tabs with one query.
 *
 * Supports the callback form Opera documents and a promise return. The first
 * successful result wins, so a browser that does both does not produce 2 lists.
 *
 * @param {{ tabs?: { query?: Function }, runtime?: { lastError?: unknown } }} browser
 * @param {Object} queryInfo
 * @returns {Promise<object[]>}
 */
function queryWindowTabs(browser, queryInfo) {
  const tabsApi = browser && browser.tabs;
  const query = tabsApi && tabsApi.query;
  if (typeof query !== "function") {
    return Promise.reject(new Error("tabs query is not available"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("tabs query failed"));
    };

    const succeed = (tabs) => {
      if (settled) {
        return;
      }
      settled = true;
      if (!Array.isArray(tabs)) {
        reject(new Error("tabs query failed"));
        return;
      }
      resolve(orderByIndex(tabs));
    };

    let result;
    try {
      result = query.call(tabsApi, queryInfo, (tabs) => {
        if (queryFailed(browser)) {
          fail();
          return;
        }
        succeed(tabs);
      });
    } catch {
      fail();
      return;
    }

    if (result && typeof result.then === "function") {
      result.then(
        (tabs) => {
          if (queryFailed(browser)) {
            fail();
            return;
          }
          succeed(tabs);
        },
        () => fail(),
      );
    }
  });
}

/**
 * Read the Current Window's tabs.
 *
 * @param {{ tabs?: { query?: Function }, runtime?: { lastError?: unknown } }} browser
 * @returns {Promise<object[]>}
 */
export function readCurrentWindowTabs(browser) {
  return queryWindowTabs(browser, { currentWindow: true });
}

/**
 * Read the active tabs in the Current Window.
 * Opera returns 1 active tab per workspace. Detection uses `lastAccessed`
 * on this list. It does not use `highlighted` or `lastFocusedWindow`.
 *
 * @param {{ tabs?: { query?: Function }, runtime?: { lastError?: unknown } }} browser
 * @returns {Promise<object[]>}
 */
export function readActiveWindowTabs(browser) {
  return queryWindowTabs(browser, { active: true, currentWindow: true });
}

/**
 * Read the current window and the workspace the popup should use.
 * A failed active-tab query falls back to the whole window. A failed
 * window query rejects, because there is nothing to plan.
 *
 * @param {{ tabs?: { query?: Function }, runtime?: { lastError?: unknown } }} browser
 * @returns {Promise<{ tabs: object[], scope: import("./workspace.js").WorkspaceScope }>}
 */
export async function readScopedWindow(browser) {
  let active = null;
  try {
    active = await readActiveWindowTabs(browser);
  } catch {
    active = null;
  }
  const tabs = await readCurrentWindowTabs(browser);
  const scope = detectCurrentWorkspace(active);
  return {
    tabs: tabsInScope(tabs, scope),
    scope,
  };
}

/**
 * Call one tabs method. The callback form and a promise are both accepted.
 * The first successful result wins. Failure text from the browser is not copied.
 *
 * @param {{ tabs?: Object, runtime?: { lastError?: unknown } }} browser
 * @param {string} method
 * @param {unknown[]} args
 * @param {string} unavailable
 * @param {string} failed
 * @returns {Promise<void>}
 */
function callTabMethod(browser, method, args, unavailable, failed) {
  const tabsApi = browser && browser.tabs;
  const fn = tabsApi && tabsApi[method];
  if (typeof fn !== "function") {
    return Promise.reject(new Error(unavailable));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(failed));
    };

    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    let result;
    try {
      result = fn.apply(tabsApi, args.concat(() => {
        if (queryFailed(browser)) {
          fail();
          return;
        }
        succeed();
      }));
    } catch {
      fail();
      return;
    }

    if (result && typeof result.then === "function") {
      result.then(
        () => {
          if (queryFailed(browser)) {
            fail();
            return;
          }
          succeed();
        },
        () => fail(),
      );
    }
  });
}

/**
 * Append one tab to the end of its own workspace.
 * Opera 139 treats -1 as that end. The id is a single tab, not an array.
 *
 * @param {{ tabs?: { move?: Function }, runtime?: { lastError?: unknown } }} browser
 * @param {string | number} tabId
 * @returns {Promise<void>}
 */
export function moveTabInWorkspace(browser, tabId) {
  return callTabMethod(browser, "move", [tabId, { index: -1 }], "tabs move is not available", "tabs move failed");
}

/**
 * Make one tab active. The caller must already know it was that workspace's active tab.
 *
 * @param {{ tabs?: { update?: Function }, runtime?: { lastError?: unknown } }} browser
 * @param {string | number} tabId
 * @returns {Promise<void>}
 */
export function activateTab(browser, tabId) {
  return callTabMethod(
    browser,
    "update",
    [tabId, { active: true }],
    "tabs update is not available",
    "tabs update failed",
  );
}
