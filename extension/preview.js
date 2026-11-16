/**
 * Pure preview view model.
 *
 * Turns tabs and saved Organiser Rules into display data. Pass
 * `options.scope` from `detectCurrentWorkspace` to plan 1 workspace.
 * Planning stays in `planArrangement`. This module does not read
 * storage, touch the DOM or call a browser API.
 *
 * The output lists proposed Contiguous Blocks, unmatched eligible tabs and
 * tabs that are unavailable or ineligible. It uses tab titles, rule labels
 * and workspace names. A rule block does not copy a URL, a hostname or a
 * workspace id. An automatic group is labelled with its grouping key, which
 * is a hostname and an optional first path segment, not a full URL.
 */

import { previewFingerprint } from "./apply-plan.js";
import { autoGroupKey, groupUnmatchedEnabled } from "./auto-group.js";
import { planArrangement } from "./arrangement.js";
import { tabsInScope } from "./workspace.js";

/** Shown when Opera provides no usable workspace name. */
export const WORKSPACE_UNAVAILABLE = "Workspace unavailable";

/**
 * @typedef {Object} PreviewBlock
 * @property {string} label Rule label, or the automatic grouping key.
 * @property {"rule" | "automatic"} kind
 * @property {string} workspaceName Workspace name, or `Workspace unavailable`.
 * @property {"Pinned" | "Unpinned"} category
 * @property {string[]} titles Tab titles in planned block order.
 */

/**
 * @typedef {Object} PreviewTab
 * @property {string} title
 */

/**
 * @typedef {Object} UnavailableTab
 * @property {string} title
 * @property {string} detail Plain-language reason, with no URL.
 */

/**
 * @typedef {Object} PreviewView
 * @property {boolean} ok
 * @property {"ready" | "no-matches" | "no-rules" | "unreadable-rules" | "failed"} status
 * @property {string | null} reason
 * @property {string} message
 * @property {string} heading Popup heading. A detected workspace uses its name.
 * @property {string | null} note Whole-window fallback note, or null.
 * @property {boolean} scoped True when the plan contains 1 detected workspace.
 * @property {PreviewBlock[]} blocks
 * @property {PreviewTab[]} unmatched
 * @property {UnavailableTab[]} unavailable
 */

/**
 * @typedef {Object} PreviewInspection
 * @property {PreviewView} preview
 * @property {Object | null} fingerprint
 * @property {number} changeCount
 * @property {Object | null} plan
 */

/**
 * Freeze display data so a caller cannot add a URL after the fact.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function freeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    freeze(value[key]);
  }
  return Object.freeze(value);
}

/**
 * Plural summary for the first line of a planned preview.
 * Zero uses the plural, because that is the usual English form.
 * The tab count is every unpinned tab whose planned position differs,
 * plus a pinned tab that belongs to a group and would move. Apply moves
 * the unpinned tabs. It still does not reorder pinned tabs.
 *
 * @param {number} moveCount Tabs whose planned position differs.
 * @param {number} groupCount Groups that contain at least 1 of those tabs.
 * @param {number} unmatchedCount Eligible tabs that stay unmatched.
 * @returns {string}
 */
export function summariseArrangement(moveCount, groupCount, unmatchedCount) {
  const tabs = moveCount === 1 ? "1 tab" : `${moveCount} tabs`;
  const groups = groupCount === 1 ? "1 group" : `${groupCount} groups`;
  const unmatched = `${unmatchedCount} unmatched`;
  return `${tabs} to move into ${groups}, ${unmatched}`;
}

/**
 * @param {{ mode?: string, workspaceId?: unknown, workspaceName?: unknown, note?: unknown } | null | undefined} scope
 * @returns {{ mode: "workspace" | "window" | "unspecified", heading: string, note: string | null, workspaceId: string | null }}
 */
function scopeMeta(scope) {
  if (!scope || (scope.mode !== "workspace" && scope.mode !== "window")) {
    return { mode: "unspecified", heading: "Preview", note: null, workspaceId: null };
  }
  if (scope.mode === "window") {
    const note = typeof scope.note === "string" && scope.note.trim() !== "" ? scope.note.trim() : null;
    return { mode: "window", heading: "This window", note, workspaceId: null };
  }
  const name = typeof scope.workspaceName === "string" && scope.workspaceName.trim() !== ""
    ? scope.workspaceName.trim()
    : WORKSPACE_UNAVAILABLE;
  const workspaceId = typeof scope.workspaceId === "string" && scope.workspaceId !== "" ? scope.workspaceId : null;
  return { mode: "workspace", heading: name, note: null, workspaceId };
}

/**
 * Tabs whose planned position differs and that Apply will either move or,
 * for a pinned group member, report as unsupported. A pinned single tab is
 * left out: Apply does not reorder pinned tabs, and a single pinned tab is
 * not a selected move.
 *
 * @param {import("./arrangement.js").ArrangementPlan} plan
 * @returns {import("./arrangement.js").ArrangementTab[]}
 */
function tabsThatWouldMove(plan) {
  return plan.tabs.filter((tab) => {
    if (tab.plannedIndex === tab.originalIndex) {
      return false;
    }
    return !(tab.pinned === true && tab.selected !== true);
  });
}

/**
 * @param {import("./arrangement.js").ArrangementPlan} plan
 * @param {{ unmatched: PreviewTab[] }} lists
 * @returns {string}
 */
/**
 * Read a tab URL without letting a throwing getter abort the preview.
 *
 * @param {unknown} tab
 * @returns {unknown}
 */
function readTabUrl(tab) {
  if (tab === null || typeof tab !== "object" || Array.isArray(tab)) {
    return undefined;
  }
  try {
    return tab.url;
  } catch {
    return undefined;
  }
}

/**
 * Keys for the Add rule buttons, in the same order as the preview cards
 * and the unmatched list. A rule card has no key. The key is a hostname
 * and an optional first path segment, not a full URL. It is not copied
 * into the preview object.
 *
 * @param {import("./arrangement.js").ArrangementPlan} plan
 * @param {unknown} tabs
 * @returns {{ blockKeys: Array<string | null>, unmatchedKeys: Array<string | null> }}
 */
function ruleTargets(plan, tabs) {
  /** @type {Map<string | number, unknown>} */
  const urlById = new Map();
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (tab !== null && typeof tab === "object" && !Array.isArray(tab) && tab.id != null) {
        urlById.set(tab.id, readTabUrl(tab));
      }
    }
  }
  const blockKeys = plan.blocks.map((block) => (block.automatic === true ? block.label : null));
  const unmatchedKeys = plan.tabs
    .filter((tab) => tab.role === "unmatched")
    .sort((left, right) => left.plannedIndex - right.plannedIndex)
    .map((tab) => autoGroupKey(urlById.get(tab.id)));
  return { blockKeys, unmatchedKeys };
}

function summaryFor(plan, lists) {
  const moving = tabsThatWouldMove(plan);
  const movingIds = new Set(moving.map((tab) => tab.id));
  const groupCount = plan.blocks.filter((block) => block.tabIds.some((id) => movingIds.has(id))).length;
  return summariseArrangement(moving.length, groupCount, lists.unmatched.length);
}

/**
 * @param {boolean} ok
 * @param {string} status
 * @param {string | null} reason
 * @param {string} message
 * @param {{ blocks?: PreviewBlock[], unmatched?: PreviewTab[], unavailable?: UnavailableTab[] }} [lists]
 * @param {{ heading: string, note: string | null }} [meta]
 * @returns {PreviewView}
 */
function view(ok, status, reason, message, lists = {}, meta = { heading: "Preview", note: null, mode: "unspecified" }) {
  return freeze({
    ok,
    status,
    reason,
    message,
    heading: meta.heading,
    note: meta.note,
    scoped: meta.mode === "workspace",
    blocks: lists.blocks || [],
    unmatched: lists.unmatched || [],
    unavailable: lists.unavailable || [],
  });
}

/**
 * @param {unknown} title
 * @returns {string}
 */
function titleOf(title) {
  if (typeof title === "string" && title.trim() !== "") {
    return title.trim();
  }
  return "Untitled tab";
}

/**
 * @param {unknown} name
 * @returns {string}
 */
function workspaceLabel(name) {
  if (typeof name === "string" && name.trim() !== "") {
    return name.trim();
  }
  return WORKSPACE_UNAVAILABLE;
}

/**
 * @param {import("./arrangement.js").ArrangementFailure} plan
 * @returns {string}
 */
function failureMessage(plan) {
  const position = typeof plan.index === "number" ? plan.index + 1 : null;
  if (plan.reason === "invalid-rules") {
    return "The saved rules are not valid, so no preview was planned.";
  }
  if (plan.reason === "invalid-tab") {
    if (position === null) {
      return "A tab in this window could not be read, so no preview was planned.";
    }
    return `The tab at position ${position} could not be read, so no preview was planned.`;
  }
  if (plan.reason === "duplicate-tab-id") {
    if (position === null) {
      return "2 tabs in this window use the same identifier, so no preview was planned.";
    }
    return `A tab at position ${position} repeats an earlier identifier, so no preview was planned.`;
  }
  if (plan.reason === "mixed-window") {
    if (position === null) {
      return "These tabs are not all from 1 window, so no preview was planned.";
    }
    return `A tab at position ${position} is from a different window, so no preview was planned.`;
  }
  if (plan.reason === "pinned-boundary") {
    if (position === null) {
      return "A pinned tab sits after an unpinned tab in the same workspace, so no preview was planned.";
    }
    return `A pinned tab at position ${position} sits after an unpinned tab in the same workspace, so no preview was planned.`;
  }
  if (plan.reason === "multiple-active") {
    if (position === null) {
      return "More than 1 tab is active in the same workspace, so no preview was planned.";
    }
    return `The extra active tab is at position ${position} in the same workspace, so no preview was planned.`;
  }
  return "The preview could not be planned.";
}

/**
 * @param {import("./arrangement.js").ArrangementPlan} plan
 * @returns {{ blocks: PreviewBlock[], unmatched: PreviewTab[], unavailable: UnavailableTab[] }}
 */
function presentPlan(plan) {
  const byId = new Map(plan.tabs.map((tab) => [tab.id, tab]));
  const blocks = plan.blocks.map((block) => ({
    label: block.label,
    kind: block.automatic === true ? "automatic" : "rule",
    workspaceName: workspaceLabel(block.workspaceName),
    category: block.pinned ? "Pinned" : "Unpinned",
    titles: block.tabIds.map((id) => titleOf(byId.get(id) && byId.get(id).title)),
  }));
  const unmatched = plan.tabs
    .filter((tab) => tab.role === "unmatched")
    .sort((left, right) => left.plannedIndex - right.plannedIndex)
    .map((tab) => ({ title: titleOf(tab.title) }));
  const unavailable = plan.tabs
    .filter((tab) => tab.role === "rejected")
    .sort((left, right) => left.plannedIndex - right.plannedIndex)
    .map((tab) => ({
      title: titleOf(tab.title),
      detail: tab.reason === "unsupported-url" ? "Not an HTTP or HTTPS page" : "URL unavailable",
    }));
  return { blocks, unmatched, unavailable };
}

/**
 * Preview when the Local Rule Store has no saved rules.
 *
 * @returns {PreviewView}
 */
export function buildNoRulesPreview() {
  return view(
    true,
    "no-rules",
    null,
    "No rules are saved. Add rules on the options page, then open this preview again.",
  );
}

/**
 * Preview when saved rules cannot be read. The stored value is not copied.
 *
 * @returns {PreviewView}
 */
export function buildUnreadableRulesPreview() {
  return view(
    false,
    "unreadable-rules",
    "unreadable",
    "Saved rules could not be read. Open the options page and save a valid list. Nothing was changed.",
  );
}

/**
 * Preview when the current window's tabs could not be queried.
 *
 * @returns {PreviewView}
 */
export function buildTabsReadFailure() {
  return view(
    false,
    "failed",
    "tabs-unavailable",
    "The current window could not be read, so no preview was planned.",
  );
}

/**
 * Build a Preview, plus the fingerprint Apply compares and the move count.
 * An empty rule list is the no-rules state only when the default rule is
 * off. When it is on, unmatched HTTP and HTTPS tabs are still planned.
 * The fingerprint stays beside the preview and is not part of the preview object.
 * `options.scope` from `detectCurrentWorkspace` limits the plan to that
 * workspace. A window scope plans every tab and keeps the fallback note.
 *
 * @param {unknown} tabs
 * @param {unknown} rules
 * @param {{ groupUnmatchedTabs?: unknown, scope?: { mode?: string, workspaceId?: unknown, workspaceName?: unknown, note?: unknown } }} [options]
 * @returns {PreviewInspection}
 */
export function inspectPreview(tabs, rules, options = {}) {
  const groupUnmatchedTabs = groupUnmatchedEnabled(options && options.groupUnmatchedTabs);
  const meta = scopeMeta(options && options.scope);
  const scopedTabs = meta.mode === "workspace" ? tabsInScope(tabs, options.scope) : tabs;
  if (Array.isArray(rules) && rules.length === 0 && !groupUnmatchedTabs) {
    return { preview: view(true, "no-rules", null, "No rules are saved. Add rules on the options page, then open this preview again.", {}, meta), fingerprint: null, changeCount: 0, plan: null, addRule: null };
  }
  if (!Array.isArray(scopedTabs)) {
    return { preview: view(false, "failed", "tabs-unavailable", "The current window could not be read, so no preview was planned.", {}, meta), fingerprint: null, changeCount: 0, plan: null, addRule: null };
  }

  const plan = planArrangement(scopedTabs, rules, { groupUnmatchedTabs });
  if (!plan.ok) {
    return {
      preview: view(false, "failed", plan.reason, failureMessage(plan), {}, meta),
      fingerprint: null,
      changeCount: 0,
      plan: null,
      addRule: null,
    };
  }

  const lists = presentPlan(plan);
  const summary = summaryFor(plan, lists);
  const preview = lists.blocks.length === 0
    ? view(true, "no-matches", null, summary, lists, meta)
    : view(true, "ready", null, summary, lists, meta);
  return {
    preview,
    fingerprint: previewFingerprint(plan),
    changeCount: tabsThatWouldMove(plan).length,
    plan,
    addRule: ruleTargets(plan, scopedTabs),
  };
}

/**
 * Build a Preview from tabs and rules.
 *
 * @param {unknown} tabs
 * @param {unknown} rules
 * @param {{ groupUnmatchedTabs?: unknown }} [options]
 * @returns {PreviewView}
 */
export function buildPreview(tabs, rules, options) {
  return inspectPreview(tabs, rules, options).preview;
}
