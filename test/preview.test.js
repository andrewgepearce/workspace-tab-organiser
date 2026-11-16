import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readCurrentWindowTabs } from "../extension/browser-tabs.js";
import { startPopup } from "../extension/popup.js";
import {
  WORKSPACE_UNAVAILABLE,
  buildPreview,
  buildTabsReadFailure,
  buildUnreadableRulesPreview,
  inspectPreview,
  summariseArrangement,
} from "../extension/preview.js";
import { detectCurrentWorkspace } from "../extension/workspace.js";
import { ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY } from "../extension/rule-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewSource = readFileSync(path.join(root, "extension/preview.js"), "utf8");
const tabsSource = readFileSync(path.join(root, "extension/browser-tabs.js"), "utf8");

const productRule = {
  id: "product",
  label: "Product documentation",
  hostname: "docs.example.com",
  pathPrefix: "/product",
};
const newsRule = {
  id: "news",
  label: "News",
  hostname: "news.example",
  pathPrefix: null,
};

function tab(id, overrides = {}) {
  return {
    id,
    index: overrides.index,
    url: `https://docs.example.com/product/${id}?token=secret-token`,
    title: `Tab ${id}`,
    pinned: false,
    active: false,
    windowId: 1,
    workspaceId: "ws-research",
    workspaceName: "Research",
    ...overrides,
  };
}

function assertNoUrl(value) {
  const serialised = JSON.stringify(value);
  assert.equal(serialised.includes("http://"), false);
  assert.equal(serialised.includes("https://"), false);
  assert.equal(serialised.includes("opera:"), false);
  assert.equal(serialised.includes("secret-token"), false);
  assert.equal(serialised.includes("docs.example.com"), false);
  assert.equal(serialised.includes("news.example"), false);
  assert.equal(serialised.includes("ws-research"), false);
  assert.equal(serialised.includes("ws-personal"), false);
  assert.equal(collectKeys(value).includes("url"), false);
}

function collectKeys(value, found = []) {
  if (value === null || typeof value !== "object") {
    return found;
  }
  for (const key of Object.keys(value)) {
    found.push(key);
    collectKeys(value[key], found);
  }
  return found;
}

test("preview and tab reader stay free of network, storage and tab movement", () => {
  assert.doesNotMatch(previewSource, /node:|chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(previewSource, /tabs\.(move|create|remove|update|reload|highlight|group)|tabGroups/);
  assert.match(previewSource, /export function buildPreview/);
  assert.match(previewSource, /planArrangement/);

  assert.doesNotMatch(tabsSource, /node:|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(tabsSource, /tabs\.(move|create|remove|update|reload|highlight|group|discard|duplicate|ungroup)|tabGroups/);
  assert.match(tabsSource, /export function readCurrentWindowTabs/);
  assert.match(tabsSource, /export function readActiveWindowTabs/);
  assert.match(tabsSource, /active:\s*true/);
  assert.match(tabsSource, /export function moveTabInWorkspace/);
  assert.match(tabsSource, /export function activateTab/);
  assert.match(tabsSource, /currentWindow:\s*true/);
  assert.match(tabsSource, /index:\s*-1/);
  assert.doesNotMatch(tabsSource, /tabs\.(create|remove|reload|discard|duplicate)\b/);
});

test("blocks keep planned order across 2 workspaces, pin categories and a missing workspace", () => {
  const tabs = [
    tab("p1", { index: 0, pinned: true, title: "Pinned docs" }),
    tab("r1", { index: 1, title: "Research docs" }),
    tab("n1", {
      index: 2,
      title: "Personal news",
      url: "https://news.example/one?token=secret-token",
      workspaceId: "ws-personal",
      workspaceName: "Personal",
    }),
    tab("u1", {
      index: 3,
      title: "Unmatched personal",
      url: "https://other.example/x?token=secret-token",
      workspaceId: "ws-personal",
      workspaceName: "Personal",
    }),
    tab("n2", {
      index: 4,
      title: "More news",
      url: "https://news.example/two?token=secret-token",
      workspaceId: "ws-personal",
      workspaceName: "Personal",
    }),
    tab("m1", {
      index: 5,
      title: "No workspace docs",
      workspaceId: null,
      workspaceName: null,
    }),
    tab("o1", {
      index: 6,
      title: "Start page",
      url: "opera://startpage/secret-token",
    }),
    tab("x1", {
      index: 7,
      title: "Missing address",
      url: undefined,
    }),
  ];
  const rules = [productRule, newsRule];
  const tabsBefore = structuredClone(tabs);
  const rulesBefore = structuredClone(rules);
  const preview = buildPreview(tabs, rules);

  assert.deepEqual(tabs, tabsBefore);
  assert.deepEqual(rules, rulesBefore);
  assert.equal(preview.ok, true);
  assert.equal(preview.status, "ready");
  assert.equal(preview.heading, "Preview");
  assert.equal(preview.note, null);
  assert.match(preview.message, /^\d+ tabs? to move into \d+ groups?, \d+ unmatched$/);
  assert.deepEqual(
    preview.blocks.map((block) => [block.label, block.workspaceName, block.category, block.titles]),
    [
      ["Product documentation", "Research", "Pinned", ["Pinned docs"]],
      ["Product documentation", "Research", "Unpinned", ["Research docs"]],
      ["News", "Personal", "Unpinned", ["Personal news", "More news"]],
      ["Product documentation", WORKSPACE_UNAVAILABLE, "Unpinned", ["No workspace docs"]],
    ],
  );
  assert.deepEqual(preview.unmatched, [{ title: "Unmatched personal" }]);
  assert.deepEqual(preview.unavailable, [
    { title: "Start page", detail: "Not an HTTP or HTTPS page" },
    { title: "Missing address", detail: "URL unavailable" },
  ]);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.blocks[0]), true);
  assertNoUrl(preview);
});

test("a blank workspace name and a blank title use the fallback text", () => {
  const preview = buildPreview(
    [
      tab("only", {
        title: "   ",
        workspaceId: "",
        workspaceName: "   ",
        url: "https://docs.example.com/product/only",
      }),
    ],
    [productRule],
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.blocks[0].workspaceName, WORKSPACE_UNAVAILABLE);
  assert.deepEqual(preview.blocks[0].titles, ["Untitled tab"]);
  assertNoUrl(preview);
});

test("block titles follow planned order rather than the original gaps", () => {
  const preview = buildPreview(
    [
      tab("u1", { title: "First other", url: "https://example.com/u1" }),
      tab("a", { title: "Alpha", url: "https://docs.example.com/product/a" }),
      tab("u2", { title: "Second other", url: "https://example.com/u2" }),
      tab("b", { title: "Beta", url: "https://docs.example.com/product/b" }),
    ],
    [productRule],
  );
  assert.deepEqual(preview.blocks[0].titles, ["Alpha", "Beta"]);
  assert.deepEqual(preview.unmatched.map((entry) => entry.title), ["First other", "Second other"]);
  assertNoUrl(preview);
});

test("no saved rules with the default rule off does not list tab titles", () => {
  const preview = buildPreview(
    [tab("secret", { title: "Should stay hidden", url: "https://docs.example.com/product/secret-token" })],
    [],
    { groupUnmatchedTabs: false },
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.status, "no-rules");
  assert.equal(preview.message, "No rules are saved. Add rules on the options page, then open this preview again.");
  assert.deepEqual(preview.blocks, []);
  assert.deepEqual(preview.unmatched, []);
  assert.deepEqual(preview.unavailable, []);
  assert.equal(JSON.stringify(preview).includes("Should stay hidden"), false);
  assertNoUrl(preview);
});

test("no saved rules with the default rule on groups by the key and leaves a singleton unmatched", () => {
  const preview = buildPreview(
    [
      tab("sport", { title: "BBC Sport", url: "https://www.bbc.co.uk/sport?token=secret-token" }),
      tab("wiki", { title: "London", url: "https://en.wikipedia.org/wiki/London?token=secret-token" }),
      tab("football", { title: "Football", url: "https://www.bbc.co.uk/sport/football?token=secret-token" }),
      tab("lone", { title: "Example", url: "https://example.com/?token=secret-token" }),
    ],
    [],
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.blocks.length, 1);
  assert.equal(preview.blocks[0].kind, "automatic");
  assert.equal(preview.blocks[0].label, "www.bbc.co.uk/sport");
  assert.deepEqual(preview.blocks[0].titles, ["BBC Sport", "Football"]);
  assert.deepEqual(preview.unmatched.map((entry) => entry.title), ["Example", "London"]);
  assert.equal(JSON.stringify(preview).includes("https://"), false);
  assert.equal(JSON.stringify(preview).includes("secret-token"), false);
  assert.equal(JSON.stringify(preview).includes("token="), false);
});

test("no matching tabs still lists unmatched and ineligible tabs", () => {
  const preview = buildPreview(
    [
      tab("plain", { title: "Other site", url: "https://example.com/plain?token=secret-token", workspaceName: "Research" }),
      tab("opera", { title: "Extensions", url: "opera://extensions" }),
    ],
    [productRule],
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.status, "no-matches");
  assert.equal(preview.message, "0 tabs to move into 0 groups, 1 unmatched");
  assert.equal(preview.message.includes("No tabs in this window match the saved rules"), false);
  assert.deepEqual(preview.blocks, []);
  assert.deepEqual(preview.unmatched, [{ title: "Other site" }]);
  assert.deepEqual(preview.unavailable, [{ title: "Extensions", detail: "Not an HTTP or HTTPS page" }]);
  assertNoUrl(preview);
});

test("the summary uses the plural that matches each count", () => {
  assert.equal(summariseArrangement(1, 1, 1), "1 tab to move into 1 group, 1 unmatched");
  assert.equal(summariseArrangement(4, 2, 3), "4 tabs to move into 2 groups, 3 unmatched");
  assert.equal(summariseArrangement(0, 0, 0), "0 tabs to move into 0 groups, 0 unmatched");
});

test("a planned preview summarises the tabs that would move", () => {
  const one = buildPreview(
    [
      tab("anchor", { index: 0, title: "Anchor", url: "https://docs.example.com/product/a" }),
      tab("other", { index: 1, title: "Other", url: "https://example.com/other" }),
      tab("member", { index: 2, title: "Member", url: "https://docs.example.com/product/b" }),
    ],
    [productRule],
  );
  assert.equal(one.status, "ready");
  assert.equal(one.message, "2 tabs to move into 1 group, 1 unmatched");

  const twoGroups = buildPreview(
    [
      tab("other-a", { index: 0, title: "Guide", url: "https://docs.example.com/guide" }),
      tab("product-a", { index: 1, title: "Install", url: "https://docs.example.com/product/install" }),
      tab("other-b", { index: 2, title: "Reference", url: "https://docs.example.com/reference" }),
      tab("product-b", { index: 3, title: "Setup", url: "https://docs.example.com/product/setup" }),
    ],
    [
      productRule,
      { id: "other", label: "Other documentation", hostname: "docs.example.com", pathPrefix: null },
    ],
  );
  assert.equal(twoGroups.message, "4 tabs to move into 2 groups, 0 unmatched");
});

test("automatic groups are counted in the summary instead of the old no-match sentence", () => {
  const preview = buildPreview(
    [
      tab("sport", { index: 1, title: "BBC Sport", url: "https://www.bbc.co.uk/sport" }),
      tab("wiki", { index: 0, title: "London", url: "https://en.wikipedia.org/wiki/London" }),
      tab("football", { index: 2, title: "Football", url: "https://www.bbc.co.uk/sport/football" }),
    ],
    [productRule],
  );
  assert.equal(preview.blocks.length, 1);
  assert.equal(preview.blocks[0].kind, "automatic");
  assert.equal(preview.message, "2 tabs to move into 1 group, 1 unmatched");
  assert.equal(preview.message.includes("No tabs in this window match the saved rules"), false);
  assert.equal(preview.message.includes("No tabs in this window were grouped"), false);
});

test("a detected workspace is the only one planned and named in the heading", () => {
  const tabs = [
    tab("home", { index: 0, title: "Home news", url: "https://news.example/home", workspaceId: "9", workspaceName: "Test A" }),
    tab("tech", { index: 1, title: "Tech news", url: "https://news.example/tech", workspaceId: "9", workspaceName: "Test A" }),
    tab("weather", { index: 2, title: "Weather", url: "https://news.example/weather", workspaceId: "10", workspaceName: "Test B" }),
    tab("other", { index: 3, title: "Other site", url: "https://example.com/other", workspaceId: "10", workspaceName: "Test B" }),
  ];
  const active = [
    { workspaceId: "9", workspaceName: "Test A", lastAccessed: 1794315478421.848 },
    { workspaceId: "10", workspaceName: "Test B", lastAccessed: 1794241057999 },
  ];
  const scope = detectCurrentWorkspace(active);
  const before = structuredClone(tabs);
  const inspected = inspectPreview(tabs, [newsRule], { scope });
  assert.deepEqual(tabs, before);
  assert.equal(inspected.preview.heading, "Test A");
  assert.equal(inspected.preview.note, null);
  assert.equal(inspected.preview.status, "ready");
  assert.deepEqual(inspected.preview.blocks.map((block) => block.titles), [["Home news", "Tech news"]]);
  assert.deepEqual(inspected.preview.unmatched, []);
  assert.equal(JSON.stringify(inspected.preview).includes("Weather"), false);
  assert.equal(JSON.stringify(inspected.preview).includes("Test B"), false);
  assert.equal(inspected.plan.tabs.every((entry) => entry.workspaceId === "9"), true);
  assert.equal(inspected.fingerprint.workspaces.length, 1);
  assert.equal(inspected.fingerprint.workspaces[0].workspaceId, "9");
});

test("a missing lastAccessed falls back to every workspace and says so", () => {
  const tabs = [
    tab("home", { index: 0, title: "Home news", url: "https://news.example/home", workspaceId: "9", workspaceName: "Test A" }),
    tab("weather", { index: 1, title: "Weather", url: "https://news.example/weather", workspaceId: "10", workspaceName: "Test B" }),
  ];
  const scope = detectCurrentWorkspace([
    { workspaceId: "9", workspaceName: "Test A" },
    { workspaceId: "10", workspaceName: "Test B", lastAccessed: null },
  ]);
  const preview = buildPreview(tabs, [newsRule], { scope });
  assert.equal(scope.mode, "window");
  assert.equal(preview.heading, "This window");
  assert.match(preview.note, /could not be detected/);
  assert.match(preview.note, /every workspace/);
  assert.deepEqual(preview.blocks.map((block) => block.workspaceName), ["Test A", "Test B"]);
});

test("an empty window with saved rules reports no matches", () => {
  const preview = buildPreview([], [productRule]);
  assert.equal(preview.status, "no-matches");
  assert.deepEqual(preview.blocks, []);
  assert.deepEqual(preview.unmatched, []);
  assert.deepEqual(preview.unavailable, []);
});

test("corrupt stored rules are described without echoing the stored value", () => {
  const preview = buildUnreadableRulesPreview();
  assert.equal(preview.ok, false);
  assert.equal(preview.status, "unreadable-rules");
  assert.equal(preview.reason, "unreadable");
  assert.match(preview.message, /could not be read/);
  assert.equal(JSON.stringify(preview).includes("secret-token"), false);
  assert.deepEqual(preview.blocks, []);
});

test("planner failures use plain language and do not echo URLs", () => {
  const secretUrl = "https://user:secret-token@docs.example.com/product?token=secret-token";
  const validTab = (id, overrides = {}) => tab(id, { url: secretUrl, title: "Hidden title", ...overrides });
  const cases = [
    {
      name: "invalid-rules",
      tabs: [validTab("a")],
      rules: [{ label: "Missing id", hostname: "docs.example.com", secret: "secret-token" }],
      reason: "invalid-rules",
      message: "The saved rules are not valid, so no preview was planned.",
    },
    {
      name: "invalid-tab",
      tabs: [null],
      rules: [productRule],
      reason: "invalid-tab",
      message: "The tab at position 1 could not be read, so no preview was planned.",
    },
    {
      name: "duplicate-tab-id",
      tabs: [validTab("same"), validTab("same")],
      rules: [productRule],
      reason: "duplicate-tab-id",
      message: "A tab at position 2 repeats an earlier identifier, so no preview was planned.",
    },
    {
      name: "mixed-window",
      tabs: [validTab("a", { windowId: 1 }), validTab("b", { windowId: 2 })],
      rules: [productRule],
      reason: "mixed-window",
      message: "A tab at position 2 is from a different window, so no preview was planned.",
    },
    {
      name: "pinned-boundary",
      tabs: [validTab("loose", { pinned: false }), validTab("pin", { pinned: true })],
      rules: [productRule],
      reason: "pinned-boundary",
      message: "A pinned tab at position 2 sits after an unpinned tab in the same workspace, so no preview was planned.",
    },
    {
      name: "multiple-active",
      tabs: [validTab("a", { active: true }), validTab("b", { active: true })],
      rules: [productRule],
      reason: "multiple-active",
      message: "The extra active tab is at position 2 in the same workspace, so no preview was planned.",
    },
  ];

  for (const item of cases) {
    const preview = buildPreview(item.tabs, item.rules);
    assert.equal(preview.ok, false, item.name);
    assert.equal(preview.status, "failed", item.name);
    assert.equal(preview.reason, item.reason, item.name);
    assert.equal(preview.message, item.message, item.name);
    assert.deepEqual(preview.blocks, [], item.name);
    assert.equal(preview.message.includes(";"), false, item.name);
    assertNoUrl(preview);
    assert.equal(JSON.stringify(preview).includes("Hidden title"), false, item.name);
  }

  const unread = buildPreview(null, [productRule]);
  assert.deepEqual(unread, buildTabsReadFailure());
  assert.equal(unread.message, "The current window could not be read, so no preview was planned.");
});

function operaWindowTabs() {
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
    { index: 4, pinned: false, active: true, workspaceId: "5", workspaceName: "Lucid", title: "Speed Dial", url: "opera://startpage" },
    { index: 3, pinned: false, active: true, workspaceId: "6", workspaceName: "Atlassian", title: "Speed Dial", url: "opera://startpage" },
    { index: 5, pinned: false, active: true, workspaceId: "8", workspaceName: "LinkedIn", title: "Speed Dial", url: "opera://startpage" },
    { index: 13, pinned: false, active: false, workspaceId: "10", workspaceName: "Test B", title: "BBC Weather - Home", url: "https://www.bbc.co.uk/weather" },
    { index: 14, pinned: false, active: false, workspaceId: "10", workspaceName: "Test B", title: "Tab (interface) - Wikipedia", url: "https://en.wikipedia.org/wiki/Tab_(interface)" },
    { index: 15, pinned: false, active: true, workspaceId: "10", workspaceName: "Test B", title: "Example Domain", url: "https://example.org/" },
  ];
  return rows.map((row) => ({ ...row, id: `i${row.index}`, windowId: 1 }));
}

const operaRules = [
  { id: "bbc-news", label: "BBC News", hostname: "www.bbc.co.uk", pathPrefix: "/news" },
  { id: "bbc", label: "BBC", hostname: "www.bbc.co.uk", pathPrefix: "/" },
  { id: "wiki", label: "Wikipedia", hostname: "en.wikipedia.org", pathPrefix: "/" },
];

test("Andrew's Opera window plans after sorting the query into window index order", async () => {
  const queried = operaWindowTabs();
  assert.equal(queried.find((entry) => entry.workspaceName === "Lucid").index, 4);
  assert.ok(queried.findIndex((entry) => entry.workspaceName === "Lucid") < queried.findIndex((entry) => entry.workspaceName === "Atlassian"));

  const sorted = await readCurrentWindowTabs({
    tabs: {
      query(_queryInfo, callback) {
        callback(queried);
      },
    },
  });
  assert.deepEqual(sorted.map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(sorted[3].workspaceName, "Atlassian");
  assert.equal(sorted[4].workspaceName, "Lucid");
  assert.equal(sorted[6].pinned, true);

  const preview = buildPreview(sorted, operaRules);
  assert.equal(preview.status, "ready");
  assert.deepEqual(
    preview.blocks.map((block) => [block.label, block.workspaceName, block.category, block.titles]),
    [
      ["Wikipedia", "Test A", "Pinned", ["Opera (web browser) - Wikipedia"]],
      ["BBC News", "Test A", "Unpinned", ["Home - BBC News", "Technology | Latest News & Updates | BBC News"]],
      ["BBC", "Test A", "Unpinned", ["BBC Sport - Scores, Fixtures, News - Live Sport"]],
      ["Wikipedia", "Test A", "Unpinned", ["London - Wikipedia"]],
      ["BBC", "Test B", "Unpinned", ["BBC Weather - Home"]],
      ["Wikipedia", "Test B", "Unpinned", ["Tab (interface) - Wikipedia"]],
    ],
  );
  assert.deepEqual(preview.unmatched, [{ title: "Example Domain" }, { title: "Example Domain" }]);
  assert.deepEqual(preview.unavailable, [
    { title: "Extensions", detail: "Not an HTTP or HTTPS page" },
    { title: "Speed Dial", detail: "Not an HTTP or HTTPS page" },
    { title: "Speed Dial", detail: "Not an HTTP or HTTPS page" },
    { title: "Speed Dial", detail: "Not an HTTP or HTTPS page" },
    { title: "Speed Dial", detail: "Not an HTTP or HTTPS page" },
    { title: "Speed Dial", detail: "Not an HTTP or HTTPS page" },
    { title: "Extensions", detail: "Not an HTTP or HTTPS page" },
  ]);
  assertNoUrl(preview);
});

test("1 active tab in each of 2 workspaces still produces a preview", () => {
  const tabs = [];
  for (let index = 0; index < 21; index += 1) {
    const secondWorkspace = index >= 11;
    tabs.push(
      tab(`t${index}`, {
        url: "https://example.com/page",
        title: `Page ${index}`,
        workspaceId: secondWorkspace ? "ws-personal" : "ws-research",
        workspaceName: secondWorkspace ? "Personal" : "Research",
        active: index === 0 || index === 20,
      }),
    );
  }
  const preview = buildPreview(tabs, [productRule]);
  assert.equal(preview.ok, true);
  assert.equal(preview.status, "ready");
  assert.equal(preview.reason, null);
  assert.deepEqual(preview.blocks.map((block) => [block.label, block.titles.length]), [
    ["example.com/page", 11],
    ["example.com/page", 10],
  ]);
  assert.deepEqual(preview.unmatched, []);
  assertNoUrl(preview);
});

test("a throwing URL getter is ineligible and its secret stays out of the preview", () => {
  const hidden = tab("hidden", { title: "Guarded" });
  Object.defineProperty(hidden, "url", {
    get() {
      throw new Error("secret-token");
    },
  });
  const preview = buildPreview([hidden], [productRule]);
  assert.equal(preview.status, "no-matches");
  assert.deepEqual(preview.unavailable, [{ title: "Guarded", detail: "URL unavailable" }]);
  assertNoUrl(preview);
});

test("readCurrentWindowTabs queries only the current window and orders by index", async () => {
  const calls = [];
  const tabs = [
    tab("later", { index: 2, title: "Later" }),
    tab("first", { index: 0, title: "First" }),
    tab("middle", { index: 1, title: "Middle" }),
  ];
  const browser = {
    runtime: { lastError: null },
    tabs: {
      query(queryInfo, callback) {
        calls.push({ queryInfo, thisValue: this });
        callback(tabs);
      },
    },
  };

  const read = await readCurrentWindowTabs(browser);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].queryInfo, { currentWindow: true });
  assert.equal(calls[0].thisValue, browser.tabs);
  assert.deepEqual(read.map((entry) => entry.id), ["first", "middle", "later"]);
  assert.deepEqual(tabs.map((entry) => entry.id), ["later", "first", "middle"]);
});

test("query keeps returned order when an index is missing and ignores a repeated promise", async () => {
  let callbacks = 0;
  const browser = {
    runtime: {},
    tabs: {
      query(_queryInfo, callback) {
        const tabs = [tab("b", { index: 0 }), tab("a")];
        delete tabs[1].index;
        callback(tabs);
        callbacks += 1;
        return Promise.resolve([tab("ignored", { index: 0 })]);
      },
    },
  };
  const read = await readCurrentWindowTabs(browser);
  assert.equal(callbacks, 1);
  assert.deepEqual(read.map((entry) => entry.id), ["b", "a"]);
});

test("a promise-only query is accepted once", async () => {
  const browser = {
    tabs: {
      query(queryInfo) {
        assert.deepEqual(queryInfo, { currentWindow: true });
        return Promise.resolve([tab("only", { index: 3 })]);
      },
    },
  };
  const read = await readCurrentWindowTabs(browser);
  assert.deepEqual(read.map((entry) => entry.id), ["only"]);
});

test("query failure does not copy the browser error text", async () => {
  const browser = {
    runtime: { lastError: { message: "https://secret.example/secret-token" } },
    tabs: {
      query(_queryInfo, callback) {
        callback([tab("nope")]);
        return Promise.resolve([tab("nope")]);
      },
    },
  };
  await assert.rejects(readCurrentWindowTabs(browser), (error) => {
    assert.equal(error.message, "tabs query failed");
    assert.equal(String(error).includes("secret-token"), false);
    assert.equal(String(error).includes("https://"), false);
    return true;
  });
});

test("a missing query method fails closed", async () => {
  await assert.rejects(readCurrentWindowTabs({ tabs: {} }), /tabs query is not available/);
  await assert.rejects(readCurrentWindowTabs(null), /tabs query is not available/);
});

const popupManifest = {
  name: "Workspace Tab Organiser",
  version: "0.3.0",
  manifest_version: 2,
  description: "Read-only preview of this window using locally saved rules.",
};

const mutatingTabMethods = ["move", "update", "create", "remove", "reload", "highlight", "group", "discard", "duplicate", "ungroup"];

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
        if (node.parent) {
          node.remove();
        }
        node.parent = this;
        this.children.push(node);
      }
    },
    remove() {
      if (!this.parent) {
        return;
      }
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    },
    replaceChildren() {
      for (const child of this.children) {
        child.parent = null;
      }
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
  const specs = [
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
  ];
  for (const [id, tag] of specs) {
    const element = makeElement(tag);
    element.id = id;
    root.append(element);
  }
  const options = makeElement("a");
  options.id = "options";
  options.href = "options.html";
  options.textContent = "Options";
  root.append(options);
  document.getElementById("cancel").textContent = "Cancel";
  document.getElementById("cancel").type = "button";
  document.getElementById("apply").textContent = "Apply";
  document.getElementById("apply").type = "button";
  document.getElementById("apply").disabled = true;
  document.getElementById("report").hidden = true;
  return document;
}

function createWindow() {
  return {
    closed: 0,
    close() {
      this.closed += 1;
    },
    location: {
      assigned: [],
      assign(url) {
        this.assigned.push(url);
      },
    },
  };
}

function callbackArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    sets: [],
    get(key, callback) {
      const items = Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {};
      callback(items);
    },
    set(items, callback) {
      this.sets.push(structuredClone(items));
      Object.assign(data, structuredClone(items));
      callback();
    },
  };
}

function recordingBrowser(tabsResult, options = {}) {
  const calls = [];
  const tabsApi = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }
        const method = String(property);
        return (...args) => {
          calls.push({
            api: "tabs",
            method,
            queryInfo: method === "query" ? args[0] : null,
          });
          if (method !== "query") {
            return undefined;
          }
          const callback = args.find((arg) => typeof arg === "function");
          let payload = tabsResult.map((entry) => ({ ...entry }));
          if (args[0] && args[0].active === true) {
            payload = payload.filter((entry) => entry.active === true);
          }
          if (callback) {
            callback(payload);
            return undefined;
          }
          return Promise.resolve(payload);
        };
      },
    },
  );
  const runtime = {
    lastError: null,
    getURL(resource) {
      calls.push({ api: "runtime", method: "getURL" });
      return `chrome-extension://preview-test/${resource}`;
    },
    openOptionsPage: options.omitOpen
      ? undefined
      : (callback) => {
          calls.push({ api: "runtime", method: "openOptionsPage" });
          if (options.failOpen) {
            runtime.lastError = { message: "https://secret.example/secret-token" };
          }
          if (typeof callback === "function") {
            callback();
          }
        },
  };
  return { calls, browser: { tabs: tabsApi, runtime } };
}

function click(element) {
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  for (const listener of element.listeners.click || []) {
    listener(event);
  }
  return event;
}

function texts(node) {
  const values = [node.textContent];
  for (const child of node.children) {
    values.push(...texts(child));
  }
  return values.filter((value) => value !== "");
}

function pageText(document) {
  return ["heading", "scope-note", "status", "blocks", "unmatched", "unavailable", "apply-reason", "name", "version"].map((id) => texts(document.getElementById(id)).join("\n")).join("\n");
}

function savedRules() {
  return {
    [ORGANISER_RULES_KEY]: [productRule, newsRule],
  };
}

function previewTabs() {
  return [
    tab("p1", { index: 0, pinned: true, title: "Pinned docs" }),
    tab("r1", { index: 1, title: "Research docs" }),
    tab("n1", {
      index: 2,
      title: "Personal news",
      url: "https://news.example/one?token=secret-token",
      workspaceId: "ws-personal",
      workspaceName: "Personal",
    }),
    tab("u1", {
      index: 3,
      title: "Unmatched personal",
      url: "https://other.example/x?token=secret-token",
      workspaceId: "ws-personal",
      workspaceName: "Personal",
    }),
    tab("m1", {
      index: 4,
      title: "No workspace docs",
      workspaceId: null,
      workspaceName: " ",
    }),
    tab("o1", {
      index: 5,
      title: "Start page",
      url: "opera://startpage/secret-token",
    }),
    tab("x1", {
      index: 6,
      title: "Missing address",
      url: undefined,
    }),
  ];
}

function isWindowQuery(queryInfo) {
  if (!queryInfo || queryInfo.currentWindow !== true) {
    return false;
  }
  const keys = Object.keys(queryInfo);
  if (keys.length === 1) {
    return true;
  }
  return keys.length === 2 && queryInfo.active === true;
}

function assertPreviewQueries(calls) {
  assert.deepEqual(
    calls.filter((call) => call.api === "tabs").map((call) => call.queryInfo),
    [
      { active: true, currentWindow: true },
      { currentWindow: true },
    ],
  );
}

function assertReadOnly(calls, area) {
  const tabCalls = calls.filter((call) => call.api === "tabs");
  assert.equal(tabCalls.every((call) => call.method === "query"), true);
  for (const call of tabCalls) {
    assert.equal(isWindowQuery(call.queryInfo), true, JSON.stringify(call.queryInfo));
  }
  for (const method of mutatingTabMethods) {
    assert.equal(calls.some((call) => call.method === method), false, method);
  }
  assert.deepEqual(area.sets, []);
}

test("OTO-010 generating, rendering and cancelling a preview makes no mutating tab call", async () => {
  const area = callbackArea(savedRules());
  const recorded = recordingBrowser(previewTabs());
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });

  const rendered = pageText(document);
  assert.match(rendered, /Pinned docs/);
  assert.match(rendered, /Research docs/);
  assert.match(rendered, /Personal news/);
  assert.match(rendered, /Research/);
  assert.match(rendered, /Personal/);
  assert.match(rendered, /Workspace unavailable/);
  assert.match(rendered, /Pinned/);
  assert.match(rendered, /Rule/);
  assert.match(rendered, /Unmatched \(1\)/);
  assert.match(rendered, /Unmatched personal/);
  assert.match(rendered, /1 non-web tab ignored/);
  assert.match(rendered, /Start page/);
  assert.match(rendered, /1 tab with no address/);
  assert.match(rendered, /Missing address/);
  assert.equal(rendered.includes("secret-token"), false);
  assert.equal(rendered.includes("https://"), false);
  assert.equal(rendered.includes("opera:"), false);
  assert.equal(rendered.includes("ws-research"), false);
  assert.equal(rendered.includes("Manifest"), false);
  assert.equal(document.getElementById("name").textContent, "Workspace Tab Organiser");
  assert.equal(document.getElementById("version").textContent, "0.3.0");
  assert.equal(document.getElementById("options").textContent, "Options");
  assert.equal(document.getElementById("apply").textContent, "Apply");
  assert.equal(document.getElementById("cancel").textContent, "Cancel");

  assertReadOnly(recorded.calls, area);
  click(document.getElementById("cancel"));
  assert.equal(window.closed, 1);
  assertReadOnly(recorded.calls, area);
  assertPreviewQueries(recorded.calls);
});

test("no saved rules with the default rule on queries tabs and shows an automatic group", async () => {
  const area = callbackArea({});
  const recorded = recordingBrowser([
    tab("sport", { index: 0, title: "BBC Sport", url: "https://www.bbc.co.uk/sport?token=secret-token" }),
    tab("wiki", { index: 1, title: "London", url: "https://en.wikipedia.org/wiki/London?token=secret-token" }),
    tab("football", { index: 2, title: "Football", url: "https://www.bbc.co.uk/sport/football?token=secret-token" }),
    tab("lone", { index: 3, title: "Example", url: "https://example.com/?token=secret-token" }),
  ]);
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });

  const rendered = pageText(document);
  assert.match(rendered, /Automatic/);
  assert.match(rendered, /www\.bbc\.co\.uk\/sport/);
  assert.match(rendered, /BBC Sport/);
  assert.match(rendered, /Football/);
  assert.match(rendered, /Unmatched \(2\)/);
  assert.match(rendered, /London/);
  assert.match(rendered, /Example/);
  assert.equal(document.getElementById("options").textContent, "Options");
  assert.equal(document.getElementById("apply").disabled, false);
  assert.equal(document.getElementById("apply-reason").textContent, "");
  assert.equal(rendered.includes("https://"), false);
  assert.equal(rendered.includes("secret-token"), false);
  assertReadOnly(recorded.calls, area);
  assertPreviewQueries(recorded.calls);

  const event = click(document.getElementById("options"));
  assert.equal(event.prevented, true);
  assert.equal(recorded.calls.some((call) => call.method === "openOptionsPage"), true);
  assert.deepEqual(window.location.assigned, []);
  click(document.getElementById("cancel"));
  assert.equal(window.closed, 1);
  assertReadOnly(recorded.calls, area);
});

test("no saved rules with the default rule off does not query tabs", async () => {
  const area = callbackArea({
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: false },
  });
  const recorded = recordingBrowser([tab("secret", { title: "Should stay hidden" })]);
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });

  assert.match(document.getElementById("status").textContent, /No rules are saved/);
  assert.equal(document.getElementById("apply").disabled, true);
  assert.equal(document.getElementById("apply-reason").textContent, "No rules saved");
  assert.equal(document.getElementById("options").textContent, "Options");
  assert.equal(document.getElementById("blocks").children.length, 0);
  assert.equal(pageText(document).includes("Should stay hidden"), false);
  assert.equal(pageText(document).includes("secret-token"), false);
  assertReadOnly(recorded.calls, area);
  assert.equal(recorded.calls.some((call) => call.api === "tabs"), false);
  click(document.getElementById("cancel"));
  assert.equal(window.closed, 1);
});

test("a missing openOptionsPage leaves the options URL on the link", async () => {
  const area = callbackArea({});
  const recorded = recordingBrowser([], { omitOpen: true });
  const document = createPopupDocument();
  await startPopup({
    document,
    window: createWindow(),
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });
  const event = click(document.getElementById("options"));
  assert.equal(event.prevented, false);
  assert.equal(document.getElementById("options").href, "chrome-extension://preview-test/options.html");
  assert.equal(recorded.calls.some((call) => call.method === "openOptionsPage"), false);
});

test("a failed openOptionsPage falls back to the options URL without copying the error", async () => {
  const area = callbackArea({});
  const recorded = recordingBrowser([], { failOpen: true });
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });
  click(document.getElementById("options"));
  assert.deepEqual(window.location.assigned, ["chrome-extension://preview-test/options.html"]);
  assert.equal(pageText(document).includes("secret-token"), false);
  assert.equal(pageText(document).includes("https://"), false);
});

test("corrupt stored rules explain the failure and do not query or write", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [{ label: "Missing id", hostname: "https://user:secret-token@example.com" }],
  });
  const recorded = recordingBrowser([tab("a")]);
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });

  assert.match(document.getElementById("status").textContent, /could not be read/);
  assert.equal(document.getElementById("apply").disabled, true);
  assert.equal(document.getElementById("apply-reason").textContent, "Rules could not be read");
  assert.equal(pageText(document).includes("secret-token"), false);
  assert.equal(recorded.calls.some((call) => call.api === "tabs"), false);
  assert.deepEqual(area.sets, []);
  assert.deepEqual(area.data[ORGANISER_RULES_KEY], [{ label: "Missing id", hostname: "https://user:secret-token@example.com" }]);
  click(document.getElementById("cancel"));
  assert.equal(window.closed, 1);
  assert.deepEqual(area.sets, []);
});

test("a pinned-boundary plan is explained in the popup and still makes no move", async () => {
  const area = callbackArea(savedRules());
  const recorded = recordingBrowser([
    tab("loose", { index: 0, pinned: false, title: "Loose docs", url: "https://docs.example.com/product/a?token=secret-token" }),
    tab("pin", { index: 1, pinned: true, title: "Late pin", url: "https://docs.example.com/product/b?token=secret-token" }),
  ]);
  const document = createPopupDocument();
  const window = createWindow();
  await startPopup({
    document,
    window,
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });

  assert.equal(
    document.getElementById("status").textContent,
    "A pinned tab at position 2 sits after an unpinned tab in the same workspace, so no preview was planned.",
  );
  assert.equal(document.getElementById("blocks").children.length, 0);
  assert.equal(pageText(document).includes("secret-token"), false);
  assert.equal(pageText(document).includes("Loose docs"), false);
  assertReadOnly(recorded.calls, area);
  click(document.getElementById("cancel"));
  assert.equal(window.closed, 1);
  assertPreviewQueries(recorded.calls);
});

function findClass(node, className) {
  if (node.className === className) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findClass(child, className);
    if (found) {
      return found;
    }
  }
  return null;
}

test("D22 renders compact cards, collapsed lists and a reason when nothing would move", async () => {
  const longTitle = "Home - BBC News with a title that is longer than one popup line";
  const moving = callbackArea({ [ORGANISER_RULES_KEY]: [newsRule] });
  const movingBrowser = recordingBrowser([
    tab("news-a", { index: 0, title: longTitle, url: "https://news.example/home" }),
    tab("other", { index: 1, title: "Example", url: "https://example.com/plain" }),
    tab("news-b", { index: 2, title: "More news", url: "https://news.example/more" }),
    tab("speed", { index: 3, title: "Speed Dial", url: "opera://startpage" }),
    tab("extensions", { index: 4, title: "Extensions", url: "opera://extensions" }),
    tab("blank", { index: 5, title: "Missing address", url: undefined }),
  ]);
  const movingDocument = createPopupDocument();
  await startPopup({
    document: movingDocument,
    window: createWindow(),
    browser: movingBrowser.browser,
    local: moving,
    manifest: popupManifest,
  });

  assert.equal(movingDocument.getElementById("status").textContent, "2 tabs to move into 1 group, 1 unmatched");
  assert.equal(movingDocument.getElementById("apply").disabled, false);
  assert.equal(movingDocument.getElementById("apply-reason").textContent, "");
  const card = movingDocument.getElementById("blocks").children[0];
  assert.equal(card.className, "group-card");
  assert.match(texts(card).join("\n"), /News/);
  assert.match(texts(card).join("\n"), /Rule/);
  assert.match(texts(card).join("\n"), /2 tabs/);
  const title = findClass(card, "tab-title");
  assert.equal(title.textContent, longTitle);
  assert.equal(title.title, longTitle);
  const unmatched = movingDocument.getElementById("unmatched").children[0];
  assert.equal(unmatched.tag, "details");
  assert.equal(unmatched.open, undefined);
  assert.equal(unmatched.children[0].textContent, "Unmatched (1)");
  assert.match(texts(unmatched).join("\n"), /Example/);
  const ignored = movingDocument.getElementById("unavailable").children;
  assert.equal(ignored[0].tag, "details");
  assert.equal(ignored[0].open, undefined);
  assert.equal(ignored[0].children[0].textContent, "2 non-web tabs ignored");
  assert.match(texts(ignored[0]).join("\n"), /Speed Dial/);
  assert.match(texts(ignored[0]).join("\n"), /Extensions/);
  assert.equal(ignored[1].children[0].textContent, "1 tab with no address");
  assert.match(texts(ignored[1]).join("\n"), /Missing address/);
  assert.equal(pageText(movingDocument).includes("https://"), false);
  assert.equal(pageText(movingDocument).includes("opera:"), false);

  const still = callbackArea({ [ORGANISER_RULES_KEY]: [newsRule] });
  const stillBrowser = recordingBrowser([
    tab("news-a", { index: 0, title: "Home", url: "https://news.example/home" }),
    tab("news-b", { index: 1, title: "More", url: "https://news.example/more" }),
    tab("other", { index: 2, title: "Example", url: "https://example.com/plain" }),
  ]);
  const stillDocument = createPopupDocument();
  await startPopup({
    document: stillDocument,
    window: createWindow(),
    browser: stillBrowser.browser,
    local: still,
    manifest: popupManifest,
  });
  assert.equal(stillDocument.getElementById("status").textContent, "0 tabs to move into 0 groups, 1 unmatched");
  assert.equal(stillDocument.getElementById("apply").disabled, true);
  assert.equal(stillDocument.getElementById("apply-reason").textContent, "Nothing to move");
  assert.equal(stillDocument.getElementById("name").textContent, "Workspace Tab Organiser");
  assert.equal(stillDocument.getElementById("version").textContent, "0.3.0");
  assert.equal(stillDocument.getElementById("options").textContent, "Options");
  assert.equal(pageText(stillDocument).includes(popupManifest.description), false);
});

test("the popup names the current workspace and drops the other one", async () => {
  const tabs = [
    tab("a-news", {
      index: 1,
      active: true,
      workspaceId: "9",
      workspaceName: "Test A",
      title: "Home news",
      url: "https://news.example/home",
      lastAccessed: 1794315478421.848,
    }),
    tab("a-other", {
      index: 2,
      active: false,
      workspaceId: "9",
      workspaceName: "Test A",
      title: "Example in A",
      url: "https://example.com/a",
    }),
    tab("b-news", {
      index: 0,
      active: true,
      workspaceId: "10",
      workspaceName: "Test B",
      title: "Weather",
      url: "https://news.example/weather",
      lastAccessed: 1794241057999,
    }),
    tab("speed", {
      index: 3,
      active: false,
      workspaceId: "9",
      workspaceName: "Test A",
      title: "Speed Dial",
      url: "opera://startpage",
    }),
  ];
  const area = callbackArea({ [ORGANISER_RULES_KEY]: [newsRule] });
  const recorded = recordingBrowser(tabs);
  const document = createPopupDocument();
  await startPopup({
    document,
    window: createWindow(),
    browser: recorded.browser,
    local: area,
    manifest: popupManifest,
  });
  assert.equal(document.getElementById("heading").textContent, "Test A");
  assert.equal(document.getElementById("scope-note").hidden, true);
  assert.match(pageText(document), /Home news/);
  assert.match(pageText(document), /Example in A/);
  assert.match(pageText(document), /1 non-web tab ignored/);
  assert.equal(pageText(document).includes("Weather"), false);
  assert.equal(pageText(document).includes("Test B"), false);
  assertPreviewQueries(recorded.calls);

  const switched = tabs.map((entry) => (
    entry.workspaceId === "10"
      ? { ...entry, lastAccessed: 1794315478422 }
      : { ...entry, lastAccessed: entry.active ? 1794234711598 : undefined }
  ));
  const again = createPopupDocument();
  await startPopup({
    document: again,
    window: createWindow(),
    browser: recordingBrowser(switched).browser,
    local: callbackArea({ [ORGANISER_RULES_KEY]: [newsRule] }),
    manifest: popupManifest,
  });
  assert.equal(again.getElementById("heading").textContent, "Test B");
  assert.match(pageText(again), /Weather/);
  assert.equal(pageText(again).includes("Home news"), false);
  assert.equal(pageText(again).includes("Example in A"), false);
});

test("a missing lastAccessed lists every workspace and says why", async () => {
  const tabs = [
    tab("a-news", {
      index: 0,
      active: true,
      workspaceId: "9",
      workspaceName: "Test A",
      title: "Home news",
      url: "https://news.example/home",
    }),
    tab("b-news", {
      index: 1,
      active: true,
      workspaceId: "10",
      workspaceName: "Test B",
      title: "Weather",
      url: "https://news.example/weather",
    }),
  ];
  const document = createPopupDocument();
  await startPopup({
    document,
    window: createWindow(),
    browser: recordingBrowser(tabs).browser,
    local: callbackArea({ [ORGANISER_RULES_KEY]: [newsRule] }),
    manifest: popupManifest,
  });
  assert.equal(document.getElementById("heading").textContent, "This window");
  assert.equal(document.getElementById("scope-note").hidden, false);
  assert.match(document.getElementById("scope-note").textContent, /could not be detected/);
  assert.match(pageText(document), /Home news/);
  assert.match(pageText(document), /Weather/);
  assert.match(pageText(document), /Test A/);
  assert.match(pageText(document), /Test B/);
});

test("the popup card style keeps Apply visible and truncates a title to one line", () => {
  const css = readFileSync(path.join(root, "extension/popup.css"), "utf8");
  const html = readFileSync(path.join(root, "extension/popup.html"), "utf8");
  assert.match(css, /\.group-card\s*\{[^}]*border:\s*1px solid #d6d3d1;[^}]*border-radius:\s*8px;[^}]*background:\s*#fff;/s);
  assert.match(css, /\.tab-title\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.dock\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
  assert.match(html, /class="sheet"/);
  assert.match(html, /class="dock"/);
  assert.match(html, />Options</);
  assert.doesNotMatch(html, /id="description"|id="manifest-version"/);
});

test("OTO-021 sources do not request workspace writes or tab groups", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, "0.10.0");
  assert.equal(pkg.version, "0.10.0");
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.equal(Object.hasOwn(manifest, "optional_permissions"), false);
  assert.equal(manifest.description.length <= 132, true);

  const extensionDir = path.join(root, "extension");
  const walk = (directory) => {
    const files = [];
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        files.push(...walk(fullPath));
      } else if (entry.endsWith(".js")) {
        files.push(fullPath);
      }
    }
    return files;
  };
  const files = walk(extensionDir);
  const read = (file) => readFileSync(file, "utf8");
  const productSource = files
    .filter((file) => !file.split(path.sep).includes("dev"))
    .map(read)
    .join("\n");
  const allSource = files.map(read).join("\n");
  assert.doesNotMatch(allSource, /tabGroups|chrome\.tabGroups|browser\.tabGroups/);
  assert.doesNotMatch(allSource, /fetch\(/);
  assert.doesNotMatch(productSource, /\.tabs\.(move|create|remove|update|reload|highlight|group|discard|duplicate|ungroup)\b/);
  const probeSource = files
    .filter((file) => file.split(path.sep).includes("dev"))
    .map(read)
    .join("\n");
  assert.doesNotMatch(probeSource, /\.tabs\.(create|remove|reload|highlight|group|discard|duplicate|ungroup)\b/);
});
