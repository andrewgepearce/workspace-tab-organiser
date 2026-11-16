/**
 * Pure arrangement planning for the current Opera window.
 *
 * This module does not read storage, touch the DOM, or move browser tabs.
 * It validates Organiser Rules through the ordered matcher, then builds a
 * serialisable plan a later preview can show and a later apply step can
 * follow. Tab URLs are not copied into the plan.
 *
 * The caller supplies one window as an array in current window order. Tabs
 * are partitioned by pinned category and then by existing workspace. A
 * Contiguous Block is the matching tabs that share a rule label, a workspace,
 * and a pinned or unpinned category.
 *
 * Inside one workspace and pin category, each block starts with its earliest
 * matching tab. The block's other tabs follow in their original relative
 * order. Unmatched tabs are not selected into a block. A run stays inside
 * the workspace slots that workspace already occupied, so an anchor may move
 * onto another slot of the same workspace.
 *
 * D23, D24 and D25 apply when automatic ordering is on. The layout in one
 * workspace and pin category is the user's rule groups in rule order, then
 * automatic groups from A to Z by their key, then single unmatched tabs
 * sorted by title. A leading bracket count such as "(7) " is ignored for
 * that sort. The displayed title is left as it was. A tab with no title
 * sorts by its URL. Comparison is case and accent insensitive, using
 * Intl.Collator with locale en-GB and sensitivity base. An equal sort key
 * then uses the URL, and an equal URL keeps the original position. A
 * rejected tab is not sorted by title. It keeps its original relative order
 * and sits after those single tabs, so a non-web tab does not split a
 * group. This replaces leaving an automatic group where it was opened.
 *
 * When `options.groupUnmatchedTabs` is false, that layout is off as well as
 * the groups. Unmatched tabs keep the earlier placement: user-rule blocks
 * that are already in rule order are packed, a later rule is not pulled
 * forward across an unmatched tab, a rejected tab still splits the run, and
 * nothing is sorted by title.
 *
 * D4: keeping every anchor takes priority over combining adjacent blocks
 * across workspaces. A tab is never written into another workspace's slot,
 * and blocks on opposite sides of a workspace boundary are not merged or
 * reordered to satisfy rule order. The same label in two workspaces stays
 * two blocks, each anchored on its own earliest tab. A missing, empty, or
 * null workspace id is one unavailable workspace, not a reason to drop the
 * boundary between real workspace ids. Pinned and unpinned tabs are separate
 * categories, and the plan never crosses Opera's pinned-tab boundary.
 *
 * D7: that boundary is inside 1 workspace. In window order, pinned tabs in a
 * workspace must precede its unpinned tabs. A pin is not compared with tabs
 * in another workspace. Arranged tabs are written back into the slots of the
 * same workspace and pin category, so pins are not gathered to the front of
 * the whole window.
 *
 * D6: Opera marks 1 tab active in each workspace, and a current-window query
 * includes every workspace. 1 active tab per workspace is valid. 2 active
 * tabs in the same workspace are rejected. Tabs with no workspace id share
 * 1 group. The plan records those active tabs in first-appearance order.
 *
 * D10 and D11: a tab that matches no Organiser Rule can join an automatic
 * group. The key is the hostname plus the first path segment. The group is
 * built inside 1 workspace and 1 pin category, and only when that key has
 * at least 2 unmatched tabs there. A tab that already matches an Organiser
 * Rule is not counted and is not placed in an automatic group. With
 * automatic ordering on, those groups follow every user rule and are
 * ordered from A to Z by the key. A singleton stays a single tab and is
 * sorted with the other single tabs. The default is on unless
 * `options.groupUnmatchedTabs` is false (D12). That one switch turns the
 * groups and the sorting on or off together.
 *
 * The workspace id and pin state at each window index stay the same. Another
 * workspace may therefore keep sitting between two tabs of one block. The
 * plan records that boundary, the block's workspace order, and any
 * interrupting tabs.
 */

import { autoGroupKey, groupUnmatchedEnabled } from "./auto-group.js";
import { matchTabs, validateRules } from "./matching.js";

/**
 * Case and accent insensitive order. en-GB keeps the sort stable across
 * machines. Base sensitivity treats "Echo" and "écho" as the same letters.
 */
const textOrder = new Intl.Collator("en-GB", { sensitivity: "base", usage: "sort" });

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementEndpoint
 * @property {string | number} tabId
 * @property {string | null} label
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {boolean} pinned
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementTab
 * @property {string | number} id
 * @property {number} originalIndex
 * @property {number} plannedIndex
 * @property {boolean} pinned
 * @property {boolean} active
 * @property {string | number | null} windowId
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {string | null} title
 * @property {boolean} selected True when the tab belongs to a Contiguous Block.
 * @property {"anchor" | "member" | "unmatched" | "rejected"} role
 * @property {string | null} label
 * @property {string | null} ruleId
 * @property {boolean} automatic True when the tab belongs to an automatic group.
 * @property {"malformed-url" | "unsupported-url" | null} reason
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ContiguousBlockPlan
 * @property {string} label
 * @property {string} ruleId Rule that matched the anchor tab.
 * @property {number} ruleIndex Earliest contributing rule, used to order adjacent blocks.
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {boolean} pinned
 * @property {string | number} anchorTabId
 * @property {Array<string | number>} tabIds Anchor first, then original relative order.
 * @property {boolean} automatic True when the block is the default rule, not an Organiser Rule.
 * @property {boolean} contiguousInWindow False when another workspace occupies an index between these tabs.
 * @property {ArrangementEndpoint[]} interruptions Tabs that occupy those indexes.
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementMove
 * @property {string | number} tabId
 * @property {number} fromIndex
 * @property {number} toIndex
 * @property {string} label
 * @property {string | number} anchorTabId
 * @property {string | null} workspaceId
 * @property {boolean} pinned
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementBoundary
 * @property {"workspace" | "pin"} type
 * @property {number} afterIndex Boundary after this index in the planned order.
 * @property {true} anchorsKept D4 and the pin split both keep the anchors on each side.
 * @property {ArrangementEndpoint} before
 * @property {ArrangementEndpoint} after
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} SeparationAnchor
 * @property {string | number} tabId
 * @property {string} ruleId
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {boolean} pinned
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementSeparation
 * @property {"workspace" | "pin"} type
 * @property {string} label
 * @property {boolean | null} pinned Shared pin category, or null when a pin boundary splits the label.
 * @property {SeparationAnchor[]} anchors Anchors kept, in planned window order.
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ActiveTabRecord
 * @property {string | null} workspaceId Normalised workspace key. Null is the group with no workspace metadata.
 * @property {string | number} tabId
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementPlan
 * @property {true} ok
 * @property {string | number | null} windowId
 * @property {ActiveTabRecord[]} activeTabIds One active tab per workspace, in first-appearance order.
 * @property {number} tabCount
 * @property {Array<string | number>} order Planned ids. Array position is the window index.
 * @property {ArrangementTab[]} tabs One entry per input tab, in the original window order.
 * @property {ContiguousBlockPlan[]} blocks
 * @property {ArrangementMove[]} moves Selected tabs whose window index changes.
 * @property {ArrangementBoundary[]} boundaries
 * @property {ArrangementSeparation[]} separations
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * @typedef {Object} ArrangementFailure
 * @property {false} ok
 * @property {"invalid-rules" | "invalid-tab" | "duplicate-tab-id" | "mixed-window" | "pinned-boundary" | "multiple-active"} reason
 * @property {number | null} index Tab index when one tab is at fault, otherwise null.
 * @property {string | null} field
 * @property {Array<{ index: number | null, field: string, code: string }> | null} errors
 */

/**
 * @typedef {Object} WorkingTab
 * @property {string | number} id
 * @property {number} originalIndex
 * @property {boolean} pinned
 * @property {boolean} active
 * @property {string | number | null} windowId
 * @property {string | null} workspaceId
 * @property {string | null} workspaceName
 * @property {string | null} title
 * @property {"matched" | "unmatched" | "rejected"} status
 * @property {string | null} label
 * @property {string | null} ruleId
 * @property {number | null} ruleIndex
 * @property {string | null} blockKey Identity of the block. Separate from the display label.
 * @property {boolean} automatic
 * @property {string} sortUrl URL used only while sorting. It is not copied into the plan.
 * @property {"malformed-url" | "unsupported-url" | null} reason
 */

////////////////////////////////////////////////////////////////////////////////
/**
 * Read one tab field without letting a throwing getter abort planning.
 *
 * @param {object} tab
 * @param {string} field
 * @returns {{ ok: true, value: unknown } | { ok: false }}
 */
function readField(tab, field) {
  try {
    return { ok: true, value: tab[field] };
  } catch {
    return { ok: false };
  }
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Copy a display string. Non-strings and throwing values become null.
 *
 * @param {object} tab
 * @param {string} field
 * @returns {string | null}
 */
function readText(tab, field) {
  const read = readField(tab, field);
  if (!read.ok || typeof read.value !== "string") {
    return null;
  }
  return read.value;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Normalise a workspace id. Only a non-empty string is its own workspace.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function workspaceKey(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Freeze a plan or failure so callers can inspect it without changing it.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Build a failure result that does not echo tab or rule values.
 *
 * @param {ArrangementFailure["reason"]} reason
 * @param {number | null} index
 * @param {string | null} field
 * @param {ArrangementFailure["errors"]} [errors]
 * @returns {ArrangementFailure}
 */
function failure(reason, index, field, errors = null) {
  return deepFreeze({
    ok: false,
    reason,
    index,
    field,
    errors,
  });
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Accept a safe integer or a non-empty string without whitespace.
 *
 * @param {unknown} value
 * @returns {string | number | null}
 */
function identityValue(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "" && value === value.trim() && !/\s/.test(value)) {
    return value;
  }
  return null;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Validate one tab's planning fields. Display text is tolerated.
 *
 * @param {unknown} tab
 * @param {number} index
 * @returns {{ ok: true, id: string | number, pinned: boolean, active: boolean, windowId: string | number | null, windowPresent: boolean, workspaceId: string | null, workspaceName: string | null, title: string | null } | { ok: false, failure: ArrangementFailure }}
 */
function validateTabShape(tab, index) {
  if (tab === null || typeof tab !== "object" || Array.isArray(tab)) {
    return { ok: false, failure: failure("invalid-tab", index, "tab") };
  }

  const idRead = readField(tab, "id");
  const id = idRead.ok ? identityValue(idRead.value) : null;
  if (!idRead.ok || id === null) {
    return { ok: false, failure: failure("invalid-tab", index, "id") };
  }

  const pinnedRead = readField(tab, "pinned");
  if (!pinnedRead.ok || (pinnedRead.value != null && typeof pinnedRead.value !== "boolean")) {
    return { ok: false, failure: failure("invalid-tab", index, "pinned") };
  }

  const activeRead = readField(tab, "active");
  if (!activeRead.ok || (activeRead.value != null && typeof activeRead.value !== "boolean")) {
    return { ok: false, failure: failure("invalid-tab", index, "active") };
  }

  const windowRead = readField(tab, "windowId");
  if (!windowRead.ok) {
    return { ok: false, failure: failure("invalid-tab", index, "windowId") };
  }
  const windowPresent = windowRead.value != null;
  const windowId = windowPresent ? identityValue(windowRead.value) : null;
  if (windowPresent && windowId === null) {
    return { ok: false, failure: failure("invalid-tab", index, "windowId") };
  }

  const workspaceRead = readField(tab, "workspaceId");
  if (!workspaceRead.ok) {
    return { ok: false, failure: failure("invalid-tab", index, "workspaceId") };
  }
  if (
    workspaceRead.value != null &&
    workspaceRead.value !== "" &&
    typeof workspaceRead.value !== "string"
  ) {
    return { ok: false, failure: failure("invalid-tab", index, "workspaceId") };
  }

  return {
    ok: true,
    id,
    pinned: pinnedRead.value === true,
    active: activeRead.value === true,
    windowId,
    windowPresent,
    workspaceId: workspaceKey(workspaceRead.value),
    workspaceName: readText(tab, "workspaceName"),
    title: readText(tab, "title"),
  };
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Read a tab URL without letting a throwing getter abort planning.
 *
 * @param {object} tab
 * @returns {unknown}
 */
function readUrl(tab) {
  const read = readField(tab, "url");
  return read.ok ? read.value : undefined;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Bucket id for one automatic group inside a workspace and pin category.
 *
 * @param {WorkingTab} entry
 * @param {string} key
 * @returns {string}
 */
function autoBucketId(entry, key) {
  return `${entry.pinned ? "1" : "0"}\u0000${entry.workspaceId ?? ""}\u0000${key}`;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Turn unmatched tabs into automatic groups when a key has at least 2 tabs
 * in the same workspace and pin category. Matched and rejected tabs are
 * left as they are. A key with 1 tab stays unmatched.
 *
 * @param {WorkingTab[]} entries
 * @param {readonly object[]} tabs
 * @param {number} ruleCount
 */
function assignAutoGroups(entries, tabs, ruleCount) {
  /** @type {Map<string, { key: string, indexes: number[] }>} */
  const buckets = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.status !== "unmatched") {
      continue;
    }
    const key = autoGroupKey(readUrl(tabs[index]));
    if (key === null) {
      continue;
    }
    const bucketId = autoBucketId(entry, key);
    const bucket = buckets.get(bucketId) ?? { key, indexes: [] };
    bucket.indexes.push(index);
    buckets.set(bucketId, bucket);
  }

  let nextIndex = ruleCount;
  for (const bucket of buckets.values()) {
    if (bucket.indexes.length < 2) {
      continue;
    }
    const ruleIndex = nextIndex;
    nextIndex += 1;
    for (const index of bucket.indexes) {
      const entry = entries[index];
      entry.status = "matched";
      entry.label = bucket.key;
      entry.ruleId = `auto:${bucket.key}`;
      entry.ruleIndex = ruleIndex;
      entry.blockKey = `auto:${bucket.key}`;
      entry.automatic = true;
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Validate the window and return working tabs with match results attached.
 * Rules are validated before tab shape so an invalid rule list does not
 * depend on tab contents. A non-array tab list is a caller error.
 *
 * @param {unknown} tabs
 * @param {readonly import("./matching.js").OrganiserRule[]} rules
 * @param {boolean} groupUnmatched
 * @returns {{ ok: true, windowId: string | number | null, entries: WorkingTab[] } | { ok: false, failure: ArrangementFailure }}
 */
function prepareEntries(tabs, rules, groupUnmatched) {
  const matches = matchTabs(tabs, rules);
  /** @type {WorkingTab[]} */
  const entries = [];
  /** @type {Set<string | number>} */
  const seenIds = new Set();
  /** @type {Set<string | null>} */
  const activeWorkspaces = new Set();
  /** @type {Set<string | null>} */
  const unpinnedWorkspaces = new Set();
  /** @type {{ present: boolean, id: string | number | null } | null} */
  let windowIdentity = null;
  /** @type {Map<string, number>} */
  const ruleIndexById = new Map(rules.map((rule, ruleIndex) => [rule.id, ruleIndex]));

  for (let index = 0; index < tabs.length; index += 1) {
    const shape = validateTabShape(tabs[index], index);
    if (!shape.ok) {
      return shape;
    }
    if (seenIds.has(shape.id)) {
      return { ok: false, failure: failure("duplicate-tab-id", index, "id") };
    }
    seenIds.add(shape.id);

    if (shape.active) {
      if (activeWorkspaces.has(shape.workspaceId)) {
        return { ok: false, failure: failure("multiple-active", index, "active") };
      }
      activeWorkspaces.add(shape.workspaceId);
    }

    if (shape.pinned) {
      if (unpinnedWorkspaces.has(shape.workspaceId)) {
        return { ok: false, failure: failure("pinned-boundary", index, "pinned") };
      }
    } else {
      unpinnedWorkspaces.add(shape.workspaceId);
    }

    if (windowIdentity === null) {
      windowIdentity = { present: shape.windowPresent, id: shape.windowId };
    } else if (shape.windowPresent !== windowIdentity.present || shape.windowId !== windowIdentity.id) {
      return { ok: false, failure: failure("mixed-window", index, "windowId") };
    }

    const match = matches[index];
    const matched = match.status === "matched" && match.rule !== null;
    const rawUrl = readUrl(tabs[index]);
    entries.push({
      id: shape.id,
      originalIndex: index,
      pinned: shape.pinned,
      active: shape.active,
      windowId: shape.windowId,
      workspaceId: shape.workspaceId,
      workspaceName: shape.workspaceName,
      title: shape.title,
      status: matched ? "matched" : match.status === "rejected" ? "rejected" : "unmatched",
      label: matched ? match.rule.label : null,
      ruleId: matched ? match.rule.id : null,
      ruleIndex: matched ? ruleIndexById.get(match.rule.id) ?? null : null,
      blockKey: matched ? `rule:${match.rule.label}` : null,
      automatic: false,
      sortUrl: typeof rawUrl === "string" ? rawUrl : "",
      reason: match.reason === "malformed-url" || match.reason === "unsupported-url" ? match.reason : null,
    });
  }

  if (groupUnmatched) {
    assignAutoGroups(entries, tabs, rules.length);
  }

  return {
    ok: true,
    windowId: windowIdentity && windowIdentity.present ? windowIdentity.id : null,
    entries,
  };
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Report whether a tab is a member of a Contiguous Block.
 *
 * @param {WorkingTab} entry
 * @returns {entry is WorkingTab & { label: string, ruleId: string, ruleIndex: number }}
 */
function isBlockMember(entry) {
  return entry.status === "matched"
    && entry.blockKey !== null
    && entry.label !== null
    && entry.ruleId !== null
    && entry.ruleIndex !== null;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * A user rule block. An automatic group is not one, so an unmatched tab
 * still keeps an automatic group where it is.
 *
 * @param {{ type: string, members?: WorkingTab[] }} atom
 * @returns {boolean}
 */
function isUserRuleBlock(atom) {
  return atom.type === "block" && atom.members[0] && atom.members[0].automatic !== true;
}

/**
 * @param {{ type: string, entry?: WorkingTab }} atom
 * @returns {boolean}
 */
function isPlainUnmatched(atom) {
  return Boolean(atom && atom.type === "fixed" && atom.entry && atom.entry.status !== "rejected");
}

/**
 * The next user-rule block when only unmatched tabs sit between `index`
 * and that block. A rejected tab or an automatic group stops the search.
 *
 * @param {Array<{ type: string, entry?: WorkingTab, members?: WorkingTab[] }>} atoms
 * @param {number} index
 * @returns {number}
 */
function nextUserRuleAcrossUnmatched(atoms, index) {
  let look = index;
  if (!isPlainUnmatched(atoms[look])) {
    return -1;
  }
  while (look < atoms.length && isPlainUnmatched(atoms[look])) {
    look += 1;
  }
  if (look < atoms.length && isUserRuleBlock(atoms[look])) {
    return look;
  }
  return -1;
}

/**
 * Close a gap of unmatched tabs between user-rule blocks that are already
 * in rule order. The unmatched tabs then follow that run. A later rule is
 * not pulled forward across the gap, a rejected tab still splits the run,
 * and an automatic group is not pulled across an unmatched tab.
 * Blocks that already touch are left for the rule-order sort.
 *
 * @param {Array<{ type: string, entry?: WorkingTab, members?: WorkingTab[], ruleIndex?: number }>} atoms
 * @returns {typeof atoms}
 */
function packUserRuleRuns(atoms) {
  /** @type {typeof atoms} */
  const packed = [];
  let cursor = 0;
  while (cursor < atoms.length) {
    if (!isUserRuleBlock(atoms[cursor])) {
      packed.push(atoms[cursor]);
      cursor += 1;
      continue;
    }
    /** @type {typeof atoms} */
    const blocks = [];
    /** @type {typeof atoms} */
    const carried = [];
    while (cursor < atoms.length) {
      if (isUserRuleBlock(atoms[cursor])) {
        blocks.push(atoms[cursor]);
        cursor += 1;
        continue;
      }
      const next = nextUserRuleAcrossUnmatched(atoms, cursor);
      const last = blocks[blocks.length - 1];
      if (next !== -1 && last && atoms[next].ruleIndex >= last.ruleIndex) {
        while (cursor < next) {
          carried.push(atoms[cursor]);
          cursor += 1;
        }
        continue;
      }
      break;
    }
    packed.push(...blocks, ...carried);
  }
  return packed;
}

/**
 * Sort key for a title. A leading count in brackets, such as "(7) " or
 * "(12) ", is ignored. Repeated counts are ignored too. The stored title
 * is not changed. Null means there is no title to sort on.
 *
 * @param {string | null} title
 * @returns {string | null}
 */
function titleSortKey(title) {
  if (typeof title !== "string") {
    return null;
  }
  let value = title.replace(/^\s+/, "");
  if (value.trim() === "") {
    return null;
  }
  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/^\(\d+\)\s+/, "");
  }
  value = value.trim();
  if (value === "") {
    return null;
  }
  return value;
}

/**
 * Compare two single tabs. The title key wins, or the URL when there is
 * no title. An equal key uses the URL, then the original position.
 *
 * @param {WorkingTab} left
 * @param {WorkingTab} right
 * @returns {number}
 */
function compareSingles(left, right) {
  const leftKey = titleSortKey(left.title) ?? left.sortUrl;
  const rightKey = titleSortKey(right.title) ?? right.sortUrl;
  const byKey = textOrder.compare(leftKey, rightKey);
  if (byKey !== 0) {
    return byKey;
  }
  const byUrl = textOrder.compare(left.sortUrl, right.sortUrl);
  if (byUrl !== 0) {
    return byUrl;
  }
  return left.originalIndex - right.originalIndex;
}

/**
 * @param {WorkingTab[]} members
 * @returns {number}
 */
function earliestRuleIndex(members) {
  let ruleIndex = members[0].ruleIndex ?? 0;
  for (const member of members) {
    if (member.ruleIndex !== null && member.ruleIndex < ruleIndex) {
      ruleIndex = member.ruleIndex;
    }
  }
  return ruleIndex;
}

/**
 * D24 layout for one workspace and pin category. User-rule groups come
 * first, in rule order. Automatic groups follow, from A to Z by their key.
 * Single unmatched tabs are sorted by title. Rejected tabs keep their
 * original relative order after that tail.
 *
 * @param {WorkingTab[]} entries
 * @returns {{ arranged: WorkingTab[], blocks: Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">> }}
 */
function arrangeOrderedWorkspace(entries) {
  /** @type {Array<{ ruleIndex: number, members: WorkingTab[], key: string, anchorOriginal: number, anchorUrl: string }>} */
  const userBlocks = [];
  /** @type {Array<{ ruleIndex: number, members: WorkingTab[], key: string, anchorOriginal: number, anchorUrl: string }>} */
  const autoBlocks = [];
  /** @type {WorkingTab[]} */
  const singles = [];
  /** @type {WorkingTab[]} */
  const rejected = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const entry of entries) {
    if (entry.status === "rejected") {
      rejected.push(entry);
      continue;
    }
    if (!isBlockMember(entry)) {
      singles.push(entry);
      continue;
    }
    if (seen.has(entry.blockKey)) {
      continue;
    }
    seen.add(entry.blockKey);
    const members = entries.filter((candidate) => candidate.blockKey === entry.blockKey && isBlockMember(candidate));
    const block = {
      ruleIndex: earliestRuleIndex(members),
      members,
      key: entry.label ?? "",
      anchorOriginal: members[0].originalIndex,
      anchorUrl: members[0].sortUrl,
    };
    if (entry.automatic === true) {
      autoBlocks.push(block);
    } else {
      userBlocks.push(block);
    }
  }

  userBlocks.sort((left, right) => {
    if (left.ruleIndex !== right.ruleIndex) {
      return left.ruleIndex - right.ruleIndex;
    }
    return left.anchorOriginal - right.anchorOriginal;
  });
  autoBlocks.sort((left, right) => {
    const byKey = textOrder.compare(left.key, right.key);
    if (byKey !== 0) {
      return byKey;
    }
    if (left.anchorOriginal !== right.anchorOriginal) {
      return left.anchorOriginal - right.anchorOriginal;
    }
    return textOrder.compare(left.anchorUrl, right.anchorUrl);
  });
  if (autoBlocks.length > 0) {
    const autoBase = Math.min(...autoBlocks.map((block) => block.ruleIndex));
    autoBlocks.forEach((block, index) => {
      block.ruleIndex = autoBase + index;
      for (const member of block.members) {
        member.ruleIndex = block.ruleIndex;
      }
    });
  }
  singles.sort(compareSingles);

  /** @type {WorkingTab[]} */
  const arranged = [];
  /** @type {Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">>} */
  const blocks = [];
  for (const atom of [...userBlocks, ...autoBlocks]) {
    const anchor = atom.members[0];
    if (!anchor || !isBlockMember(anchor)) {
      continue;
    }
    blocks.push({
      label: anchor.label,
      ruleId: anchor.ruleId,
      ruleIndex: atom.ruleIndex,
      workspaceId: anchor.workspaceId,
      workspaceName: anchor.workspaceName,
      pinned: anchor.pinned,
      anchorTabId: anchor.id,
      tabIds: atom.members.map((member) => member.id),
      automatic: anchor.automatic === true,
    });
    for (const member of atom.members) {
      arranged.push(member);
    }
  }
  for (const entry of singles) {
    arranged.push(entry);
  }
  for (const entry of rejected) {
    arranged.push(entry);
  }
  return { arranged, blocks };
}

/**
 * Order one workspace's tabs when automatic ordering is off. User-rule
 * blocks that are already in rule order are packed together, and the
 * unmatched tabs that sat between them follow the run. A later rule is
 * not pulled forward across that gap. Members keep their original relative
 * order behind the earliest tab. A rejected tab still splits the run, and
 * an automatic group is not pulled across an unmatched tab.
 *
 * @param {WorkingTab[]} entries
 * @returns {{ arranged: WorkingTab[], blocks: Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">> }}
 */
function arrangeLooseWorkspace(entries) {
  /** @type {Map<string, WorkingTab[]>} */
  const membersByBlock = new Map();
  for (const entry of entries) {
    if (!isBlockMember(entry)) {
      continue;
    }
    const members = membersByBlock.get(entry.blockKey) ?? [];
    members.push(entry);
    membersByBlock.set(entry.blockKey, members);
  }

  /** @type {Array<{ type: "fixed", entry: WorkingTab } | { type: "block", ruleIndex: number, members: WorkingTab[] }>} */
  const atoms = [];
  /** @type {Set<string>} */
  const seenBlocks = new Set();
  for (const entry of entries) {
    if (!isBlockMember(entry)) {
      atoms.push({ type: "fixed", entry });
      continue;
    }
    if (seenBlocks.has(entry.blockKey)) {
      continue;
    }
    seenBlocks.add(entry.blockKey);
    const members = membersByBlock.get(entry.blockKey) ?? [];
    let ruleIndex = entry.ruleIndex;
    for (const member of members) {
      if (member.ruleIndex !== null && member.ruleIndex < ruleIndex) {
        ruleIndex = member.ruleIndex;
      }
    }
    atoms.push({ type: "block", ruleIndex, members });
  }

  /** @type {typeof atoms} */
  const ordered = [];
  const packed = packUserRuleRuns(atoms);
  let cursor = 0;
  while (cursor < packed.length) {
    if (packed[cursor].type !== "block") {
      ordered.push(packed[cursor]);
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < packed.length && packed[end].type === "block") {
      end += 1;
    }
    const run = packed.slice(cursor, end);
    run.sort((left, right) => left.ruleIndex - right.ruleIndex);
    for (const atom of run) {
      ordered.push(atom);
    }
    cursor = end;
  }

  /** @type {WorkingTab[]} */
  const arranged = [];
  /** @type {Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">>} */
  const blocks = [];
  for (const atom of ordered) {
    if (atom.type === "fixed") {
      arranged.push(atom.entry);
      continue;
    }
    const anchor = atom.members[0];
    if (!anchor || !isBlockMember(anchor)) {
      for (const member of atom.members) {
        arranged.push(member);
      }
      continue;
    }
    blocks.push({
      label: anchor.label,
      ruleId: anchor.ruleId,
      ruleIndex: atom.ruleIndex,
      workspaceId: anchor.workspaceId,
      workspaceName: anchor.workspaceName,
      pinned: anchor.pinned,
      anchorTabId: anchor.id,
      tabIds: atom.members.map((member) => member.id),
      automatic: anchor.automatic === true,
    });
    for (const member of atom.members) {
      arranged.push(member);
    }
  }

  return { arranged, blocks };
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Order one workspace. Automatic ordering uses the D24 layout. The off
 * switch keeps the earlier placement.
 *
 * @param {WorkingTab[]} entries
 * @param {boolean} orderTail
 * @returns {{ arranged: WorkingTab[], blocks: Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">> }}
 */
function arrangeWorkspace(entries, orderTail) {
  if (orderTail) {
    return arrangeOrderedWorkspace(entries);
  }
  return arrangeLooseWorkspace(entries);
}

/**
 * Arrange each workspace inside one pin category and write the results back
 * into that workspace's existing slots.
 *
 * @param {WorkingTab[]} entries
 * @param {boolean} orderTail
 * @returns {{ arranged: WorkingTab[], blocks: Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">> }}
 */
function arrangeCategory(entries, orderTail) {
  /** @type {Map<string | null, WorkingTab[]>} */
  const byWorkspace = new Map();
  for (const entry of entries) {
    const group = byWorkspace.get(entry.workspaceId) ?? [];
    group.push(entry);
    byWorkspace.set(entry.workspaceId, group);
  }

  /** @type {Map<string | null, WorkingTab[]>} */
  const arrangedByWorkspace = new Map();
  /** @type {Array<Omit<ContiguousBlockPlan, "contiguousInWindow" | "interruptions">>} */
  const blocks = [];
  for (const [workspaceId, group] of byWorkspace) {
    const arranged = arrangeWorkspace(group, orderTail);
    arrangedByWorkspace.set(workspaceId, arranged.arranged);
    blocks.push(...arranged.blocks);
  }

  /** @type {Map<string | null, number>} */
  const cursors = new Map();
  const arranged = entries.map((entry) => {
    const group = arrangedByWorkspace.get(entry.workspaceId) ?? [];
    const offset = cursors.get(entry.workspaceId) ?? 0;
    cursors.set(entry.workspaceId, offset + 1);
    return group[offset];
  });
  return { arranged, blocks };
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Describe a tab at one side of a boundary or inside a block interruption.
 *
 * @param {WorkingTab} entry
 * @returns {ArrangementEndpoint}
 */
function endpoint(entry) {
  return {
    tabId: entry.id,
    label: entry.label,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    pinned: entry.pinned,
  };
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Record workspace and pin boundaries that the planned order did not cross.
 *
 * @param {WorkingTab[]} finalEntries
 * @returns {ArrangementBoundary[]}
 */
function buildBoundaries(finalEntries) {
  /** @type {ArrangementBoundary[]} */
  const boundaries = [];
  for (let index = 0; index < finalEntries.length - 1; index += 1) {
    const before = finalEntries[index];
    const after = finalEntries[index + 1];
    if (before.workspaceId !== after.workspaceId) {
      boundaries.push({
        type: "workspace",
        afterIndex: index,
        anchorsKept: true,
        before: endpoint(before),
        after: endpoint(after),
      });
    }
    if (before.pinned !== after.pinned) {
      boundaries.push({
        type: "pin",
        afterIndex: index,
        anchorsKept: true,
        before: endpoint(before),
        after: endpoint(after),
      });
    }
  }
  return boundaries;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * List a separation's anchors in planned window order.
 *
 * @param {ContiguousBlockPlan[]} blocks
 * @param {ReadonlyMap<string | number, number>} plannedIndexById
 * @returns {SeparationAnchor[]}
 */
function orderedAnchors(blocks, plannedIndexById) {
  return [...blocks]
    .sort((left, right) => {
      return (plannedIndexById.get(left.anchorTabId) ?? 0) - (plannedIndexById.get(right.anchorTabId) ?? 0);
    })
    .map((block) => ({
      tabId: block.anchorTabId,
      ruleId: block.ruleId,
      workspaceId: block.workspaceId,
      workspaceName: block.workspaceName,
      pinned: block.pinned,
    }));
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Record labels whose anchors stay split by a workspace or by pin category.
 *
 * @param {ContiguousBlockPlan[]} blocks
 * @param {ReadonlyMap<string | number, number>} plannedIndexById
 * @returns {ArrangementSeparation[]}
 */
function buildSeparations(blocks, plannedIndexById) {
  /** @type {Map<string, ContiguousBlockPlan[]>} */
  const byLabel = new Map();
  for (const block of blocks) {
    const group = byLabel.get(block.label) ?? [];
    group.push(block);
    byLabel.set(block.label, group);
  }

  /** @type {ArrangementSeparation[]} */
  const separations = [];
  const labels = [...byLabel.keys()].sort();
  for (const label of labels) {
    const group = byLabel.get(label) ?? [];
    /** @type {Map<string, ContiguousBlockPlan[]>} */
    const byPin = new Map();
    for (const block of group) {
      const pinKey = block.pinned ? "pinned" : "unpinned";
      const pinGroup = byPin.get(pinKey) ?? [];
      pinGroup.push(block);
      byPin.set(pinKey, pinGroup);
    }
    for (const pinGroup of byPin.values()) {
      /** @type {Set<string | null>} */
      const workspaces = new Set(pinGroup.map((block) => block.workspaceId));
      if (workspaces.size < 2) {
        continue;
      }
      separations.push({
        type: "workspace",
        label,
        pinned: pinGroup[0].pinned,
        anchors: orderedAnchors(pinGroup, plannedIndexById),
      });
    }
    if (byPin.has("pinned") && byPin.has("unpinned")) {
      separations.push({
        type: "pin",
        label,
        pinned: null,
        anchors: orderedAnchors(group, plannedIndexById),
      });
    }
  }
  separations.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "pin" ? -1 : 1;
    }
    if (left.label !== right.label) {
      return left.label < right.label ? -1 : 1;
    }
    return Number(left.pinned === true) - Number(right.pinned === true);
  });
  return separations;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * List the active tab in each workspace, in the order those tabs appear.
 * A workspace with no active tab is omitted. Callers have already rejected
 * a second active tab in the same workspace.
 *
 * @param {readonly WorkingTab[]} entries
 * @returns {ActiveTabRecord[]}
 */
function activeTabRecords(entries) {
  /** @type {Set<string | null>} */
  const seen = new Set();
  /** @type {ActiveTabRecord[]} */
  const records = [];
  for (const entry of entries) {
    if (!entry.active || seen.has(entry.workspaceId)) {
      continue;
    }
    seen.add(entry.workspaceId);
    records.push({ workspaceId: entry.workspaceId, tabId: entry.id });
  }
  return records;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Plan Contiguous Blocks for one current window without moving any tab.
 * Invalid rules and invalid window inputs are rejected without throwing,
 * except when `tabs` itself is not an array.
 *
 * @param {unknown} tabs Tabs in current window order.
 * @param {unknown} rules Organiser Rules in displayed order.
 * @param {{ groupUnmatchedTabs?: unknown }} [options] D12. Omitted or any value other than false leaves the default rule on.
 * @returns {ArrangementPlan | ArrangementFailure}
 */
export function planArrangement(tabs, rules, options = {}) {
  if (!Array.isArray(tabs)) {
    throw new TypeError("tabs must be an array");
  }

  const validated = validateRules(rules);
  if (!validated.ok) {
    return failure(
      "invalid-rules",
      null,
      "rules",
      validated.errors.map((error) => ({
        index: error.index,
        field: error.field,
        code: error.code,
      })),
    );
  }

  const groupUnmatched = groupUnmatchedEnabled(options && options.groupUnmatchedTabs);
  const prepared = prepareEntries(tabs, validated.rules, groupUnmatched);
  if (!prepared.ok) {
    return prepared.failure;
  }

  const pinnedPlan = arrangeCategory(prepared.entries.filter((entry) => entry.pinned), groupUnmatched);
  const unpinnedPlan = arrangeCategory(prepared.entries.filter((entry) => !entry.pinned), groupUnmatched);
  let pinnedCursor = 0;
  let unpinnedCursor = 0;
  const finalEntries = prepared.entries.map((entry) => {
    if (entry.pinned) {
      const placed = pinnedPlan.arranged[pinnedCursor];
      pinnedCursor += 1;
      return placed;
    }
    const placed = unpinnedPlan.arranged[unpinnedCursor];
    unpinnedCursor += 1;
    return placed;
  });

  /** @type {Map<string | number, number>} */
  const plannedIndexById = new Map(finalEntries.map((entry, plannedIndex) => [entry.id, plannedIndex]));
  /** @type {Set<string | number>} */
  const anchorIds = new Set();
  /** @type {ContiguousBlockPlan[]} */
  const blocks = [];

  for (const draft of [...pinnedPlan.blocks, ...unpinnedPlan.blocks]) {
    anchorIds.add(draft.anchorTabId);
    const indexes = draft.tabIds.map((tabId) => plannedIndexById.get(tabId) ?? 0);
    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    /** @type {Set<string | number>} */
    const memberIds = new Set(draft.tabIds);
    /** @type {ArrangementEndpoint[]} */
    const interruptions = [];
    for (let index = start; index <= end; index += 1) {
      const entry = finalEntries[index];
      if (!memberIds.has(entry.id)) {
        interruptions.push(endpoint(entry));
      }
    }
    blocks.push({
      label: draft.label,
      ruleId: draft.ruleId,
      ruleIndex: draft.ruleIndex,
      workspaceId: draft.workspaceId,
      workspaceName: draft.workspaceName,
      pinned: draft.pinned,
      anchorTabId: draft.anchorTabId,
      tabIds: draft.tabIds,
      automatic: draft.automatic === true,
      contiguousInWindow: interruptions.length === 0,
      interruptions,
    });
  }

  blocks.sort((left, right) => {
    return (plannedIndexById.get(left.anchorTabId) ?? 0) - (plannedIndexById.get(right.anchorTabId) ?? 0);
  });

  /** @type {ArrangementTab[]} */
  const publicTabs = prepared.entries.map((entry) => {
    const selected = entry.status === "matched";
    /** @type {ArrangementTab["role"]} */
    let role = "unmatched";
    if (entry.status === "rejected") {
      role = "rejected";
    } else if (selected && anchorIds.has(entry.id)) {
      role = "anchor";
    } else if (selected) {
      role = "member";
    }
    return {
      id: entry.id,
      originalIndex: entry.originalIndex,
      plannedIndex: plannedIndexById.get(entry.id) ?? entry.originalIndex,
      pinned: entry.pinned,
      active: entry.active,
      windowId: entry.windowId,
      workspaceId: entry.workspaceId,
      workspaceName: entry.workspaceName,
      title: entry.title,
      selected,
      role,
      label: entry.label,
      ruleId: entry.ruleId,
      automatic: entry.automatic === true,
      reason: entry.reason,
    };
  });

  /** @type {ArrangementMove[]} */
  const moves = [];
  for (const tab of publicTabs) {
    if (!tab.selected || tab.plannedIndex === tab.originalIndex || tab.label === null) {
      continue;
    }
    const block = blocks.find((candidate) => candidate.tabIds.includes(tab.id));
    moves.push({
      tabId: tab.id,
      fromIndex: tab.originalIndex,
      toIndex: tab.plannedIndex,
      label: tab.label,
      anchorTabId: block ? block.anchorTabId : tab.id,
      workspaceId: tab.workspaceId,
      pinned: tab.pinned,
    });
  }

  return deepFreeze({
    ok: true,
    windowId: prepared.windowId,
    activeTabIds: activeTabRecords(prepared.entries),
    tabCount: publicTabs.length,
    order: finalEntries.map((entry) => entry.id),
    tabs: publicTabs,
    blocks,
    moves,
    boundaries: buildBoundaries(finalEntries),
    separations: buildSeparations(blocks, plannedIndexById),
  });
}
