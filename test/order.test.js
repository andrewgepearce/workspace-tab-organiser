import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDisplayedPreview } from "../extension/apply.js";
import { planApplyMoves } from "../extension/apply-plan.js";
import { planArrangement } from "../extension/arrangement.js";
import { startPopup } from "../extension/popup.js";
import { inspectPreview } from "../extension/preview.js";
import { ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY } from "../extension/rule-store.js";
import { detectCurrentWorkspace } from "../extension/workspace.js";

const productRule = {
  id: "product",
  label: "Product documentation",
  hostname: "docs.example.com",
  pathPrefix: "/product",
};
const otherRule = {
  id: "other",
  label: "Other documentation",
  hostname: "docs.example.com",
  pathPrefix: null,
};
const exampleRule = {
  id: "example",
  label: "example.com",
  hostname: "example.com",
  pathPrefix: null,
};

function tab(id, overrides = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    pinned: false,
    active: false,
    windowId: 1,
    workspaceId: "work",
    workspaceName: "Work",
    ...overrides,
  };
}

function plan(tabs, rules = [], options) {
  const result = planArrangement(tabs, rules, options);
  assert.equal(result.ok, true);
  return result;
}

function relocated(result) {
  return result.tabs.filter((entry) => {
    if (entry.plannedIndex === entry.originalIndex) {
      return false;
    }
    return !(entry.pinned && entry.selected !== true);
  });
}

/**
 * Gameday, as Andrew described it: 2 Jira tabs on one key and 6 single tabs.
 * Inbox occupies the earlier window index.
 */
function gamedayWindow() {
  const rows = [
    { id: "inbox", index: 0, workspaceId: "inbox", workspaceName: "Inbox", title: "Inbox home", url: "https://inbox.example/", active: true, lastAccessed: 1 },
    { id: "standings", index: 4, workspaceId: "gameday", workspaceName: "Gameday", title: "(7) Standings", url: "https://example.com/standings", active: true, lastAccessed: 100 },
    { id: "alpha", index: 5, workspaceId: "gameday", workspaceName: "Gameday", title: "Alpha notes", url: "https://notes.example/alpha", active: false },
    { id: "jira-12", index: 6, workspaceId: "gameday", workspaceName: "Gameday", title: "PROJ-12", url: "https://spicymango.atlassian.net/browse/PROJ-12", active: false },
    { id: "home", index: 7, workspaceId: "gameday", workspaceName: "Gameday", title: "(12) Home / X", url: "https://home.example/x", active: false },
    { id: "echo-b", index: 8, workspaceId: "gameday", workspaceName: "Gameday", title: "écho", url: "https://echo.example/b", active: false },
    { id: "echo-a", index: 9, workspaceId: "gameday", workspaceName: "Gameday", title: "Echo", url: "https://echo.example/a", active: false },
    { id: "zeta", index: 10, workspaceId: "gameday", workspaceName: "Gameday", title: "", url: "https://zeta.example/page", active: false },
    { id: "jira-2", index: 11, workspaceId: "gameday", workspaceName: "Gameday", title: "PROJ-2", url: "https://spicymango.atlassian.net/browse/PROJ-2", active: false },
  ];
  return rows.map((row) => ({ pinned: false, windowId: 1, ...row }));
}

const gamedayOrder = ["jira-12", "jira-2", "alpha", "echo-a", "echo-b", "home", "zeta", "standings"];

function gamedayScope(tabs) {
  return detectCurrentWorkspace(tabs.filter((entry) => entry.active === true));
}

test("D24 lays rule groups, then automatic groups A to Z, then single tabs by title", () => {
  const result = plan(
    [
      tab("zebra", { title: "Zebra", url: "https://zebra.example/a" }),
      tab("news-b", { title: "News B", url: "https://example.com/news/b" }),
      tab("product", { title: "Product", url: "https://docs.example.com/product/a" }),
      tab("docs-a", { title: "Docs A", url: "https://example.com/docs/a" }),
      tab("alpha", { title: "Alpha", url: "https://alpha.example/a" }),
      tab("news-a", { title: "News A", url: "https://example.com/news/a" }),
      tab("other", { title: "Other", url: "https://docs.example.com/guide" }),
      tab("docs-b", { title: "Docs B", url: "https://example.com/docs/b" }),
    ],
    [productRule, otherRule],
  );

  assert.deepEqual(result.order, ["product", "other", "docs-a", "docs-b", "news-b", "news-a", "alpha", "zebra"]);
  assert.deepEqual(result.blocks.map((block) => [block.automatic, block.label, block.tabIds]), [
    [false, "Product documentation", ["product"]],
    [false, "Other documentation", ["other"]],
    [true, "example.com/docs", ["docs-a", "docs-b"]],
    [true, "example.com/news", ["news-b", "news-a"]],
  ]);
});

test("automatic groups sort A to Z by the grouping key, not by which group was opened first", () => {
  const result = plan([
    tab("zebra-a", { title: "Zebra one", url: "https://example.com/zebra/a" }),
    tab("zebra-b", { title: "Zebra two", url: "https://example.com/zebra/b" }),
    tab("apple-a", { title: "Apple one", url: "https://example.com/apple/a" }),
    tab("apple-b", { title: "Apple two", url: "https://example.com/apple/b" }),
  ]);

  assert.deepEqual(result.order, ["apple-a", "apple-b", "zebra-a", "zebra-b"]);
  assert.deepEqual(result.blocks.map((block) => block.label), ["example.com/apple", "example.com/zebra"]);

  const encoded = plan([
    tab("school-a", { title: "École one", url: "https://example.com/école/a" }),
    tab("school-b", { title: "École two", url: "https://example.com/école/b" }),
    tab("apple-a", { title: "Apple one", url: "https://example.com/apple/a" }),
    tab("apple-b", { title: "Apple two", url: "https://example.com/apple/b" }),
  ]);
  assert.deepEqual(encoded.blocks.map((block) => block.label), ["example.com/%C3%A9cole", "example.com/apple"]);
  assert.deepEqual(encoded.order, ["school-a", "school-b", "apple-a", "apple-b"]);
});

test("D23 and D25 sort single tabs by title, ignoring a leading bracket count", () => {
  const result = plan([
    tab("zebra", { title: "(12) Zebra", url: "https://z.example/z" }),
    tab("alpha", { title: "(7) Alpha", url: "https://a.example/a" }),
    tab("beta", { title: "Beta", url: "https://b.example/b" }),
    tab("nested", { title: "(7) (2) Middle", url: "https://m.example/m" }),
  ]);

  assert.deepEqual(result.order, ["alpha", "beta", "nested", "zebra"]);
  assert.deepEqual(result.tabs.map((entry) => entry.title), ["(12) Zebra", "(7) Alpha", "Beta", "(7) (2) Middle"]);
  assert.deepEqual(result.blocks, []);
});

test("title sorting ignores case and accents, then breaks a tie with the URL and then the original position", () => {
  const letters = plan([
    tab("banana", { title: "banana", url: "https://b.example/z" }),
    tab("apple", { title: "Apple", url: "https://a.example/a" }),
    tab("echo-b", { title: "écho", url: "https://echo.example/b" }),
    tab("echo-a", { title: "Echo", url: "https://echo.example/a" }),
  ]);
  assert.deepEqual(letters.order, ["apple", "banana", "echo-a", "echo-b"]);

  const urls = plan([
    tab("later-url", { title: "Same", url: "https://b.example/x" }),
    tab("earlier-url", { title: "same", url: "https://a.example/x" }),
  ]);
  assert.deepEqual(urls.order, ["earlier-url", "later-url"]);

  const position = plan([
    tab("first", { title: "Same", url: "https://same.example/a" }),
    tab("second", { title: "Same", url: "https://same.example/a" }),
  ]);
  assert.deepEqual(position.order, ["first", "second"]);
  assert.deepEqual(position.moves, []);
});

test("a missing title sorts by URL", () => {
  const result = plan([
    tab("middle", { title: "Middle", url: "https://m.example/m" }),
    tab("zeta", { title: null, url: "https://z.example/z" }),
    tab("alpha", { title: "  ", url: "https://a.example/a" }),
    tab("count-only", { title: "(7) ", url: "https://b.example/b" }),
  ]);

  assert.deepEqual(result.order, ["alpha", "count-only", "zeta", "middle"]);
});

test("the checkbox off leaves unmatched tabs in their current positions", () => {
  const singles = [
    tab("zebra", { title: "(12) Zebra", url: "https://z.example/z" }),
    tab("alpha", { title: "(7) Alpha", url: "https://a.example/a" }),
  ];
  const off = plan(singles, [], { groupUnmatchedTabs: false });
  assert.deepEqual(off.order, ["zebra", "alpha"]);
  assert.deepEqual(off.blocks, []);

  const split = plan(
    [
      tab("other", { title: "Other", url: "https://docs.example.com/guide" }),
      tab("gap", { title: "Alpha", url: "https://alpha.example/gap" }),
      tab("product", { title: "Product", url: "https://docs.example.com/product" }),
    ],
    [productRule, otherRule],
    { groupUnmatchedTabs: false },
  );
  assert.deepEqual(split.order, ["other", "gap", "product"]);

  const on = plan(
    [
      tab("other", { title: "Other", url: "https://docs.example.com/guide" }),
      tab("gap", { title: "Alpha", url: "https://alpha.example/gap" }),
      tab("product", { title: "Product", url: "https://docs.example.com/product" }),
    ],
    [productRule, otherRule],
  );
  assert.deepEqual(on.order, ["product", "other", "gap"]);
});

test("pinned tabs stay in the pinned category and are sorted there on their own", () => {
  const result = plan([
    tab("pin-b", { title: "Bravo", url: "https://b.example/pin", pinned: true }),
    tab("pin-a", { title: "Alpha", url: "https://a.example/pin", pinned: true }),
    tab("open-b", { title: "Bravo", url: "https://b.example/open", pinned: false }),
    tab("open-a", { title: "Alpha", url: "https://a.example/open", pinned: false }),
  ]);

  assert.deepEqual(result.order, ["pin-a", "pin-b", "open-a", "open-b"]);
  assert.equal(result.tabs.every((entry) => entry.pinned === (entry.id.startsWith("pin-"))), true);
  const sequence = planApplyMoves(result);
  const pinned = sequence.workspaces[0].categories.find((category) => category.pinned === true);
  const unpinned = sequence.workspaces[0].categories.find((category) => category.pinned === false);
  assert.equal(pinned.supported, false);
  assert.deepEqual(pinned.moves, []);
  assert.equal(pinned.failures.length, 2);
  assert.equal(unpinned.supported, true);
  assert.deepEqual(unpinned.moves.map((move) => move.tabId), ["open-a", "open-b"]);
  assert.equal(unpinned.moves.every((move) => move.index === -1), true);
  assert.equal(relocated(result).every((entry) => entry.pinned === false), true);
});

test("each workspace is ordered on its own when another workspace is earlier in the window", () => {
  const result = plan([
    tab("early", { title: "Zebra", url: "https://early.example/", workspaceId: "early", workspaceName: "Early" }),
    tab("mango", { title: "Mango", url: "https://mango.example/", workspaceId: "later", workspaceName: "Later" }),
    tab("apple", { title: "Apple", url: "https://apple.example/", workspaceId: "later", workspaceName: "Later" }),
  ]);

  assert.deepEqual(result.order, ["early", "apple", "mango"]);
  assert.equal(result.tabs.find((entry) => entry.id === "early").plannedIndex, 0);
  assert.equal(result.moves.some((move) => move.tabId === "early"), false);
});

test("a rejected tab follows the sorted single tabs and does not split a group", () => {
  const on = plan([
    tab("zebra", { title: "Zebra", url: "https://z.example/z" }),
    tab("opera", { title: "Speed Dial", url: "opera://startpage" }),
    tab("alpha", { title: "Alpha", url: "https://a.example/a" }),
    tab("news-b", { title: "News B", url: "https://example.com/news/b" }),
    tab("news-a", { title: "News A", url: "https://example.com/news/a" }),
  ]);
  assert.deepEqual(on.order, ["news-b", "news-a", "alpha", "zebra", "opera"]);
  assert.equal(on.tabs.find((entry) => entry.id === "opera").role, "rejected");
  assert.equal(on.blocks[0].tabIds.includes("opera"), false);

  const off = plan(
    [
      tab("alpha", { title: "Alpha", url: "https://a.example/a" }),
      tab("opera", { title: "Speed Dial", url: "opera://startpage" }),
      tab("zebra", { title: "Zebra", url: "https://z.example/z" }),
    ],
    [],
    { groupUnmatchedTabs: false },
  );
  assert.deepEqual(off.order, ["alpha", "opera", "zebra"]);
});

test("planning the planned order moves nothing, including after a bracket count changes", () => {
  const tabs = [
    tab("zebra", { title: "(12) Zebra", url: "https://z.example/z" }),
    tab("alpha", { title: "(7) Alpha", url: "https://a.example/a" }),
    tab("beta", { title: "Beta", url: "https://b.example/b" }),
  ];
  const first = plan(tabs);
  assert.deepEqual(first.order, ["alpha", "beta", "zebra"]);
  const byId = new Map(tabs.map((entry) => [entry.id, entry]));
  const arranged = first.order.map((id) => byId.get(id));
  const second = plan(arranged);
  assert.deepEqual(second.order, first.order);
  assert.deepEqual(second.moves, []);
  assert.equal(relocated(second).length, 0);

  const counted = arranged.map((entry) => entry.id === "alpha" ? { ...entry, title: "(99) Alpha" } : entry);
  const third = plan(counted);
  assert.deepEqual(third.order, ["alpha", "beta", "zebra"]);
  assert.deepEqual(third.moves, []);
  assert.equal(third.tabs.find((entry) => entry.id === "alpha").title, "(99) Alpha");
});

test("Gameday with no rules orders the Jira group and then the 6 single tabs", () => {
  const tabs = gamedayWindow();
  const scope = gamedayScope(tabs);
  assert.equal(scope.workspaceName, "Gameday");
  const inspected = inspectPreview(tabs, [], { scope });
  assert.equal(inspected.preview.status, "ready");
  assert.deepEqual(inspected.plan.order, gamedayOrder);
  assert.deepEqual(inspected.preview.blocks.map((block) => [block.kind, block.label, block.titles]), [
    ["automatic", "spicymango.atlassian.net/browse", ["PROJ-12", "PROJ-2"]],
  ]);
  assert.deepEqual(inspected.preview.unmatched.map((entry) => entry.title), [
    "Alpha notes",
    "Echo",
    "écho",
    "(12) Home / X",
    "Untitled tab",
    "(7) Standings",
  ]);
  assert.equal(inspected.preview.message, "6 tabs to move into 1 group, 6 unmatched");
  assert.equal(inspected.changeCount, 6);
  assert.equal(inspected.plan.moves.length < inspected.changeCount, true);
  assert.equal(JSON.stringify(inspected.preview).includes("https://"), false);
  assert.equal(JSON.stringify(inspected.preview).includes("Inbox"), false);

  const full = plan(tabs);
  assert.equal(full.order[0], "inbox");
  assert.deepEqual(full.order.filter((id) => id !== "inbox"), gamedayOrder);
  assert.equal(relocated(full).length, inspected.changeCount);
});

test("one user rule stays ahead of the Gameday automatic group and the sorted single tabs", () => {
  const tabs = gamedayWindow();
  const scope = gamedayScope(tabs);
  const inspected = inspectPreview(tabs, [exampleRule], { scope });
  assert.deepEqual(inspected.plan.order, ["standings", "jira-12", "jira-2", "alpha", "echo-a", "echo-b", "home", "zeta"]);
  assert.deepEqual(inspected.preview.blocks.map((block) => [block.kind, block.label, block.titles]), [
    ["rule", "example.com", ["(7) Standings"]],
    ["automatic", "spicymango.atlassian.net/browse", ["PROJ-12", "PROJ-2"]],
  ]);
  assert.equal(inspected.preview.message, "7 tabs to move into 1 group, 5 unmatched");
  assert.equal(inspected.changeCount, relocated(inspected.plan).length);
});

test("a key with 1 tab stays a single tab and the summary counts the sort", () => {
  const tabs = [
    tab("zebra", { title: "Zebra", url: "https://z.example/z" }),
    tab("jira", { title: "PROJ-1", url: "https://spicymango.atlassian.net/browse/PROJ-1" }),
    tab("alpha", { title: "Alpha", url: "https://a.example/a" }),
  ];
  const inspected = inspectPreview(tabs, []);
  assert.equal(inspected.preview.status, "no-matches");
  assert.deepEqual(inspected.plan.order, ["alpha", "jira", "zebra"]);
  assert.deepEqual(inspected.preview.blocks, []);
  assert.equal(inspected.preview.message, "2 tabs to move into 0 groups, 3 unmatched");
  assert.equal(inspected.changeCount, 2);
});

test("Apply moves Gameday into the preview order and a second plan has nothing to move", async () => {
  const tabs = gamedayWindow();
  const scope = gamedayScope(tabs);
  const inspected = inspectPreview(tabs, [], { scope });
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {}, location: { assign() {} } },
    browser: createOperaBrowser(tabs).browser,
    local: memoryLocal([]),
    manifest: {
      name: "Workspace Tab Organiser",
      version: "0.8.0",
      manifest_version: 2,
      description: "Order automatic groups and sort single tabs in the current workspace.",
    },
  });
  assert.equal(document.getElementById("heading").textContent, "Gameday");
  assert.equal(document.getElementById("status").textContent, inspected.preview.message);
  assert.equal(document.getElementById("apply").disabled, false);
  assert.equal(document.getElementById("apply-reason").textContent, "");
  assert.match(texts(document.getElementById("unmatched")).join("\n"), /Alpha notes/);
  assert.match(texts(document.getElementById("blocks")).join("\n"), /spicymango\.atlassian\.net\/browse/);
  assert.equal(texts(document.getElementById("unmatched")).join("\n").includes("(7) Standings"), true);

  const fake = createOperaBrowser(tabs);
  const result = await applyDisplayedPreview(fake.browser, inspected.fingerprint, []);
  assert.equal(result.status, "applied");
  assert.equal(result.report.failed, 0);
  assert.equal(result.report.moved, inspected.changeCount);
  assert.equal(result.report.unmatched, 6);
  assert.deepEqual(titlesIn(fake.tabs, "Gameday"), [
    "PROJ-12",
    "PROJ-2",
    "Alpha notes",
    "Echo",
    "écho",
    "(12) Home / X",
    "",
    "(7) Standings",
  ]);
  assert.deepEqual(titlesIn(fake.tabs, "Inbox"), ["Inbox home"]);
  const moves = fake.calls.filter((call) => call.method === "move");
  assert.equal(moves.every((call) => call.props.index === -1), true);
  assert.equal(moves.some((call) => call.tabId === "inbox"), false);

  const again = await applyDisplayedPreview(fake.browser, result.fingerprint, []);
  assert.equal(again.status, "applied");
  assert.equal(again.report.moved, 0);
  assert.equal(again.changeCount, 0);
  assert.deepEqual(titlesIn(fake.tabs, "Gameday"), [
    "PROJ-12",
    "PROJ-2",
    "Alpha notes",
    "Echo",
    "écho",
    "(12) Home / X",
    "",
    "(7) Standings",
  ]);

  const standings = fake.tabs.find((entry) => entry.id === "standings");
  standings.title = "(99) Standings";
  const recounted = inspectPreview(
    fake.tabs.slice().sort((left, right) => left.index - right.index),
    [],
    { scope: gamedayScope(fake.tabs) },
  );
  assert.deepEqual(recounted.plan.order, gamedayOrder);
  assert.equal(recounted.changeCount, 0);
  assert.equal(recounted.preview.message, "0 tabs to move into 0 groups, 6 unmatched");
  assert.equal(recounted.preview.unmatched.some((entry) => entry.title === "(99) Standings"), true);
});

function titlesIn(tabs, workspaceName) {
  return tabs
    .filter((entry) => entry.workspaceName === workspaceName)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.title);
}

function memoryLocal(rules, groupUnmatchedTabs = true) {
  const data = {
    [ORGANISER_RULES_KEY]: rules,
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs },
  };
  return {
    get(key, callback) {
      callback({ [key]: data[key] });
    },
    set(_items, callback) {
      callback();
    },
  };
}

function workspaceKey(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

function createOperaBrowser(initial) {
  const tabs = initial.map((entry) => ({ ...entry }));
  const calls = [];

  const reorder = (id, requestedIndex) => {
    const moving = tabs.find((entry) => entry.id === id);
    const key = workspaceKey(moving.workspaceId);
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
  };

  const api = {
    query(queryInfo, callback) {
      calls.push({ method: "query", queryInfo });
      let copy = tabs.map((entry) => ({ ...entry }));
      if (queryInfo && queryInfo.active === true) {
        copy = copy.filter((entry) => entry.active === true);
      }
      if (typeof callback === "function") {
        callback(copy);
      }
      return Promise.resolve(copy);
    },
    move(tabId, props, callback) {
      calls.push({ method: "move", tabId, props: { ...props } });
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
      if (typeof callback === "function") {
        callback({});
      }
      return Promise.resolve({});
    },
  };

  return { tabs, calls, browser: { tabs: api, runtime: {} } };
}

function makeElement(tag) {
  return {
    tag,
    id: "",
    className: "",
    textContent: "",
    href: "",
    hidden: false,
    disabled: false,
    title: "",
    children: [],
    listeners: {},
    append(...nodes) {
      for (const node of nodes) {
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
  for (const [id, tagName] of [
    ["heading", "h1"],
    ["scope-note", "p"],
    ["status", "p"],
    ["blocks", "section"],
    ["unmatched", "section"],
    ["unavailable", "section"],
    ["apply-reason", "p"],
    ["name", "p"],
    ["version", "p"],
    ["options", "a"],
    ["cancel", "button"],
    ["apply", "button"],
    ["report", "section"],
  ]) {
    const element = makeElement(tagName);
    element.id = id;
    root.append(element);
  }
  return document;
}

function texts(node) {
  const values = [node.textContent];
  for (const child of node.children || []) {
    values.push(...texts(child));
  }
  return values.filter((value) => value !== "");
}
