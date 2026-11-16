/**
 * Apply a displayed Preview.
 *
 * Re-reads the current window, detects the workspace again, plans that
 * same scope, and compares fingerprints. A difference applies nothing.
 * A match runs the pure move list through the thin tabs adapter.
 * There is no rollback. URLs are not copied into the report.
 */

import {
  buildApplyReport,
  classifyCategory,
  planApplyMoves,
  sameFingerprint,
  workspaceKey,
} from "./apply-plan.js";
import { activateTab, moveTabInWorkspace, readCurrentWindowTabs, readScopedWindow } from "./browser-tabs.js";
import { inspectPreview } from "./preview.js";

/**
 * @param {Object[]} tabs
 * @param {string | null} workspaceId
 * @param {boolean} pinned
 * @returns {Array<string | number>}
 */
function actualIds(tabs, workspaceId, pinned) {
  return tabs
    .filter((tab) => workspaceKey(tab.workspaceId) === workspaceId && (tab.pinned === true) === pinned)
    .sort((left, right) => left.index - right.index)
    .map((tab) => tab.id);
}

/**
 * @param {Object} plan
 * @param {string | number} tabId
 * @returns {Object | null}
 */
function planTab(plan, tabId) {
  return plan.tabs.find((tab) => tab.id === tabId) || null;
}

/**
 * @param {Object} browser
 * @param {Object} plan
 * @param {{ workspaces: Object[] }} sequence
 * @returns {Promise<Object>}
 */
async function runSequence(browser, plan, sequence, startIndex) {
  /** @type {Set<string | number>} */
  const moved = new Set();
  /** @type {Set<string | number>} */
  const unchanged = new Set();
  /** @type {Object[]} */
  const failures = [];
  /** @type {Set<string | number>} */
  const failed = new Set();

  const remember = (result) => {
    for (const id of result.movedIds) {
      if (!failed.has(id)) {
        moved.add(id);
        unchanged.delete(id);
      }
    }
    for (const id of result.unchangedIds) {
      if (!failed.has(id) && !moved.has(id)) {
        unchanged.add(id);
      }
    }
    for (const failure of result.failures) {
      failed.add(failure.tabId);
      moved.delete(failure.tabId);
      unchanged.delete(failure.tabId);
      if (!failures.some((item) => item.tabId === failure.tabId)) {
        failures.push(failure);
      }
    }
  };

  for (const workspace of sequence.workspaces) {
    for (const category of workspace.categories) {
      /** @type {Array<string | number>} */
      const completed = [];
      let aborted = false;
      for (const move of category.moves) {
        if (aborted) {
          continue;
        }
        try {
          await moveTabInWorkspace(browser, move.tabId);
          completed.push(move.tabId);
        } catch {
          aborted = true;
          failures.push({
            tabId: move.tabId,
            title: move.title,
            workspaceName: move.workspaceName,
            detail: "The move failed.",
          });
          failed.add(move.tabId);
        }
      }

      let fresh = null;
      try {
        fresh = await readCurrentWindowTabs(browser);
      } catch {
        fresh = null;
      }
      const seen = fresh ? actualIds(fresh, workspace.workspaceId, category.pinned) : [];
      const relocated = [];
      if (fresh) {
        for (const tab of fresh) {
          if (startIndex.has(tab.id) && tab.index !== startIndex.get(tab.id)) {
            relocated.push(tab.id);
          }
        }
      }
      const classified = classifyCategory(category, seen, relocated);
      remember(classified);
    }
  }

  let fresh = null;
  try {
    fresh = await readCurrentWindowTabs(browser);
  } catch {
    fresh = null;
  }
  if (fresh) {
    for (const record of plan.activeTabIds) {
      const key = workspaceKey(record.workspaceId);
      const peers = fresh.filter((tab) => workspaceKey(tab.workspaceId) === key);
      const current = peers.find((tab) => tab.active === true);
      if (current && current.id === record.tabId) {
        continue;
      }
      const target = peers.find((tab) => tab.id === record.tabId);
      const described = planTab(plan, record.tabId);
      const title = described && typeof described.title === "string" && described.title.trim() !== ""
        ? described.title.trim()
        : "Untitled tab";
      const workspaceName = described && typeof described.workspaceName === "string" && described.workspaceName.trim() !== ""
        ? described.workspaceName.trim()
        : "Workspace unavailable";
      if (!target) {
        failed.add(record.tabId);
        moved.delete(record.tabId);
        unchanged.delete(record.tabId);
        failures.push({
          tabId: record.tabId,
          title,
          workspaceName,
          detail: "The active tab could not be restored.",
        });
        continue;
      }
      try {
        await activateTab(browser, record.tabId);
      } catch {
        failed.add(record.tabId);
        moved.delete(record.tabId);
        unchanged.delete(record.tabId);
        if (!failures.some((item) => item.tabId === record.tabId)) {
          failures.push({
            tabId: record.tabId,
            title,
            workspaceName,
            detail: "The active tab could not be restored.",
          });
        }
      }
    }
  }

  const unmatched = plan.tabs.filter((tab) => tab.role === "unmatched").length;
  return buildApplyReport({
    moved: moved.size,
    unchanged: unchanged.size,
    unmatched,
    failed: failed.size,
    failures,
  });
}

/**
 * Apply the Preview the popup is showing.
 * `displayedFingerprint` is the fingerprint from that Preview.
 * Rules are the list just read from storage.
 *
 * @param {Object} browser
 * @param {unknown} displayedFingerprint
 * @param {unknown} rules
 * @param {{ groupUnmatchedTabs?: unknown }} [options]
 * @returns {Promise<{ status: "applied" | "stale" | "failed", preview: Object, fingerprint: Object | null, changeCount: number, report: Object | null }>}
 */
export async function applyDisplayedPreview(browser, displayedFingerprint, rules, options = {}) {
  let scoped;
  try {
    scoped = await readScopedWindow(browser);
  } catch {
    const inspected = inspectPreview(null, rules, options);
    return {
      status: "failed",
      preview: inspected.preview,
      fingerprint: null,
      changeCount: 0,
      addRule: inspected.addRule,
      report: null,
    };
  }

  const tabs = scoped.tabs;
  const inspected = inspectPreview(tabs, rules, { ...options, scope: scoped.scope });
  if (!inspected.plan) {
    return {
      status: "failed",
      preview: inspected.preview,
      fingerprint: null,
      changeCount: 0,
      addRule: null,
      report: null,
    };
  }
  if (!sameFingerprint(displayedFingerprint, inspected.fingerprint)) {
    return {
      status: "stale",
      preview: inspected.preview,
      fingerprint: inspected.fingerprint,
      changeCount: inspected.changeCount,
      addRule: inspected.addRule,
      report: null,
    };
  }

  const sequence = planApplyMoves(inspected.plan);
  const startIndex = new Map(tabs.map((tab) => [tab.id, tab.index]));
  const report = await runSequence(browser, inspected.plan, sequence, startIndex);
  return {
    status: "applied",
    preview: inspected.preview,
    fingerprint: inspected.fingerprint,
    changeCount: inspected.changeCount,
    report,
  };
}
