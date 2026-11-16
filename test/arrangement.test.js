import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { planApplyMoves } from "../extension/apply-plan.js";
import { planArrangement } from "../extension/arrangement.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "extension/arrangement.js"), "utf8");
const popupJs = readFileSync(path.join(root, "extension/popup.js"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

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

function rule(id, label, hostname, pathPrefix = null) {
  return { id, label, hostname, pathPrefix };
}

function tab(id, overrides = {}) {
  return {
    id,
    url: `https://docs.example.com/${id}`,
    title: `Tab ${id}`,
    pinned: false,
    active: false,
    windowId: 1,
    workspaceId: "work",
    workspaceName: "Work",
    ...overrides,
  };
}

function workspaceKey(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

function plan(tabs, rules = [productRule, otherRule], options) {
  const result = planArrangement(tabs, rules, options);
  if (result.ok) {
    assertWindowInvariants(tabs, result);
  }
  return result;
}

function assertWindowInvariants(tabs, result) {
  assert.equal(result.tabCount, tabs.length);
  assert.deepEqual(result.tabs.map((entry) => entry.id), tabs.map((entry) => entry.id));
  assert.equal(new Set(result.order).size, tabs.length);
  const byId = new Map(tabs.map((entry) => [entry.id, entry]));
  assert.deepEqual(
    result.order.map((id) => workspaceKey(byId.get(id).workspaceId)),
    tabs.map((entry) => workspaceKey(entry.workspaceId)),
  );
  assert.deepEqual(
    result.order.map((id) => byId.get(id).pinned === true),
    tabs.map((entry) => entry.pinned === true),
  );
  for (const entry of result.tabs) {
    assert.equal(result.order[entry.plannedIndex], entry.id);
  }
  const seenActive = new Set();
  const activeTabIds = [];
  for (const entry of tabs) {
    if (entry.active !== true) {
      continue;
    }
    const workspaceId = workspaceKey(entry.workspaceId);
    if (seenActive.has(workspaceId)) {
      continue;
    }
    seenActive.add(workspaceId);
    activeTabIds.push({ workspaceId, tabId: entry.id });
  }
  assert.deepEqual(result.activeTabIds, activeTabIds);
  assert.equal(Object.hasOwn(result, "activeTabId"), false);
  for (const move of result.moves) {
    const described = result.tabs.find((entry) => entry.id === move.tabId);
    assert.equal(described.selected, true);
    assert.equal(move.fromIndex, described.originalIndex);
    assert.equal(move.toIndex, described.plannedIndex);
    assert.notEqual(move.fromIndex, move.toIndex);
  }
  for (const described of result.tabs) {
    if (!described.selected) {
      assert.equal(result.moves.some((move) => move.tabId === described.id), false);
    }
  }
  for (const boundary of result.boundaries) {
    assert.equal(boundary.anchorsKept, true);
  }
  for (const block of result.blocks) {
    assert.equal(block.tabIds[0], block.anchorTabId);
    assert.equal(block.contiguousInWindow, block.interruptions.length === 0);
    const members = block.tabIds.map((id) => result.tabs.find((entry) => entry.id === id));
    const originalIndexes = members.map((entry) => entry.originalIndex);
    assert.deepEqual(originalIndexes, [...originalIndexes].sort((left, right) => left - right));
    for (const member of members) {
      assert.equal(member.selected, true);
      assert.equal(member.label, block.label);
      assert.equal(member.workspaceId, block.workspaceId);
      assert.equal(member.pinned, block.pinned);
    }
  }
}

test("module stays free of browser, storage, and tab movement", () => {
  assert.doesNotMatch(source, /node:|chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(source, /tabs\.(move|create|remove|update|group)|tabGroups|windows\.(create|update)|storage\./);
  assert.match(source, /export function planArrangement/);
  assert.doesNotMatch(popupJs, /arrangement|planArrangement|tabs\.(move|create|remove|update)/);
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
});

test("planning does not change tabs or rules and does not copy URLs", () => {
  const tabs = [
    tab("other-a", { url: "https://user:secret@docs.example.com/guide?token=abc#frag" }),
    tab("product-a", { url: "https://docs.example.com/product/install?x=1#y" }),
  ];
  const rules = [productRule, otherRule, { ...productRule, id: "extra", hostname: "extra.example", secret: "do-not-copy" }];
  const tabsBefore = structuredClone(tabs);
  const rulesBefore = structuredClone(rules);
  const result = plan(tabs, rules);

  assert.deepEqual(tabs, tabsBefore);
  assert.deepEqual(rules, rulesBefore);
  assert.equal(result.ok, true);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("secret"), false);
  assert.equal(serialised.includes("token"), false);
  assert.equal(serialised.includes("https://"), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blocks), true);
  assert.equal(Object.isFrozen(result.order), true);
  assert.deepEqual(JSON.parse(serialised).order, result.order);
});

test("zero tabs and one unmatched or matched tab keep the window", () => {
  const empty = plan([], [productRule]);
  assert.deepEqual(empty.order, []);
  assert.deepEqual(empty.blocks, []);
  assert.deepEqual(empty.moves, []);
  assert.equal(empty.windowId, null);
  assert.deepEqual(empty.activeTabIds, []);

  const unmatched = plan([tab("plain", { url: "https://example.com/plain", workspaceId: null, workspaceName: null })]);
  assert.deepEqual(unmatched.order, ["plain"]);
  assert.deepEqual(unmatched.blocks, []);
  assert.deepEqual(unmatched.moves, []);
  assert.equal(unmatched.tabs[0].role, "unmatched");
  assert.equal(unmatched.tabs[0].selected, false);

  const matched = plan([
    tab("before", { url: "https://example.com/before" }),
    tab("only", { url: "https://docs.example.com/product/guide", active: true }),
    tab("after", { url: "https://example.com/after" }),
  ]);
  assert.deepEqual(matched.order, ["only", "after", "before"]);
  assert.deepEqual(matched.moves.map((move) => move.tabId), ["only"]);
  assert.deepEqual(matched.activeTabIds, [{ workspaceId: "work", tabId: "only" }]);
  assert.equal(matched.blocks.length, 1);
  assert.equal(matched.blocks[0].anchorTabId, "only");
  assert.deepEqual(matched.blocks[0].tabIds, ["only"]);
  assert.equal(matched.blocks[0].contiguousInWindow, true);
  assert.equal(matched.tabs[1].role, "anchor");
});

test("members join the anchor in original order and single tabs follow the group", () => {
  const result = plan([
    tab("u1", { url: "https://example.com/u1" }),
    tab("product-a", { url: "https://docs.example.com/product/a" }),
    tab("u2", { url: "https://example.com/u2" }),
    tab("product-b", { url: "https://docs.example.com/product/b?q=1#z" }),
    tab("u3", { url: "https://example.com/u3" }),
    tab("product-c", { url: "https://docs.example.com/product/c/" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "product-b", "product-c", "u1", "u2", "u3"]);
  assert.deepEqual(result.blocks[0].tabIds, ["product-a", "product-b", "product-c"]);
  assert.deepEqual(result.moves.map((move) => move.tabId), ["product-a", "product-b", "product-c"]);
  assert.equal(result.tabs.find((entry) => entry.id === "u2").selected, false);
  assert.equal(result.tabs.find((entry) => entry.id === "u2").plannedIndex, 4);
});

test("adjacent blocks in one workspace follow organiser rule order", () => {
  const tabs = [
    tab("other-a", { url: "https://docs.example.com/guide" }),
    tab("product-a", { url: "https://docs.example.com/product/install" }),
    tab("other-b", { url: "https://docs.example.com/reference" }),
    tab("product-b", { url: "https://docs.example.com/product/setup" }),
  ];
  const result = plan(tabs);

  assert.deepEqual(result.order, ["product-a", "product-b", "other-a", "other-b"]);
  assert.deepEqual(result.blocks.map((block) => [block.label, block.anchorTabId, block.tabIds]), [
    ["Product documentation", "product-a", ["product-a", "product-b"]],
    ["Other documentation", "other-a", ["other-a", "other-b"]],
  ]);

  const broaderFirst = plan(tabs, [otherRule, productRule]);
  assert.deepEqual(broaderFirst.order, ["other-a", "product-a", "other-b", "product-b"]);
  assert.deepEqual(broaderFirst.moves, []);
  assert.deepEqual(broaderFirst.blocks.map((block) => [block.label, block.tabIds]), [
    ["Other documentation", ["other-a", "product-a", "other-b", "product-b"]],
  ]);
});

test("reversing non-overlapping rules reverses adjacent blocks", () => {
  const docs = rule("docs", "Docs", "example.com", "/docs");
  const news = rule("news", "News", "example.com", "/news");
  const tabs = [
    tab("news-a", { url: "https://example.com/news/a" }),
    tab("docs-a", { url: "https://example.com/docs/a" }),
    tab("news-b", { url: "https://example.com/news/b" }),
    tab("docs-b", { url: "https://example.com/docs/b" }),
  ];

  assert.deepEqual(plan(tabs, [docs, news]).order, ["docs-a", "docs-b", "news-a", "news-b"]);
  assert.deepEqual(plan(tabs, [news, docs]).order, ["news-a", "news-b", "docs-a", "docs-b"]);
});

test("user rule groups come first in rule order and the single tab follows them", () => {
  const result = plan([
    tab("other-a", { url: "https://docs.example.com/guide" }),
    tab("gap", { url: "https://example.com/gap" }),
    tab("product-a", { url: "https://docs.example.com/product" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "other-a", "gap"]);
  assert.deepEqual(result.moves.map((move) => move.tabId), ["other-a", "product-a"]);
  assert.equal(result.blocks[0].label, "Product documentation");
  assert.equal(result.blocks[1].label, "Other documentation");
});

test("a rejected tab follows the groups and does not split them", () => {
  const result = plan([
    tab("other-a", { url: "https://docs.example.com/guide" }),
    tab("opera", { url: "opera://startpage", title: "Start" }),
    tab("product-a", { url: "https://docs.example.com/product" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "other-a", "opera"]);
  assert.equal(result.tabs[1].role, "rejected");
  assert.equal(result.tabs[1].reason, "unsupported-url");
  assert.equal(result.tabs[1].selected, false);
  assert.equal(JSON.stringify(result).includes("opera://"), false);
});

test("D4 keeps every anchor instead of combining adjacent blocks across workspaces", () => {
  const tabs = [
    tab("other-a", {
      url: "https://docs.example.com/guide",
      workspaceId: "research",
      workspaceName: "Research",
    }),
    tab("product-a", {
      url: "https://docs.example.com/product/install",
      workspaceId: "writing",
      workspaceName: "Writing",
    }),
  ];
  const result = plan(tabs);

  assert.deepEqual(result.order, ["other-a", "product-a"]);
  assert.deepEqual(result.moves, []);
  assert.deepEqual(result.blocks.map((block) => [block.workspaceId, block.anchorTabId]), [
    ["research", "other-a"],
    ["writing", "product-a"],
  ]);
  assert.deepEqual(result.boundaries, [
    {
      type: "workspace",
      afterIndex: 0,
      anchorsKept: true,
      before: {
        tabId: "other-a",
        label: "Other documentation",
        workspaceId: "research",
        workspaceName: "Research",
        pinned: false,
      },
      after: {
        tabId: "product-a",
        label: "Product documentation",
        workspaceId: "writing",
        workspaceName: "Writing",
        pinned: false,
      },
    },
  ]);
  assert.deepEqual(result.separations, []);
});

test("the same label in two workspaces stays two anchored blocks", () => {
  const result = plan([
    tab("product-a", { url: "https://docs.example.com/product/a", workspaceId: "research", workspaceName: "Research" }),
    tab("product-b", { url: "https://docs.example.com/product/b", workspaceId: "research", workspaceName: "Research" }),
    tab("product-c", { url: "https://docs.example.com/product/c", workspaceId: "writing", workspaceName: "Writing" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "product-b", "product-c"]);
  assert.deepEqual(result.moves, []);
  assert.deepEqual(result.blocks.map((block) => [block.workspaceId, block.anchorTabId, block.tabIds, block.contiguousInWindow]), [
    ["research", "product-a", ["product-a", "product-b"], true],
    ["writing", "product-c", ["product-c"], true],
  ]);
  assert.deepEqual(result.separations, [
    {
      type: "workspace",
      label: "Product documentation",
      pinned: false,
      anchors: [
        { tabId: "product-a", ruleId: "product", workspaceId: "research", workspaceName: "Research", pinned: false },
        { tabId: "product-c", ruleId: "product", workspaceId: "writing", workspaceName: "Writing", pinned: false },
      ],
    },
  ]);
  assert.equal(result.boundaries[0].type, "workspace");
  assert.equal(result.boundaries[0].anchorsKept, true);
});

test("a block does not take another workspace slot, and the interruption is explicit", () => {
  const result = plan([
    tab("product-a", { url: "https://docs.example.com/product/a", workspaceId: "work", workspaceName: "Work" }),
    tab("other-a", { url: "https://docs.example.com/guide", workspaceId: "writing", workspaceName: "Writing" }),
    tab("product-b", { url: "https://docs.example.com/product/b", workspaceId: "work", workspaceName: "Work" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "other-a", "product-b"]);
  assert.deepEqual(result.moves, []);
  const product = result.blocks.find((block) => block.workspaceId === "work");
  assert.deepEqual(product.tabIds, ["product-a", "product-b"]);
  assert.equal(product.contiguousInWindow, false);
  assert.deepEqual(product.interruptions, [
    {
      tabId: "other-a",
      label: "Other documentation",
      workspaceId: "writing",
      workspaceName: "Writing",
      pinned: false,
    },
  ]);
});

test("rule order still applies inside a workspace when another workspace sits between its slots", () => {
  const result = plan([
    tab("other-a", { url: "https://docs.example.com/guide", workspaceId: "work", workspaceName: "Work" }),
    tab("gap", { url: "https://example.com/gap", workspaceId: "writing", workspaceName: "Writing" }),
    tab("product-a", { url: "https://docs.example.com/product", workspaceId: "work", workspaceName: "Work" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "gap", "other-a"]);
  assert.deepEqual(result.moves.map((move) => [move.tabId, move.fromIndex, move.toIndex]), [
    ["other-a", 0, 2],
    ["product-a", 2, 0],
  ]);
  assert.equal(result.tabs.find((entry) => entry.id === "gap").selected, false);
  assert.equal(result.tabs.find((entry) => entry.id === "gap").plannedIndex, 1);
});

test("a different workspace does not stop two blocks becoming adjacent in their own workspace", () => {
  const result = plan([
    tab("other-a", { url: "https://docs.example.com/guide", workspaceId: "work", workspaceName: "Work" }),
    tab("opera", { url: "opera://startpage", workspaceId: "writing", workspaceName: "Writing" }),
    tab("product-a", { url: "https://docs.example.com/product", workspaceId: "work", workspaceName: "Work" }),
  ]);

  assert.deepEqual(result.order, ["product-a", "opera", "other-a"]);
  assert.equal(result.tabs.find((entry) => entry.id === "opera").role, "rejected");
  assert.equal(result.tabs.find((entry) => entry.id === "opera").plannedIndex, 1);
});

test("pinned and unpinned categories stay apart and keep their own anchors", () => {
  const result = plan([
    tab("other-a", { url: "https://docs.example.com/guide", pinned: true }),
    tab("product-a", { url: "https://docs.example.com/product/a", pinned: true }),
    tab("product-b", { url: "https://docs.example.com/product/b", pinned: false, active: true }),
    tab("gap", { url: "https://example.com/gap", pinned: false }),
  ]);

  assert.deepEqual(result.order, ["product-a", "other-a", "product-b", "gap"]);
  assert.deepEqual(result.activeTabIds, [{ workspaceId: "work", tabId: "product-b" }]);
  assert.deepEqual(result.blocks.map((block) => [block.pinned, block.anchorTabId, block.tabIds]), [
    [true, "product-a", ["product-a"]],
    [true, "other-a", ["other-a"]],
    [false, "product-b", ["product-b"]],
  ]);
  assert.deepEqual(result.separations, [
    {
      type: "pin",
      label: "Product documentation",
      pinned: null,
      anchors: [
        { tabId: "product-a", ruleId: "product", workspaceId: "work", workspaceName: "Work", pinned: true },
        { tabId: "product-b", ruleId: "product", workspaceId: "work", workspaceName: "Work", pinned: false },
      ],
    },
  ]);
  assert.deepEqual(result.boundaries.filter((boundary) => boundary.type === "pin"), [
    {
      type: "pin",
      afterIndex: 1,
      anchorsKept: true,
      before: {
        tabId: "other-a",
        label: "Other documentation",
        workspaceId: "work",
        workspaceName: "Work",
        pinned: true,
      },
      after: {
        tabId: "product-b",
        label: "Product documentation",
        workspaceId: "work",
        workspaceName: "Work",
        pinned: false,
      },
    },
  ]);
  assert.equal(result.moves.some((move) => move.tabId === "product-b"), false);
});

test("pinned members join inside the pinned category only", () => {
  const result = plan([
    tab("product-a", { url: "https://docs.example.com/product/a", pinned: true }),
    tab("gap", { url: "https://example.com/pinned-gap", pinned: true }),
    tab("product-b", { url: "https://docs.example.com/product/b", pinned: true }),
    tab("product-c", { url: "https://docs.example.com/product/c", pinned: false }),
  ]);

  assert.deepEqual(result.order, ["product-a", "product-b", "gap", "product-c"]);
  assert.deepEqual(result.blocks.map((block) => [block.pinned, block.tabIds]), [
    [true, ["product-a", "product-b"]],
    [false, ["product-c"]],
  ]);
  assert.equal(result.tabs.find((entry) => entry.id === "gap").selected, false);
});

test("already arranged tabs produce an empty move list", () => {
  const tabs = [
    tab("product-a", { url: "https://docs.example.com/product/a" }),
    tab("product-b", { url: "https://docs.example.com/product/b" }),
    tab("other-a", { url: "https://docs.example.com/guide" }),
    tab("gap", { url: "https://example.com/gap" }),
  ];
  const result = plan(tabs);
  assert.deepEqual(result.order, ["product-a", "product-b", "other-a", "gap"]);
  assert.deepEqual(result.moves, []);
});

test("single-tab rule groups reorder inside their workspace when earlier tabs belong to another workspace", () => {
  const rules = [
    rule("bbc", "www.bbc.co.uk", "www.bbc.co.uk", "/"),
    rule("wiki", "en.wikipedia.org", "en.wikipedia.org", "/"),
  ];
  const tabs = [
    tab("speed", { workspaceId: "1", workspaceName: "Gameday", url: "opera://startpage", title: "Speed Dial" }),
    tab("wiki", { workspaceId: "10", workspaceName: "Test B", url: "https://en.wikipedia.org/wiki/Tab_(interface)", title: "Tab (interface) - Wikipedia" }),
    tab("weather", { workspaceId: "10", workspaceName: "Test B", url: "https://www.bbc.co.uk/weather", title: "BBC Weather - Home" }),
  ];
  const result = plan(tabs, rules);
  assert.deepEqual(result.order, ["speed", "weather", "wiki"]);
  assert.deepEqual(result.moves.map((move) => move.tabId).sort(), ["weather", "wiki"]);
  assert.equal(result.tabs.find((entry) => entry.id === "speed").plannedIndex, 0);
  const weather = result.tabs.find((entry) => entry.id === "weather");
  assert.equal(weather.originalIndex, 2);
  assert.equal(weather.plannedIndex, 1);
});

test("planning the planned order does not select further moves", () => {
  const tabs = [
    tab("other-a", { url: "https://docs.example.com/guide", workspaceId: "work", workspaceName: "Work" }),
    tab("gap", { url: "https://example.com/gap", workspaceId: "writing", workspaceName: "Writing" }),
    tab("product-a", { url: "https://docs.example.com/product", workspaceId: "work", workspaceName: "Work" }),
    tab("product-b", { url: "https://docs.example.com/product/b", workspaceId: "work", workspaceName: "Work", pinned: false }),
  ];
  const first = plan(tabs);
  const byId = new Map(tabs.map((entry) => [entry.id, entry]));
  const second = plan(first.order.map((id) => byId.get(id)));
  assert.deepEqual(second.order, first.order);
  assert.deepEqual(second.moves, []);
  assert.deepEqual(second.blocks.map((block) => block.tabIds), first.blocks.map((block) => block.tabIds));
});

test("tabs that share a label form one block and use the earliest contributing rule", () => {
  const rules = [
    rule("docs-a", "Docs", "a.example"),
    rule("news", "News", "news.example"),
    rule("docs-b", "Docs", "b.example"),
  ];
  const result = plan(
    [
      tab("b", { url: "https://b.example/page" }),
      tab("news", { url: "https://news.example/page" }),
      tab("a", { url: "https://a.example/page" }),
    ],
    rules,
  );

  assert.deepEqual(result.order, ["b", "a", "news"]);
  assert.equal(result.blocks[0].label, "Docs");
  assert.equal(result.blocks[0].ruleId, "docs-b");
  assert.equal(result.blocks[0].ruleIndex, 0);
  assert.deepEqual(result.blocks[0].tabIds, ["b", "a"]);
  assert.equal(result.blocks[1].ruleIndex, 1);
});

test("omitted workspace ids share the unavailable workspace and stay apart from a named one", () => {
  const rules = [rule("docs", "Docs", "docs.example"), rule("news", "News", "news.example")];
  const result = plan(
    [
      tab("news", { url: "https://news.example/", workspaceId: undefined, workspaceName: undefined }),
      tab("docs", { url: "https://docs.example/guide", workspaceId: "", workspaceName: "" }),
      tab("named", { url: "https://docs.example/guide", workspaceId: "work", workspaceName: "Work" }),
    ],
    rules,
  );

  assert.deepEqual(result.order, ["docs", "news", "named"]);
  assert.equal(result.blocks[0].workspaceId, null);
  assert.deepEqual(result.blocks[0].tabIds, ["docs"]);
  assert.equal(result.blocks[1].workspaceId, null);
  assert.equal(result.blocks[2].workspaceId, "work");
  assert.equal(result.tabs[0].workspaceId, null);
  assert.equal(result.tabs[1].workspaceId, null);
});

test("matching distinctions stay in the planner: query strings, www, and the active tab", () => {
  const rules = [rule("apex", "Apex", "example.com", "/docs")];
  const result = plan(
    [
      tab("www", { url: "https://www.example.com/docs/item", active: false }),
      tab("apex-b", { url: "https://example.com/docs/later?q=1#frag" }),
      tab("apex-a", { url: "https://example.com/docs/first", active: true }),
    ],
    rules,
  );

  assert.equal(result.tabs.find((entry) => entry.id === "www").role, "unmatched");
  assert.deepEqual(result.blocks[0].tabIds, ["apex-b", "apex-a"]);
  assert.deepEqual(result.activeTabIds, [{ workspaceId: "work", tabId: "apex-a" }]);
  assert.equal(result.order.includes("apex-a"), true);
  assert.equal(result.tabs.find((entry) => entry.id === "apex-a").active, true);
});

test("invalid rules and a non-array tab list are rejected without echoing values", () => {
  const tabs = [tab("secret-tab", { url: "https://user:secret@docs.example.com/product?token=abc" })];
  const invalid = planArrangement(tabs, [{ label: "Missing id", hostname: "user:secret@example.com" }]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid-rules");
  assert.equal(invalid.index, null);
  assert.equal(invalid.field, "rules");
  assert.equal(JSON.stringify(invalid).includes("secret"), false);
  assert.deepEqual(planArrangement(tabs, { id: "not-a-list" }), {
    ok: false,
    reason: "invalid-rules",
    index: null,
    field: "rules",
    errors: [{ index: null, field: "rules", code: "invalid" }],
  });
  assert.throws(() => planArrangement(null, [productRule]), { name: "TypeError", message: "tabs must be an array" });
});

test("invalid window inputs name the first fault and do not echo it", () => {
  assert.deepEqual(plan([null, tab("later")]), {
    ok: false,
    reason: "invalid-tab",
    index: 0,
    field: "tab",
    errors: null,
  });
  assert.deepEqual(plan([tab("ok"), tab("ok")]).reason, "duplicate-tab-id");
  assert.equal(plan([tab("a", { windowId: 1 }), tab("b", { windowId: 2 })]).reason, "mixed-window");
  assert.equal(plan([tab("a", { windowId: 1 }), tab("b", { windowId: undefined })]).reason, "mixed-window");
  assert.equal(plan([tab("a", { pinned: false }), tab("b", { pinned: true })]).reason, "pinned-boundary");
  assert.equal(plan([tab("a", { active: true }), tab("b", { active: true })]).index, 1);
  assert.equal(plan([tab("a", { active: true }), tab("b", { active: true })]).reason, "multiple-active");
  assert.equal(plan([tab("a", { pinned: "yes" })]).field, "pinned");
  assert.equal(plan([tab("a", { workspaceId: 4 })]).field, "workspaceId");
  assert.equal(plan([tab("a", { id: "" })]).field, "id");

  const secretId = {};
  Object.defineProperty(secretId, "id", {
    get() {
      throw new Error("secret-token");
    },
  });
  const thrown = planArrangement([secretId], [productRule]);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, "invalid-tab");
  assert.equal(JSON.stringify(thrown).includes("secret-token"), false);

  const throwingUrl = tab("covered");
  Object.defineProperty(throwingUrl, "url", {
    get() {
      throw new Error("secret-token");
    },
  });
  const rejected = plan([throwingUrl]);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.tabs[0].role, "rejected");
  assert.equal(rejected.tabs[0].reason, "malformed-url");
  assert.equal(rejected.tabs[0].selected, false);
  assert.equal(JSON.stringify(rejected).includes("secret-token"), false);
});

test("titles and workspace names are kept while an empty plan still describes the window", () => {
  const result = plan([
    tab("one", { title: "Install guide", workspaceName: "Deep work", windowId: 7, active: true }),
  ]);
  assert.equal(result.windowId, 7);
  assert.equal(result.tabs[0].title, "Install guide");
  assert.equal(result.tabs[0].workspaceName, "Deep work");
  assert.equal(result.blocks[0].workspaceName, "Deep work");
  assert.deepEqual(result.activeTabIds, [{ workspaceId: "work", tabId: "one" }]);
});

test("D7 keeps a pin in its own workspace when another workspace has an earlier unpinned tab", () => {
  const result = plan([
    tab("early", { pinned: false, workspaceId: "0", workspaceName: "Workspace 1", url: "https://example.com/early" }),
    tab("pin", { pinned: true, workspaceId: "9", workspaceName: "Test A", url: "https://en.wikipedia.org/wiki/Opera" }),
    tab("later", { pinned: false, workspaceId: "9", workspaceName: "Test A", url: "https://www.bbc.co.uk/sport" }),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.order, ["early", "pin", "later"]);
  assert.equal(result.tabs.find((entry) => entry.id === "pin").plannedIndex, 1);

  const inside = plan([
    tab("open", { pinned: false, workspaceId: "9", workspaceName: "Test A" }),
    tab("late-pin", { pinned: true, workspaceId: "9", workspaceName: "Test A" }),
    tab("other", { pinned: true, workspaceId: "0", workspaceName: "Workspace 1" }),
  ]);
  assert.equal(inside.ok, false);
  assert.equal(inside.reason, "pinned-boundary");
  assert.equal(inside.index, 1);
  assert.equal(inside.field, "pinned");
});

test("D6 allows 1 active tab in each workspace, including a second active tab at index 20", () => {
  const tabs = [];
  for (let index = 0; index < 21; index += 1) {
    const secondWorkspace = index >= 11;
    tabs.push(
      tab(`t${index}`, {
        url: "https://example.com/page",
        workspaceId: secondWorkspace ? "personal" : "research",
        workspaceName: secondWorkspace ? "Personal" : "Research",
        active: index === 0 || index === 20,
      }),
    );
  }

  const result = plan(tabs, [productRule]);
  assert.equal(result.ok, true);
  assert.equal(result.tabCount, 21);
  assert.equal(result.tabs[20].active, true);
  assert.equal(result.tabs[20].workspaceId, "personal");
  assert.deepEqual(result.activeTabIds, [
    { workspaceId: "research", tabId: "t0" },
    { workspaceId: "personal", tabId: "t20" },
  ]);
  assert.equal(Object.hasOwn(result, "activeTabId"), false);
});

test("2 active tabs in the same workspace fail, including tabs with no workspace", () => {
  const same = plan([
    tab("a", { active: true, workspaceId: "research", workspaceName: "Research" }),
    tab("b", { active: true, workspaceId: "research", workspaceName: "Research" }),
  ]);
  assert.equal(same.ok, false);
  assert.equal(same.reason, "multiple-active");
  assert.equal(same.index, 1);
  assert.equal(same.field, "active");

  const missing = plan([
    tab("blank", { active: true, workspaceId: "", workspaceName: "" }),
    tab("absent", { active: true, workspaceId: null, workspaceName: null }),
  ]);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "multiple-active");
  assert.equal(missing.index, 1);

  const recorded = plan([
    tab("loose", { active: true, workspaceId: null, workspaceName: null }),
    tab("quiet", { active: false, workspaceId: "quiet", workspaceName: "Quiet" }),
    tab("research", { active: true, workspaceId: "research", workspaceName: "Research" }),
  ]);
  assert.equal(recorded.ok, true);
  assert.deepEqual(recorded.activeTabIds, [
    { workspaceId: null, tabId: "loose" },
    { workspaceId: "research", tabId: "research" },
  ]);
});

test("D10 groups unmatched tabs by hostname and the first path segment", () => {
  const result = plan(
    [
      tab("sport", { url: "https://www.bbc.co.uk/sport" }),
      tab("wiki", { url: "https://en.wikipedia.org/wiki/London" }),
      tab("football", { url: "https://www.bbc.co.uk/sport/football?q=1#live" }),
      tab("lone", { url: "https://example.com/" }),
    ],
    [],
  );

  assert.deepEqual(result.order, ["sport", "football", "lone", "wiki"]);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].automatic, true);
  assert.equal(result.blocks[0].label, "www.bbc.co.uk/sport");
  assert.equal(result.blocks[0].ruleId, "auto:www.bbc.co.uk/sport");
  assert.deepEqual(result.blocks[0].tabIds, ["sport", "football"]);
  assert.equal(result.tabs.find((entry) => entry.id === "sport").role, "anchor");
  assert.equal(result.tabs.find((entry) => entry.id === "football").role, "member");
  assert.equal(result.tabs.find((entry) => entry.id === "football").automatic, true);
  assert.equal(result.tabs.find((entry) => entry.id === "wiki").role, "unmatched");
  assert.equal(result.tabs.find((entry) => entry.id === "wiki").selected, false);
  assert.equal(result.tabs.find((entry) => entry.id === "lone").role, "unmatched");
  assert.equal(JSON.stringify(result).includes("https://"), false);
  assert.equal(JSON.stringify(result).includes("?q=1"), false);
});

test("D11 leaves a key with only 1 tab unmatched, including across workspaces and pin categories", () => {
  const split = plan(
    [
      tab("a-sport", { url: "https://www.bbc.co.uk/sport/football", workspaceId: "a", workspaceName: "A" }),
      tab("b-sport", { url: "https://www.bbc.co.uk/sport/tennis", workspaceId: "b", workspaceName: "B" }),
    ],
    [],
  );
  assert.deepEqual(split.blocks, []);
  assert.deepEqual(split.order, ["a-sport", "b-sport"]);
  assert.equal(split.tabs.every((entry) => entry.role === "unmatched"), true);

  const oneGroup = plan(
    [
      tab("a1", { url: "https://www.bbc.co.uk/sport/football", workspaceId: "a", workspaceName: "A" }),
      tab("a2", { url: "https://www.bbc.co.uk/sport/tennis", workspaceId: "a", workspaceName: "A" }),
      tab("b1", { url: "https://www.bbc.co.uk/sport/rugby", workspaceId: "b", workspaceName: "B" }),
    ],
    [],
  );
  assert.deepEqual(oneGroup.blocks.map((block) => [block.workspaceId, block.tabIds, block.automatic]), [
    ["a", ["a1", "a2"], true],
  ]);
  assert.equal(oneGroup.tabs.find((entry) => entry.id === "b1").role, "unmatched");
  assert.deepEqual(oneGroup.order, ["a1", "a2", "b1"]);

  const pins = plan(
    [
      tab("pinned", { url: "https://www.bbc.co.uk/sport/football", pinned: true }),
      tab("open", { url: "https://www.bbc.co.uk/sport/tennis", pinned: false }),
    ],
    [],
  );
  assert.deepEqual(pins.blocks, []);
  assert.deepEqual(pins.order, ["pinned", "open"]);
  assert.equal(pins.tabs.every((entry) => entry.role === "unmatched"), true);
});

test("a tab that matches a user rule does not count toward an automatic group", () => {
  const sport = rule("sport-rule", "Sport pages", "www.bbc.co.uk", "/sport/football");
  const result = plan(
    [
      tab("matched", { url: "https://www.bbc.co.uk/sport/football" }),
      tab("loose", { url: "https://www.bbc.co.uk/sport/tennis" }),
    ],
    [sport],
  );

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].automatic, false);
  assert.equal(result.blocks[0].label, "Sport pages");
  assert.deepEqual(result.blocks[0].tabIds, ["matched"]);
  assert.equal(result.tabs.find((entry) => entry.id === "loose").role, "unmatched");
  assert.equal(result.tabs.find((entry) => entry.id === "loose").automatic, false);
  assert.equal(result.tabs.find((entry) => entry.id === "matched").automatic, false);
});

test("two unmatched tabs still group when another tab on that key matches a rule", () => {
  const news = rule("news", "News", "www.bbc.co.uk", "/news");
  const result = plan(
    [
      tab("sport-a", { url: "https://www.bbc.co.uk/sport/football" }),
      tab("news", { url: "https://www.bbc.co.uk/news/uk" }),
      tab("sport-b", { url: "https://www.bbc.co.uk/sport/tennis" }),
    ],
    [news],
  );

  assert.deepEqual(result.order, ["news", "sport-a", "sport-b"]);
  assert.deepEqual(result.blocks.map((block) => [block.automatic, block.label, block.tabIds]), [
    [false, "News", ["news"]],
    [true, "www.bbc.co.uk/sport", ["sport-a", "sport-b"]],
  ]);
  assert.equal(result.tabs.find((entry) => entry.id === "news").automatic, false);
  assert.equal(result.blocks[1].tabIds.includes("news"), false);
});

test("automatic groups follow user rules and sort A to Z by their key", () => {
  const docs = rule("docs", "Docs", "docs.example.com");
  const result = plan(
    [
      tab("news-a", { url: "https://example.com/news/a" }),
      tab("docs", { url: "https://docs.example.com/guide" }),
      tab("docs-path", { url: "https://example.com/docs/a" }),
      tab("news-b", { url: "https://example.com/news/b" }),
      tab("docs-path-b", { url: "https://example.com/docs/b" }),
    ],
    [docs],
  );

  assert.deepEqual(result.order, ["docs", "docs-path", "docs-path-b", "news-a", "news-b"]);
  assert.deepEqual(result.blocks.map((block) => [block.automatic, block.label, block.tabIds]), [
    [false, "Docs", ["docs"]],
    [true, "example.com/docs", ["docs-path", "docs-path-b"]],
    [true, "example.com/news", ["news-a", "news-b"]],
  ]);
  assert.equal(result.blocks[1].ruleIndex > result.blocks[0].ruleIndex, true);
  assert.equal(result.blocks[2].ruleIndex > result.blocks[1].ruleIndex, true);
});

test("a single tab follows the groups instead of holding an automatic group in place", () => {
  const docs = rule("docs", "Docs", "docs.example.com");
  const result = plan(
    [
      tab("docs", { url: "https://docs.example.com/guide" }),
      tab("lone", { url: "https://example.com/only" }),
      tab("news-a", { url: "https://example.com/news/later" }),
      tab("news-b", { url: "https://example.com/news/earlier" }),
    ],
    [docs],
  );

  assert.deepEqual(result.order, ["docs", "news-a", "news-b", "lone"]);
  assert.equal(result.tabs.find((entry) => entry.id === "lone").role, "unmatched");
  assert.equal(result.tabs.find((entry) => entry.id === "lone").plannedIndex, 3);
  assert.deepEqual(result.blocks[1].tabIds, ["news-a", "news-b"]);
});

test("the same key in 2 workspaces stays 2 blocks and does not cross the boundary", () => {
  const result = plan(
    [
      tab("a1", { url: "https://www.bbc.co.uk/sport/football", workspaceId: "a", workspaceName: "A" }),
      tab("b1", { url: "https://www.bbc.co.uk/sport/tennis", workspaceId: "b", workspaceName: "B" }),
      tab("a2", { url: "https://www.bbc.co.uk/sport/rugby", workspaceId: "a", workspaceName: "A" }),
      tab("b2", { url: "https://www.bbc.co.uk/sport/cricket", workspaceId: "b", workspaceName: "B" }),
    ],
    [],
  );

  assert.deepEqual(result.order, ["a1", "b1", "a2", "b2"]);
  assert.deepEqual(result.moves, []);
  assert.deepEqual(result.blocks.map((block) => [block.workspaceId, block.tabIds, block.automatic]), [
    ["a", ["a1", "a2"], true],
    ["b", ["b1", "b2"], true],
  ]);
  assert.equal(result.separations[0].type, "workspace");
  assert.equal(result.separations[0].label, "www.bbc.co.uk/sport");
});

test("pinned automatic groups stay inside the pinned category and are not reordered by Apply", () => {
  const result = plan(
    [
      tab("pin-b", { url: "https://example.com/news/b", pinned: true }),
      tab("pin-gap", { url: "https://example.com/only", pinned: true }),
      tab("pin-a", { url: "https://example.com/news/a", pinned: true }),
      tab("open-a", { url: "https://example.com/news/open-a", pinned: false }),
      tab("open-b", { url: "https://example.com/news/open-b", pinned: false }),
    ],
    [],
  );

  assert.deepEqual(result.order, ["pin-b", "pin-a", "pin-gap", "open-a", "open-b"]);
  assert.deepEqual(result.blocks.map((block) => [block.pinned, block.automatic, block.tabIds]), [
    [true, true, ["pin-b", "pin-a"]],
    [false, true, ["open-a", "open-b"]],
  ]);
  assert.equal(result.tabs.find((entry) => entry.id === "pin-gap").role, "unmatched");
  assert.equal(result.tabs.find((entry) => entry.id === "pin-gap").pinned, true);

  const sequence = planApplyMoves(result);
  const pinned = sequence.workspaces[0].categories.find((category) => category.pinned === true);
  const unpinned = sequence.workspaces[0].categories.find((category) => category.pinned === false);
  assert.equal(pinned.supported, false);
  assert.deepEqual(pinned.moves, []);
  assert.equal(pinned.failures.length, 2);
  assert.equal(unpinned.supported, true);
  assert.deepEqual(unpinned.moves.map((move) => move.tabId), []);
});

test("D12 false leaves unmatched tabs in their current order", () => {
  const tabs = [
    tab("sport", { url: "https://www.bbc.co.uk/sport/football" }),
    tab("wiki", { url: "https://en.wikipedia.org/wiki/London" }),
    tab("football", { url: "https://www.bbc.co.uk/sport/tennis" }),
  ];
  const off = plan(tabs, [], { groupUnmatchedTabs: false });
  assert.deepEqual(off.order, ["sport", "wiki", "football"]);
  assert.deepEqual(off.blocks, []);
  assert.equal(off.tabs.every((entry) => entry.role === "unmatched" && entry.automatic === false), true);

  const on = plan(tabs, [], { groupUnmatchedTabs: true });
  assert.deepEqual(on.order, ["sport", "football", "wiki"]);
  assert.equal(on.blocks.length, 1);
  assert.equal(on.blocks[0].automatic, true);

  const omitted = plan(tabs, []);
  assert.deepEqual(omitted.order, on.order);
  assert.equal(omitted.blocks[0].automatic, true);
});

test("a user rule label that equals an automatic key stays a separate block", () => {
  const named = rule("named", "example.com/news", "docs.example.com");
  const result = plan(
    [
      tab("rule-tab", { url: "https://docs.example.com/guide" }),
      tab("news-a", { url: "https://example.com/news/a" }),
      tab("news-b", { url: "https://example.com/news/b" }),
    ],
    [named],
  );

  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => [block.automatic, block.label, block.ruleId, block.tabIds]), [
    [false, "example.com/news", "named", ["rule-tab"]],
    [true, "example.com/news", "auto:example.com/news", ["news-a", "news-b"]],
  ]);
});

test("a rejected tab is not counted toward an automatic group", () => {
  const result = plan(
    [
      tab("sport", { url: "https://www.bbc.co.uk/sport/football" }),
      tab("opera", { url: "opera://startpage", title: "Start" }),
      tab("opera-2", { url: "opera://extensions", title: "Extensions" }),
    ],
    [],
  );

  assert.deepEqual(result.blocks, []);
  assert.equal(result.tabs.find((entry) => entry.id === "sport").role, "unmatched");
  assert.equal(result.tabs.find((entry) => entry.id === "opera").role, "rejected");
  assert.equal(result.tabs.find((entry) => entry.id === "opera-2").role, "rejected");
  assert.equal(JSON.stringify(result).includes("opera://"), false);
});
