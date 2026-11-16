import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDisplayedPreview } from "../extension/apply.js";
import {
  buildApplyReport,
  planApplyMoves,
  previewFingerprint,
  sameFingerprint,
} from "../extension/apply-plan.js";
import { planArrangement } from "../extension/arrangement.js";
import { inspectPreview } from "../extension/preview.js";
import { ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY } from "../extension/rule-store.js";
import { startPopup } from "../extension/popup.js";
import { detectCurrentWorkspace } from "../extension/workspace.js";

const newsRule = { id: "bbc-news", label: "BBC News", hostname: "www.bbc.co.uk", pathPrefix: "/news" };
const bbcRule = { id: "bbc", label: "www.bbc.co.uk", hostname: "www.bbc.co.uk", pathPrefix: "/" };
const wikiRule = { id: "wiki", label: "Wikipedia", hostname: "en.wikipedia.org", pathPrefix: "/" };
const operaRules = [newsRule, bbcRule, wikiRule];

const productRule = { id: "product", label: "Product documentation", hostname: "docs.example.com", pathPrefix: "/product" };
const otherRule = { id: "other", label: "Other documentation", hostname: "docs.example.com", pathPrefix: null };

function workspaceKey(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

function operaTabs() {
  const rows = [
    { index: 6, pinned: true, active: false, workspaceId: "9", workspaceName: "Test A", title: "Opera (web browser) - Wikipedia", url: "https://en.wikipedia.org/wiki/Opera_(web_browser)" },
    { index: 7, pinned: false, active: false, workspaceId: "9", workspaceName: "Test A", title: "BBC Sport - Scores, Fixtures, News - Live Sport", url: "https://www.bbc.co.uk/sport" },
    { index: 8, pinned: false, active: true, workspaceId: "9", workspaceName: "Test A", title: "Example Domain", url: "https://example.com/" },
    { index: 9, pinned: false, active: false, workspaceId: "9", workspaceName: "Test A", title: "Home - BBC News", url: "https://www.bbc.co.uk/news" },
    { index: 10, pinned: false, active: false, workspaceId: "9", workspaceName: "Test A", title: "London - Wikipedia", url: "https://en.wikipedia.org/wiki/London" },
    { index: 11, pinned: false, active: false, workspaceId: "9", workspaceName: "Test A", title: "Technology | Latest News & Updates | BBC News", url: "https://www.bbc.co.uk/news/technology" },
    { index: 12, pinned: false, active: false, workspaceId: "9", workspaceName: "Test A", title: "Extensions", url: "opera://extensions" },
    { index: 0, pinned: false, active: true, workspaceId: "0", workspaceName: "Workspace 1", title: "Extensions", url: "opera://extensions" },
    { index: 1, pinned: false, active: true, workspaceId: "1", workspaceName: "Gameday", title: "Speed Dial", url: "opera://startpage" },
    { index: 2, pinned: false, active: true, workspaceId: "2", workspaceName: "Spicy Mango", title: "Speed Dial", url: "opera://startpage" },
    { index: 3, pinned: false, active: true, workspaceId: "6", workspaceName: "Atlassian", title: "Speed Dial", url: "opera://startpage" },
    { index: 4, pinned: false, active: true, workspaceId: "5", workspaceName: "Lucid", title: "Speed Dial", url: "opera://startpage" },
    { index: 5, pinned: false, active: true, workspaceId: "8", workspaceName: "LinkedIn", title: "Speed Dial", url: "opera://startpage" },
    { index: 13, pinned: false, active: false, workspaceId: "10", workspaceName: "Test B", title: "BBC Weather - Home", url: "https://www.bbc.co.uk/weather" },
    { index: 14, pinned: false, active: false, workspaceId: "10", workspaceName: "Test B", title: "Tab (interface) - Wikipedia", url: "https://en.wikipedia.org/wiki/Tab_(interface)" },
    { index: 15, pinned: false, active: true, workspaceId: "10", workspaceName: "Test B", title: "Example Domain", url: "https://example.org/" },
  ];
  return rows.map((row) => ({ ...row, id: `i${row.index}`, windowId: 1 }));
}

function titlesIn(tabs, workspaceName) {
  return tabs
    .filter((tab) => tab.workspaceName === workspaceName)
    .sort((left, right) => left.index - right.index)
    .map((tab) => tab.title);
}

/**
 * Opera 139 model. `index` on move is workspace-local.
 * -1 and any index past the workspace length append to that workspace.
 * The current local position is a no-op. Other workspaces keep their indexes.
 * Active state does not change unless `update` sets it, or `stealActive` is set.
 *
 * @param {Object[]} initial
 * @param {{ failMoveId?: string | number, onRead?: Function, stealActive?: boolean }} [options]
 */
function createOperaBrowser(initial, options = {}) {
  const tabs = initial.map((tab) => ({ ...tab }));
  const calls = [];
  let reads = 0;

  const reorder = (id, requestedIndex) => {
    const tab = tabs.find((entry) => entry.id === id);
    const key = workspaceKey(tab.workspaceId);
    const peers = tabs.filter((entry) => workspaceKey(entry.workspaceId) === key).sort((left, right) => left.index - right.index);
    const from = peers.findIndex((entry) => entry.id === id);
    let to = requestedIndex;
    if (!Number.isInteger(to) || to < 0 || to >= peers.length) {
      to = peers.length - 1;
    }
    if (to === from) {
      return;
    }
    const next = peers.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    const slots = peers.map((entry) => entry.index).sort((left, right) => left - right);
    next.forEach((entry, index) => {
      entry.index = slots[index];
    });
    if (options.stealActive) {
      for (const peer of peers) {
        peer.active = peer.id === id;
      }
    }
  };

  const api = {
    query(_queryInfo, callback) {
      reads += 1;
      calls.push({ method: "query", queryInfo: _queryInfo });
      if (options.onRead) {
        options.onRead(reads, tabs, _queryInfo);
      }
      let copy = tabs.map((tab) => ({ ...tab }));
      if (_queryInfo && _queryInfo.active === true) {
        copy = copy.filter((tab) => tab.active === true);
      }
      if (typeof callback === "function") {
        callback(copy);
      }
      return Promise.resolve(copy);
    },
    move(tabId, props, callback) {
      calls.push({
        method: "move",
        tabId,
        props: { ...props },
        asArray: Array.isArray(tabId),
      });
      if (options.failMoveId !== undefined && tabId === options.failMoveId) {
        return Promise.reject(new Error("https://secret.example/move-failed"));
      }
      if (!Array.isArray(tabId)) {
        reorder(tabId, props.index);
      }
      if (typeof callback === "function") {
        callback({});
      }
      return Promise.resolve({});
    },
    update(tabId, props, callback) {
      calls.push({ method: "update", tabId, props: { ...props } });
      const tab = tabs.find((entry) => entry.id === tabId);
      if (tab && props && props.active === true) {
        for (const other of tabs) {
          if (workspaceKey(other.workspaceId) === workspaceKey(tab.workspaceId)) {
            other.active = other.id === tabId;
          }
        }
      }
      if (typeof callback === "function") {
        callback({});
      }
      return Promise.resolve({});
    },
  };

  return { tabs, calls, browser: { tabs: api, runtime: {} } };
}

function noUrl(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes("http://"), false);
  assert.equal(text.includes("https://"), false);
  assert.equal(text.includes("opera:"), false);
  assert.equal(text.includes("secret"), false);
}

test("the fingerprint tracks target order, pinned state and active tabs", () => {
  const plan = planArrangement(operaTabs(), operaRules);
  const first = previewFingerprint(plan);
  const second = previewFingerprint(planArrangement(operaTabs(), operaRules));
  assert.equal(sameFingerprint(first, second), true);

  const changed = operaTabs().filter((tab) => tab.id !== "i11");
  const replanned = planArrangement(changed, operaRules);
  assert.equal(replanned.ok, true);
  assert.equal(sameFingerprint(first, previewFingerprint(replanned)), false);

  const flipped = operaTabs();
  flipped.find((tab) => tab.id === "i8").active = false;
  flipped.find((tab) => tab.id === "i7").active = true;
  const activeChanged = planArrangement(flipped, operaRules);
  assert.equal(sameFingerprint(first, previewFingerprint(activeChanged)), false);

  const extraPin = operaTabs();
  extraPin.find((tab) => tab.id === "i7").pinned = true;
  const pinChanged = planArrangement(extraPin, operaRules);
  assert.equal(pinChanged.ok, true);
  assert.equal(sameFingerprint(first, previewFingerprint(pinChanged)), false);
});

test("Test A suffix moves use workspace-local -1 and leave Test B alone", () => {
  const plan = planArrangement(operaTabs(), operaRules);
  const sequence = planApplyMoves(plan);
  const testA = sequence.workspaces.find((workspace) => workspace.workspaceId === "9");
  const unpinned = testA.categories.find((category) => category.pinned === false);
  const pinned = testA.categories.find((category) => category.pinned === true);
  assert.equal(pinned.changed, false);
  assert.deepEqual(unpinned.moves.map((move) => [move.tabId, move.index]), [
    ["i9", -1],
    ["i11", -1],
    ["i7", -1],
    ["i10", -1],
    ["i8", -1],
    ["i12", -1],
  ]);
  const testB = sequence.workspaces.find((workspace) => workspace.workspaceId === "10");
  assert.equal(testB.categories.every((category) => category.moves.length === 0 && category.failures.length === 0), true);
});

test("Opera local moves put Test A into the planned order and do not use window indexes", async () => {
  const tabs = operaTabs();
  const inspected = inspectPreview(tabs, operaRules);
  const fake = createOperaBrowser(tabs);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, operaRules);
  assert.equal(result.status, "applied");
  assert.equal(result.report.ok, true);
  assert.equal(result.report.failed, 0);
  assert.equal(result.report.moved, 4);
  assert.equal(result.report.unmatched, 2);
  assert.deepEqual(titlesIn(fake.tabs, "Test A"), [
    "Opera (web browser) - Wikipedia",
    "Home - BBC News",
    "Technology | Latest News & Updates | BBC News",
    "BBC Sport - Scores, Fixtures, News - Live Sport",
    "London - Wikipedia",
    "Example Domain",
    "Extensions",
  ]);
  assert.deepEqual(titlesIn(fake.tabs, "Test B"), [
    "BBC Weather - Home",
    "Tab (interface) - Wikipedia",
    "Example Domain",
  ]);
  assert.deepEqual(titlesIn(fake.tabs, "Workspace 1"), ["Extensions"]);
  const moves = fake.calls.filter((call) => call.method === "move");
  assert.deepEqual(moves.map((call) => call.tabId), ["i9", "i11", "i7", "i10", "i8", "i12"]);
  for (const call of moves) {
    assert.equal(call.asArray, false);
    assert.deepEqual(call.props, { index: -1 });
  }
  assert.equal(fake.calls.some((call) => call.method === "update"), false);
  assert.equal(fake.tabs.find((tab) => tab.id === "i8").active, true);
  noUrl(result.report);
  assert.match(result.report.message, /Moved 4 tabs/);
});

test("Apply groups unmatched tabs and leaves a singleton after the automatic group", async () => {
  const tabs = [
    { id: "sport", index: 0, pinned: false, active: true, windowId: 1, workspaceId: "9", workspaceName: "Test A", title: "BBC Sport", url: "https://www.bbc.co.uk/sport" },
    { id: "wiki", index: 1, pinned: false, active: false, windowId: 1, workspaceId: "9", workspaceName: "Test A", title: "London - Wikipedia", url: "https://en.wikipedia.org/wiki/London" },
    { id: "football", index: 2, pinned: false, active: false, windowId: 1, workspaceId: "9", workspaceName: "Test A", title: "Football", url: "https://www.bbc.co.uk/sport/football" },
    { id: "lone", index: 3, pinned: false, active: false, windowId: 1, workspaceId: "9", workspaceName: "Test A", title: "Example Domain", url: "https://example.com/" },
  ];
  const inspected = inspectPreview(tabs, []);
  assert.equal(inspected.preview.status, "ready");
  assert.equal(inspected.preview.blocks[0].kind, "automatic");
  assert.equal(inspected.preview.blocks[0].label, "www.bbc.co.uk/sport");
  assert.deepEqual(inspected.preview.blocks[0].titles, ["BBC Sport", "Football"]);
  assert.deepEqual(inspected.preview.unmatched.map((entry) => entry.title), ["Example Domain", "London - Wikipedia"]);

  const fake = createOperaBrowser(tabs);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, []);
  assert.equal(result.status, "applied");
  assert.equal(result.report.ok, true);
  assert.equal(result.report.failed, 0);
  assert.equal(result.report.unmatched, 2);
  assert.deepEqual(titlesIn(fake.tabs, "Test A"), [
    "BBC Sport",
    "Football",
    "Example Domain",
    "London - Wikipedia",
  ]);
  assert.equal(fake.calls.filter((call) => call.method === "move").every((call) => call.props.index === -1), true);
  noUrl(result.report);

  const off = inspectPreview(tabs, [], { groupUnmatchedTabs: false });
  assert.equal(off.preview.status, "no-rules");
  assert.equal(off.changeCount, 0);
  assert.equal(off.fingerprint, null);
});

test("a changed window applies nothing and keeps the previous tabs", async () => {
  const tabs = operaTabs();
  const inspected = inspectPreview(tabs, operaRules);
  let swapped = false;
  const fake = createOperaBrowser(tabs, {
    onRead(_read, live, queryInfo) {
      if (queryInfo && queryInfo.active === true) {
        return;
      }
      if (swapped) {
        return;
      }
      swapped = true;
      const example = live.find((tab) => tab.id === "i8");
      example.url = "https://www.bbc.co.uk/news/changed";
      example.title = "Changed - BBC News";
    },
  });
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, operaRules);
  assert.equal(result.status, "stale");
  assert.equal(result.report, null);
  assert.equal(fake.calls.some((call) => call.method === "move" || call.method === "update"), false);
  assert.equal(result.preview.status, "ready");
  assert.equal(result.changeCount > 0, true);
});

test("a no-op plan issues no moves", async () => {
  const tabs = operaTabs();
  const plannedIndexes = { i9: 7, i11: 8, i7: 9, i10: 10, i8: 11, i12: 12 };
  for (const entry of tabs) {
    if (Object.hasOwn(plannedIndexes, entry.id)) {
      entry.index = plannedIndexes[entry.id];
    }
  }
  const ordered = tabs.slice().sort((left, right) => left.index - right.index);
  const inspected = inspectPreview(ordered, operaRules);
  assert.equal(inspected.changeCount, 0);
  const fake = createOperaBrowser(ordered);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, operaRules);
  assert.equal(result.status, "applied");
  assert.equal(result.report.moved, 0);
  assert.equal(result.report.failed, 0);
  assert.equal(fake.calls.some((call) => call.method === "move"), false);
  assert.match(result.report.message, /Moved 0 tabs/);
});

test("partial failure keeps earlier workspace moves and does not claim success", async () => {
  const tabs = [
    { id: "a", index: 4, pinned: false, active: true, windowId: 1, workspaceId: "ws-a", workspaceName: "Alpha", title: "Other first", url: "https://docs.example.com/guide" },
    { id: "b", index: 5, pinned: false, active: false, windowId: 1, workspaceId: "ws-a", workspaceName: "Alpha", title: "Product first", url: "https://docs.example.com/product" },
    { id: "c", index: 6, pinned: false, active: false, windowId: 1, workspaceId: "ws-a", workspaceName: "Alpha", title: "Notes", url: "https://other.example/notes" },
    { id: "d", index: 10, pinned: false, active: true, windowId: 1, workspaceId: "ws-b", workspaceName: "Beta", title: "Other second", url: "https://docs.example.com/more" },
    { id: "e", index: 11, pinned: false, active: false, windowId: 1, workspaceId: "ws-b", workspaceName: "Beta", title: "Product second", url: "https://docs.example.com/product/more" },
  ];
  const rules = [productRule, otherRule];
  const inspected = inspectPreview(tabs, rules);
  assert.equal(inspected.changeCount > 0, true);
  const fake = createOperaBrowser(tabs, { failMoveId: "e" });
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, rules);
  assert.equal(result.status, "applied");
  assert.equal(result.report.ok, false);
  assert.equal(result.report.failed > 0, true);
  assert.deepEqual(titlesIn(fake.tabs, "Alpha"), ["Product first", "Other first", "Notes"]);
  assert.deepEqual(titlesIn(fake.tabs, "Beta"), ["Other second", "Product second"]);
  assert.equal(result.report.failures.some((failure) => failure.title === "Product second" && failure.workspaceName === "Beta"), true);
  noUrl(result.report);
  assert.equal(JSON.stringify(result.report).includes("rollback"), false);
});

test("a pinned range that would change is skipped and the unpinned range still moves", async () => {
  const tabs = [
    { id: "pin-other", index: 3, pinned: true, active: false, windowId: 1, workspaceId: "ws", workspaceName: "Desk", title: "Pinned other", url: "https://docs.example.com/guide" },
    { id: "pin-product", index: 4, pinned: true, active: true, windowId: 1, workspaceId: "ws", workspaceName: "Desk", title: "Pinned product", url: "https://docs.example.com/product" },
    { id: "other", index: 5, pinned: false, active: false, windowId: 1, workspaceId: "ws", workspaceName: "Desk", title: "Loose other", url: "https://docs.example.com/notes" },
    { id: "product", index: 6, pinned: false, active: false, windowId: 1, workspaceId: "ws", workspaceName: "Desk", title: "Loose product", url: "https://docs.example.com/product/guide" },
  ];
  const rules = [productRule, otherRule];
  const plan = planArrangement(tabs, rules);
  assert.equal(plan.ok, true);
  const sequence = planApplyMoves(plan);
  const pinned = sequence.workspaces[0].categories.find((category) => category.pinned === true);
  assert.equal(pinned.supported, false);
  assert.equal(pinned.moves.length, 0);
  assert.equal(pinned.failures.length > 0, true);

  const fake = createOperaBrowser(tabs);
  const result = await applyDisplayedPreview(fake.browser, previewFingerprint(plan), rules);
  assert.equal(result.report.ok, false);
  assert.deepEqual(
    fake.tabs.filter((tab) => tab.pinned).sort((left, right) => left.index - right.index).map((tab) => tab.id),
    ["pin-other", "pin-product"],
  );
  assert.deepEqual(
    fake.tabs.filter((tab) => !tab.pinned).sort((left, right) => left.index - right.index).map((tab) => tab.id),
    ["product", "other"],
  );
  assert.equal(fake.calls.some((call) => call.method === "move" && String(call.tabId).startsWith("pin-")), false);
  assert.equal(result.report.failures.some((failure) => failure.title === "Pinned product"), true);
  noUrl(result.report);
});

test("an active tab stolen by a move is restored and a window-wide index is never sent", async () => {
  const tabs = operaTabs();
  const inspected = inspectPreview(tabs, operaRules);
  const fake = createOperaBrowser(tabs, { stealActive: true });
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, operaRules);
  assert.equal(result.report.ok, true);
  const updates = fake.calls.filter((call) => call.method === "update");
  assert.deepEqual(updates.map((call) => call.tabId), ["i8"]);
  assert.deepEqual(updates[0].props, { active: true });
  assert.equal(fake.tabs.find((tab) => tab.id === "i8").active, true);
  assert.equal(fake.calls.some((call) => call.method === "move" && call.props.index !== -1), false);
});

test("report wording uses numerals and lists a failure by title and workspace", () => {
  const report = buildApplyReport({
    moved: 1,
    unchanged: 1,
    unmatched: 2,
    failed: 1,
    failures: [{ title: "Pinned product", workspaceName: "Desk", detail: "Pinned reordering is not supported, so this tab was left in place." }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.message, "Moved 1 tab. 1 tab was already in place. 2 tabs did not match a rule. 1 tab failed.");
  assert.equal(report.failures[0].title, "Pinned product");
  noUrl(report);
});

function makeElement(tag) {
  return {
    tag,
    id: "",
    className: "",
    type: "",
    textContent: "",
    href: "",
    hidden: false,
    disabled: false,
    children: [],
    parent: null,
    listeners: {},
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    },
    replaceChildren() {
      this.children = [];
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
  };
}

function findById(node, id) {
  if (node.id === id) {
    return node;
  }
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function createPopupDocument() {
  const root = makeElement("main");
  const document = {
    getElementById(id) {
      return findById(root, id);
    },
    createElement(tag) {
      return makeElement(tag);
    },
  };
  for (const [id, tag] of [
    ["heading", "h1"],
    ["scope-note", "p"],
    ["status", "p"],
    ["blocks", "section"],
    ["unmatched", "section"],
    ["unavailable", "section"],
    ["report", "section"],
    ["apply-reason", "p"],
    ["apply", "button"],
    ["cancel", "button"],
    ["name", "span"],
    ["version", "span"],
  ]) {
    const element = makeElement(tag);
    element.id = id;
    root.append(element);
  }
  const options = makeElement("a");
  options.id = "options";
  root.append(options);
  document.getElementById("apply").disabled = true;
  return document;
}

function pageText(document) {
  const collect = (node) => {
    const values = [node.textContent];
    for (const child of node.children) {
      values.push(...collect(child));
    }
    return values;
  };
  return ["status", "blocks", "unmatched", "unavailable", "report"].map((id) => collect(document.getElementById(id)).join("\n")).join("\n");
}

async function click(element) {
  for (const listener of element.listeners.click || []) {
    await listener({ preventDefault() {} });
  }
}

test("the popup enables Apply only when the preview would move a tab, then reports the result", async () => {
  const tabs = operaTabs();
  const fake = createOperaBrowser(tabs);
  const document = createPopupDocument();
  const area = {
    get(key, callback) {
      callback({ [key]: operaRules });
    },
    set(_items, callback) {
      callback();
    },
  };
  await startPopup({
    document,
    window: { close() {}, location: { assign() {} } },
    browser: fake.browser,
    local: area,
    manifest: {
      name: "Workspace Tab Organiser",
      version: "0.4.0",
      manifest_version: 2,
      description: "Preview and apply a local arrangement of this window.",
    },
  });
  assert.equal(document.getElementById("apply").disabled, false);
  assert.equal(fake.calls.filter((call) => call.method === "move").length, 0);
  await click(document.getElementById("apply"));
  assert.match(document.getElementById("status").textContent, /Moved 4 tabs/);
  assert.equal(document.getElementById("apply").disabled, true);
  assert.equal(pageText(document).includes("https://"), false);
  assert.equal(pageText(document).includes("opera:"), false);
  assert.deepEqual(titlesIn(fake.tabs, "Test A").slice(1, 5), [
    "Home - BBC News",
    "Technology | Latest News & Updates | BBC News",
    "BBC Sport - Scores, Fixtures, News - Live Sport",
    "London - Wikipedia",
  ]);
});

test("Apply shows the new preview when the window changed and does not move", async () => {
  const tabs = operaTabs();
  let fullReads = 0;
  const fake = createOperaBrowser(tabs, {
    onRead(_read, live, queryInfo) {
      if (queryInfo && queryInfo.active === true) {
        return;
      }
      fullReads += 1;
      if (fullReads !== 2) {
        return;
      }
      const example = live.find((tab) => tab.id === "i8");
      example.url = "https://www.bbc.co.uk/news/changed";
      example.title = "Changed - BBC News";
    },
  });
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {}, location: { assign() {} } },
    browser: fake.browser,
    local: {
      get(key, callback) {
        assert.equal(key === ORGANISER_RULES_KEY || key === ORGANISER_SETTINGS_KEY, true);
        if (key === ORGANISER_SETTINGS_KEY) {
          callback({});
          return;
        }
        callback({ [key]: operaRules });
      },
      set(_items, callback) {
        callback();
      },
    },
    manifest: {
      name: "Workspace Tab Organiser",
      version: "0.4.0",
      manifest_version: 2,
      description: "Preview and apply a local arrangement of this window.",
    },
  });
  await click(document.getElementById("apply"));
  assert.match(document.getElementById("status").textContent, /nothing was moved/);
  assert.equal(fake.calls.some((call) => call.method === "move"), false);
  assert.equal(document.getElementById("apply").disabled, false);
});

function markCurrent(tabs, workspaceId) {
  return tabs.map((tab) => {
    if (tab.active !== true) {
      return { ...tab };
    }
    return {
      ...tab,
      lastAccessed: tab.workspaceId === workspaceId ? 1794315478421.848 : 1794234711598,
    };
  });
}

function byIndex(tabs) {
  return tabs.slice().sort((left, right) => left.index - right.index);
}

test("Apply moves the current workspace and leaves another workspace that needs a move", async () => {
  const tabs = byIndex(markCurrent(operaTabs(), "9"));
  const weather = tabs.find((tab) => tab.id === "i13");
  const wiki = tabs.find((tab) => tab.id === "i14");
  const swap = weather.index;
  weather.index = wiki.index;
  wiki.index = swap;
  const ordered = byIndex(tabs);
  const scope = detectCurrentWorkspace(ordered.filter((tab) => tab.active === true));
  assert.equal(scope.workspaceName, "Test A");
  const inspected = inspectPreview(ordered, operaRules, { scope });
  const beforeB = titlesIn(ordered, "Test B");
  assert.deepEqual(beforeB, [
    "Tab (interface) - Wikipedia",
    "BBC Weather - Home",
    "Example Domain",
  ]);
  const fake = createOperaBrowser(ordered);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, operaRules);
  assert.equal(result.status, "applied");
  assert.equal(result.report.failed, 0);
  assert.deepEqual(titlesIn(fake.tabs, "Test A"), [
    "Opera (web browser) - Wikipedia",
    "Home - BBC News",
    "Technology | Latest News & Updates | BBC News",
    "BBC Sport - Scores, Fixtures, News - Live Sport",
    "London - Wikipedia",
    "Example Domain",
    "Extensions",
  ]);
  assert.deepEqual(titlesIn(fake.tabs, "Test B"), beforeB);
  const moved = fake.calls.filter((call) => call.method === "move").map((call) => call.tabId);
  assert.equal(moved.includes("i13"), false);
  assert.equal(moved.includes("i14"), false);
  assert.equal(moved.includes("i15"), false);
  assert.equal(moved.length > 0, true);
});

test("D8 ignores a change outside the current workspace and blocks one inside it", async () => {
  const tabs = byIndex(markCurrent(operaTabs(), "9"));
  const scope = detectCurrentWorkspace(tabs.filter((tab) => tab.active === true));
  const inspected = inspectPreview(tabs, operaRules, { scope });
  let swappedOutside = false;
  const outside = createOperaBrowser(tabs, {
    onRead(_read, live, queryInfo) {
      if (queryInfo && queryInfo.active === true) {
        return;
      }
      if (swappedOutside) {
        return;
      }
      swappedOutside = true;
      const weather = live.find((tab) => tab.id === "i13");
      const wiki = live.find((tab) => tab.id === "i14");
      const swap = weather.index;
      weather.index = wiki.index;
      wiki.index = swap;
    },
  });
  const movedOutside = await applyDisplayedPreview(outside.browser, inspected.fingerprint, operaRules);
  assert.equal(movedOutside.status, "applied");
  assert.equal(outside.calls.some((call) => call.method === "move"), true);

  let swappedInside = false;
  const inside = createOperaBrowser(tabs, {
    onRead(_read, live, queryInfo) {
      if (queryInfo && queryInfo.active === true) {
        return;
      }
      if (swappedInside) {
        return;
      }
      swappedInside = true;
      const example = live.find((tab) => tab.id === "i8");
      example.url = "https://www.bbc.co.uk/news/changed";
      example.title = "Changed - BBC News";
    },
  });
  const blocked = await applyDisplayedPreview(inside.browser, inspected.fingerprint, operaRules);
  assert.equal(blocked.status, "stale");
  assert.equal(blocked.report, null);
  assert.equal(inside.calls.some((call) => call.method === "move" || call.method === "update"), false);
  assert.equal(blocked.preview.heading, "Test A");
  assert.equal(JSON.stringify(blocked.preview).includes("BBC Weather"), false);
});

const testBRules = [bbcRule, wikiRule];

/**
 * Other workspaces occupy the lower window indexes. Test B is
 * BBC Weather, Example Domain, Wikipedia. The rules put Wikipedia
 * with BBC, so Example has to move out from between them.
 */
function testBWindow() {
  const rows = [
    { id: "speed", index: 0, workspaceId: "1", workspaceName: "Gameday", title: "Speed Dial", url: "opera://startpage", active: true, lastAccessed: 1794234711598 },
    { id: "news", index: 1, workspaceId: "9", workspaceName: "Test A", title: "Home - BBC News", url: "https://www.bbc.co.uk/news", active: true, lastAccessed: 1794241057999 },
    { id: "weather", index: 2, workspaceId: "10", workspaceName: "Test B", title: "BBC Weather - Home", url: "https://www.bbc.co.uk/weather", active: false },
    { id: "example", index: 3, workspaceId: "10", workspaceName: "Test B", title: "Example Domain", url: "https://example.org/", active: false },
    { id: "wiki", index: 4, workspaceId: "10", workspaceName: "Test B", title: "Tab (interface) - Wikipedia", url: "https://en.wikipedia.org/wiki/Tab_(interface)", active: true, lastAccessed: 1794315478421.848 },
  ];
  return rows.map((row) => ({ pinned: false, windowId: 1, ...row }));
}

test("Test B moves Wikipedia ahead of Example when earlier workspaces share the window", async () => {
  const tabs = testBWindow();
  const scope = detectCurrentWorkspace(tabs.filter((tab) => tab.active === true));
  assert.equal(scope.workspaceId, "10");
  const inspected = inspectPreview(tabs, testBRules, { scope });
  assert.equal(inspected.preview.heading, "Test B");
  assert.deepEqual(inspected.preview.blocks.map((block) => block.titles), [
    ["BBC Weather - Home"],
    ["Tab (interface) - Wikipedia"],
  ]);
  assert.deepEqual(inspected.preview.unmatched, [{ title: "Example Domain" }]);
  assert.equal(inspected.preview.message, "2 tabs to move into 1 group, 1 unmatched");
  assert.equal(inspected.changeCount, 2);
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {}, location: { assign() {} } },
    browser: createOperaBrowser(tabs).browser,
    local: {
      get(key, callback) {
        if (key === ORGANISER_SETTINGS_KEY) {
          callback({});
          return;
        }
        callback({ [key]: testBRules });
      },
      set(_items, callback) {
        callback();
      },
    },
    manifest: {
      name: "Workspace Tab Organiser",
      version: "0.8.0",
      manifest_version: 2,
      description: "Order automatic groups and sort single tabs in the current workspace.",
    },
  });
  assert.equal(document.getElementById("apply").disabled, false);
  assert.equal(document.getElementById("apply-reason").textContent, "");
  assert.equal(document.getElementById("heading").textContent, "Test B");
  assert.deepEqual(
    inspected.plan.order.filter((id) => tabs.find((tab) => tab.id === id).workspaceId === "10"),
    ["weather", "wiki", "example"],
  );
  const wiki = inspected.plan.tabs.find((tab) => tab.id === "wiki");
  const example = inspected.plan.tabs.find((tab) => tab.id === "example");
  assert.equal(wiki.plannedIndex !== wiki.originalIndex, true);
  assert.equal(example.plannedIndex !== example.originalIndex, true);
  assert.equal(wiki.originalIndex > 1, true);

  const beforeOthers = titlesIn(tabs, "Test A").concat(titlesIn(tabs, "Gameday"));
  const fake = createOperaBrowser(tabs);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, testBRules);
  assert.equal(result.status, "applied");
  assert.equal(result.report.failed, 0);
  assert.deepEqual(titlesIn(fake.tabs, "Test B"), [
    "BBC Weather - Home",
    "Tab (interface) - Wikipedia",
    "Example Domain",
  ]);
  assert.deepEqual(titlesIn(fake.tabs, "Test A").concat(titlesIn(fake.tabs, "Gameday")), beforeOthers);
  const moved = fake.calls.filter((call) => call.method === "move").map((call) => call.tabId);
  assert.equal(moved.includes("wiki"), true);
  assert.equal(moved.includes("example"), true);
  assert.equal(moved.includes("news"), false);
  assert.equal(moved.includes("speed"), false);

  const again = await applyDisplayedPreview(fake.browser, result.fingerprint, testBRules);
  assert.equal(again.status, "applied");
  assert.equal(again.report.moved, 0);
  assert.deepEqual(titlesIn(fake.tabs, "Test B"), [
    "BBC Weather - Home",
    "Tab (interface) - Wikipedia",
    "Example Domain",
  ]);
});
