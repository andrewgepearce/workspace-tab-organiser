import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectPreview } from "../extension/preview.js";
import { startPopup } from "../extension/popup.js";
import { appendRuleFromGroupKey, appendRuleFromTabUrl } from "../extension/popup-rule.js";
import { ORGANISER_RULES_KEY } from "../extension/rule-store.js";
import { detectCurrentWorkspace } from "../extension/workspace.js";

const createId = () => "rule-new";

function ruleFields(rule) {
  return {
    id: rule.id,
    label: rule.label,
    hostname: rule.hostname,
    pathPrefix: rule.pathPrefix,
  };
}

test("a rule built from a tab uses the hostname and the first path segment", () => {
  const cases = [
    {
      url: "https://spicymango.atlassian.net/browse/GAM-5363",
      hostname: "spicymango.atlassian.net",
      pathPrefix: "/browse",
      label: "spicymango.atlassian.net/browse",
    },
    {
      url: "https://example.com/",
      hostname: "example.com",
      pathPrefix: null,
      label: "example.com",
    },
    {
      url: "https://example.com",
      hostname: "example.com",
      pathPrefix: null,
      label: "example.com",
    },
    {
      url: "https://example.com/docs/page?x=1#section",
      hostname: "example.com",
      pathPrefix: "/docs",
      label: "example.com/docs",
    },
    {
      url: "https://example.com:8443/app/item",
      hostname: "example.com",
      pathPrefix: "/app",
      label: "example.com/app",
    },
    {
      url: "https://EXAMPLE.COM/Foo/bar?q=1#top",
      hostname: "example.com",
      pathPrefix: "/Foo",
      label: "example.com/Foo",
    },
    {
      url: "https://www.bbc.co.uk/sport/football?x=1#a",
      hostname: "www.bbc.co.uk",
      pathPrefix: "/sport",
      label: "www.bbc.co.uk/sport",
    },
  ];

  for (const item of cases) {
    const result = appendRuleFromTabUrl(item.url, [], { createId });
    assert.equal(result.ok, true, item.url);
    assert.deepEqual(ruleFields(result.rule), {
      id: "rule-new",
      label: item.label,
      hostname: item.hostname,
      pathPrefix: item.pathPrefix,
    });
    assert.equal(Object.hasOwn(result.rule, "url"), false);
    assert.deepEqual(result.rules.map(ruleFields), [ruleFields(result.rule)]);
  }
});

test("a popup rule is appended after the saved rules and does not change them", () => {
  const existing = [
    { id: "news", label: "news.example", hostname: "news.example", pathPrefix: null },
    { id: "docs", label: "docs.example/guide", hostname: "docs.example", pathPrefix: "/guide" },
  ];
  const snapshot = structuredClone(existing);
  const result = appendRuleFromTabUrl(
    "https://spicymango.atlassian.net/browse/GAM-5363?token=secret-token#comment",
    existing,
    { createId },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(existing, snapshot);
  assert.deepEqual(result.rules.map(ruleFields), [
    snapshot[0],
    snapshot[1],
    {
      id: "rule-new",
      label: "spicymango.atlassian.net/browse",
      hostname: "spicymango.atlassian.net",
      pathPrefix: "/browse",
    },
  ]);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("a similar rule with the same host and path is not added again", () => {
  const existing = [
    { id: "jira", label: "Jira", hostname: "spicymango.atlassian.net", pathPrefix: "/browse" },
  ];
  const snapshot = structuredClone(existing);
  const urls = [
    "https://spicymango.atlassian.net/browse/GAM-5363",
    "https://SPICYMANGO.ATLASSIAN.NET/browse/GAM-1?x=1#y",
    "https://spicymango.atlassian.net/browse/",
  ];
  for (const url of urls) {
    const result = appendRuleFromTabUrl(url, existing, { createId: () => "other" });
    assert.equal(result.ok, false, url);
    assert.equal(result.reason, "duplicate");
  }

  const root = [{ id: "root", label: "example.com", hostname: "example.com", pathPrefix: "/" }];
  const bare = appendRuleFromTabUrl("https://example.com/?q=1#f", root, { createId });
  assert.equal(bare.ok, false);
  assert.equal(bare.reason, "duplicate");
  assert.deepEqual(existing, snapshot);

  const differentPath = appendRuleFromTabUrl("https://example.com/docs/page", root, { createId });
  assert.equal(differentPath.ok, true);
  assert.equal(differentPath.rules[1].label, "example.com/docs");
  assert.equal(differentPath.rules[1].pathPrefix, "/docs");
  assert.deepEqual(ruleFields(differentPath.rules[0]), {
    id: "root",
    label: "example.com",
    hostname: "example.com",
    pathPrefix: "/",
  });
});

test("a stored label that clashes with the new derived name is aligned so the names stay unique", () => {
  const existing = [
    { id: "old", label: "example.com/docs", hostname: "news.example", pathPrefix: "/kept" },
    { id: "kept", label: "kept.example", hostname: "kept.example", pathPrefix: null },
  ];
  const result = appendRuleFromTabUrl("https://example.com/docs/page?x=1", existing, { createId });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rules.map(ruleFields), [
    { id: "old", label: "news.example/kept", hostname: "news.example", pathPrefix: "/kept" },
    { id: "kept", label: "kept.example", hostname: "kept.example", pathPrefix: null },
    { id: "rule-new", label: "example.com/docs", hostname: "example.com", pathPrefix: "/docs" },
  ]);
  assert.equal(new Set(result.rules.map((rule) => rule.label)).size, result.rules.length);
});

test("an automatic group key builds the same rule as one of its tabs", () => {
  const fromTab = appendRuleFromTabUrl("https://spicymango.atlassian.net/browse/GAM-5363", [], { createId });
  const fromKey = appendRuleFromGroupKey("spicymango.atlassian.net/browse", [], { createId });
  assert.equal(fromKey.ok, true);
  assert.deepEqual(ruleFields(fromKey.rule), ruleFields(fromTab.rule));
  assert.equal(appendRuleFromGroupKey("example.com", [], { createId }).rule.pathPrefix, null);
  assert.equal(appendRuleFromGroupKey("opera://startpage", [], { createId }).ok, false);
  assert.equal(appendRuleFromTabUrl("opera://startpage", [], { createId }).reason, "unsupported");
  assert.equal(appendRuleFromTabUrl("", [], { createId }).reason, "unsupported");
  assert.equal(appendRuleFromTabUrl(undefined, [], { createId }).reason, "unsupported");
});

function makeElement(tag) {
  return {
    tag,
    id: "",
    className: "",
    type: "",
    textContent: "",
    title: "",
    hidden: false,
    disabled: false,
    ruleKey: "",
    attrs: {},
    children: [],
    parent: null,
    listeners: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    },
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

function collect(node, predicate, found = []) {
  if (predicate(node)) {
    found.push(node);
  }
  for (const child of node.children || []) {
    collect(child, predicate, found);
  }
  return found;
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
    ["notice", "p"],
    ["blocks", "section"],
    ["unmatched", "section"],
    ["unavailable", "section"],
    ["report", "section"],
    ["apply-reason", "p"],
    ["apply", "button"],
    ["cancel", "button"],
    ["name", "span"],
    ["version", "span"],
    ["options", "a"],
  ]) {
    const element = makeElement(tag);
    element.id = id;
    root.append(element);
  }
  document.getElementById("notice").setAttribute("aria-live", "polite");
  document.getElementById("apply").disabled = true;
  return document;
}

function texts(node) {
  const values = [node.textContent];
  for (const child of node.children || []) {
    values.push(...texts(child));
  }
  return values.filter((value) => value !== "");
}

function previewText(document) {
  return ["heading", "status", "blocks", "unmatched", "unavailable", "apply-reason"]
    .map((id) => texts(document.getElementById(id)).join("\n"))
    .join("\n");
}

function addButtons(section) {
  return collect(section, (node) => String(node.className || "").split(/\s+/).includes("add-rule"));
}

function callbackArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    sets: [],
    failWrites: false,
    get(key, callback) {
      const items = Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {};
      callback(items);
    },
    set(items, callback) {
      this.sets.push(structuredClone(items));
      if (!this.failWrites) {
        Object.assign(data, structuredClone(items));
      }
      callback();
    },
  };
}

function recordingBrowser(tabs, options = {}) {
  const calls = [];
  const runtime = { lastError: null };
  let windowReads = 0;
  const tabsApi = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }
      const method = String(property);
      return (...args) => {
        calls.push({ method, queryInfo: method === "query" ? args[0] : null });
        if (method !== "query") {
          return undefined;
        }
        const callback = args.find((arg) => typeof arg === "function");
        const queryInfo = args[0];
        if (queryInfo && queryInfo.active === true) {
          callback(tabs.filter((tab) => tab.active === true));
          return undefined;
        }
        windowReads += 1;
        if (options.failWindowReadAfter && windowReads >= options.failWindowReadAfter) {
          runtime.lastError = { message: "secret-token" };
          callback([]);
          runtime.lastError = null;
          return undefined;
        }
        callback(tabs.map((tab) => ({ ...tab })));
        return undefined;
      };
    },
  });
  return { calls, browser: { tabs: tabsApi, runtime } };
}

async function click(element) {
  for (const listener of element.listeners.click || []) {
    await listener({ preventDefault() {} });
  }
}

function hiddenTab(overrides) {
  const tab = {
    id: "hidden",
    index: 30,
    title: "Hidden page",
    pinned: false,
    active: false,
    windowId: 1,
    workspaceId: "gameday",
    workspaceName: "Gameday",
    ...overrides,
  };
  Object.defineProperty(tab, "url", {
    get() {
      throw new Error("secret-token");
    },
  });
  return tab;
}

function gamedayTabs() {
  const rows = [
    { id: "inbox", index: 0, workspaceId: "inbox", workspaceName: "Inbox", title: "Inbox home", url: "https://inbox.example/?token=secret-token", active: true, lastAccessed: 1 },
    { id: "standings", index: 1, workspaceId: "gameday", workspaceName: "Gameday", title: "Standings", url: "https://standings.example/table?token=secret-token", active: true, lastAccessed: 100 },
    { id: "alpha", index: 2, workspaceId: "gameday", workspaceName: "Gameday", title: "Alpha notes", url: "https://notes.example/alpha", active: false },
    { id: "jira-1", index: 3, workspaceId: "gameday", workspaceName: "Gameday", title: "GAM-5363", url: "https://spicymango.atlassian.net/browse/GAM-5363?token=secret-token", active: false },
    { id: "home", index: 4, workspaceId: "gameday", workspaceName: "Gameday", title: "Home", url: "https://home.example/x", active: false },
    { id: "echo", index: 5, workspaceId: "gameday", workspaceName: "Gameday", title: "Echo", url: "https://echo.example/a", active: false },
    { id: "example", index: 6, workspaceId: "gameday", workspaceName: "Gameday", title: "Example Domain", url: "https://example.com/?token=secret-token", active: false },
    { id: "jira-2", index: 7, workspaceId: "gameday", workspaceName: "Gameday", title: "GAM-5401", url: "https://spicymango.atlassian.net/browse/GAM-5401", active: false },
    { id: "zebra", index: 8, workspaceId: "gameday", workspaceName: "Gameday", title: "Zebra", url: "https://zebra.example/z", active: false },
    { id: "speed", index: 9, workspaceId: "gameday", workspaceName: "Gameday", title: "Speed Dial", url: "opera://startpage/secret-token", active: false },
    { id: "blank", index: 10, workspaceId: "gameday", workspaceName: "Gameday", title: "Missing address", url: undefined, active: false },
  ];
  return rows.map((row) => ({ pinned: false, windowId: 1, ...row })).concat(hiddenTab());
}

function buttonByKey(buttons, key) {
  return buttons.find((button) => button.ruleKey === key);
}

test("D28 shows Add rule on single unmatched tabs and once on an automatic card", async () => {
  const tabs = gamedayTabs();
  const area = callbackArea({});
  const recorded = recordingBrowser(tabs);
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {} },
    browser: recorded.browser,
    local: area,
    manifest: { name: "Workspace Tab Organiser", version: "0.9.0", manifest_version: 2, description: "Add a rule from the popup." },
  });

  assert.equal(document.getElementById("heading").textContent, "Gameday");
  assert.equal(previewText(document).includes("Inbox home"), false);
  assert.equal(previewText(document).includes("https://"), false);
  assert.equal(previewText(document).includes("secret-token"), false);
  assert.equal(previewText(document).includes("opera:"), false);

  const blockButtons = addButtons(document.getElementById("blocks"));
  assert.equal(blockButtons.length, 1);
  assert.equal(blockButtons[0].textContent, "Add rule");
  assert.equal(blockButtons[0].type, "button");
  assert.equal(blockButtons[0].ruleKey, "spicymango.atlassian.net/browse");
  assert.match(blockButtons[0].getAttribute("aria-label"), /Add rule/);
  assert.match(texts(document.getElementById("blocks")).join("\n"), /Automatic/);
  assert.equal(texts(document.getElementById("blocks")).join("\n").includes("Rule"), false);

  const unmatchedButtons = addButtons(document.getElementById("unmatched"));
  assert.deepEqual(unmatchedButtons.map((button) => button.ruleKey), [
    "notes.example/alpha",
    "echo.example/a",
    "example.com",
    "home.example/x",
    "standings.example/table",
    "zebra.example/z",
  ]);
  assert.equal(addButtons(document.getElementById("unavailable")).length, 0);
  assert.match(texts(document.getElementById("unavailable")).join("\n"), /Speed Dial/);
  assert.match(texts(document.getElementById("unavailable")).join("\n"), /Missing address/);
  assert.match(texts(document.getElementById("unavailable")).join("\n"), /Hidden page/);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);
});

test("Add rule saves at the end, refreshes the preview and moves nothing until Apply", async () => {
  const tabs = gamedayTabs();
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "news", label: "news.example", hostname: "news.example", pathPrefix: null },
    ],
  });
  const recorded = recordingBrowser(tabs);
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {} },
    browser: recorded.browser,
    local: area,
    manifest: { name: "Workspace Tab Organiser", version: "0.9.0", manifest_version: 2, description: "Add a rule from the popup." },
  });

  const jiraButton = buttonByKey(addButtons(document.getElementById("blocks")), "spicymango.atlassian.net/browse");
  await click(jiraButton);

  const saved = area.data[ORGANISER_RULES_KEY];
  assert.deepEqual(saved.map((rule) => rule.id).slice(0, 1), ["news"]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].label, "news.example");
  assert.deepEqual(ruleFields(saved[1]), {
    id: saved[1].id,
    label: "spicymango.atlassian.net/browse",
    hostname: "spicymango.atlassian.net",
    pathPrefix: "/browse",
  });
  assert.match(saved[1].id, /^[0-9a-f-]{36}$/);
  assert.equal(document.getElementById("notice").textContent, "Rule added");
  assert.equal(document.getElementById("notice").getAttribute("aria-live"), "polite");
  assert.match(texts(document.getElementById("blocks")).join("\n"), /Rule/);
  assert.equal(texts(document.getElementById("blocks")).join("\n").includes("Automatic"), false);
  assert.equal(addButtons(document.getElementById("blocks")).length, 0);
  assert.match(texts(document.getElementById("blocks")).join("\n"), /GAM-5363/);
  assert.match(texts(document.getElementById("blocks")).join("\n"), /GAM-5401/);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);

  const exampleButton = buttonByKey(addButtons(document.getElementById("unmatched")), "example.com");
  await click(exampleButton);

  const rules = area.data[ORGANISER_RULES_KEY];
  assert.deepEqual(rules.map((rule) => rule.hostname), ["news.example", "spicymango.atlassian.net", "example.com"]);
  assert.equal(rules[2].pathPrefix, null);
  assert.equal(rules[2].label, "example.com");
  const blockText = texts(document.getElementById("blocks")).join("\n");
  assert.match(blockText, /spicymango\.atlassian\.net\/browse[\s\S]*example\.com/);
  assert.match(blockText, /Example Domain/);
  assert.equal(texts(document.getElementById("unmatched")).join("\n").includes("Example Domain"), false);
  assert.equal(addButtons(document.getElementById("unmatched")).some((button) => button.ruleKey === "example.com"), false);

  const active = tabs.filter((tab) => tab.active === true);
  const scope = detectCurrentWorkspace(active);
  const expected = inspectPreview(tabs, rules, { scope, groupUnmatchedTabs: true });
  assert.equal(document.getElementById("status").textContent, expected.preview.message);
  assert.match(document.getElementById("status").textContent, /^\d+ tabs? to move into \d+ groups?, \d+ unmatched$/);
  assert.equal(document.getElementById("apply").disabled, expected.changeCount === 0);
  assert.equal(document.getElementById("apply-reason").textContent, expected.changeCount === 0 ? "Nothing to move" : "");
  assert.equal(previewText(document).includes("Inbox home"), false);
  assert.equal(previewText(document).includes("secret-token"), false);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);
  assert.equal(document.getElementById("notice").textContent, "Rule added");
});

test("a duplicate rule is reported and the preview stays as it was", async () => {
  const tabs = gamedayTabs();
  const area = callbackArea({});
  const recorded = recordingBrowser(tabs);
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {} },
    browser: recorded.browser,
    local: area,
    manifest: { name: "Workspace Tab Organiser", version: "0.9.0", manifest_version: 2, description: "Add a rule from the popup." },
  });

  const before = previewText(document);
  const button = buttonByKey(addButtons(document.getElementById("unmatched")), "example.com");
  area.data[ORGANISER_RULES_KEY] = [
    { id: "already", label: "Example", hostname: "example.com", pathPrefix: null },
  ];
  await click(button);

  assert.equal(previewText(document), before);
  assert.equal(document.getElementById("notice").textContent, "This hostname and path are already used by another rule.");
  assert.deepEqual(area.data[ORGANISER_RULES_KEY].map((rule) => rule.id), ["already"]);
  assert.equal(area.sets.length, 0);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);
});

test("a failed save leaves the preview unchanged and moves nothing", async () => {
  const tabs = gamedayTabs();
  const area = callbackArea({});
  area.set = function failSet(items, callback) {
    this.sets.push(structuredClone(items));
    this.failWrites = true;
    recordedRuntime.lastError = { message: "quota secret-token" };
    callback();
    recordedRuntime.lastError = null;
  };
  const recorded = recordingBrowser(tabs);
  const recordedRuntime = recorded.browser.runtime;
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {} },
    browser: recorded.browser,
    local: area,
    manifest: { name: "Workspace Tab Organiser", version: "0.9.0", manifest_version: 2, description: "Add a rule from the popup." },
  });

  const before = previewText(document);
  const applyDisabled = document.getElementById("apply").disabled;
  await click(addButtons(document.getElementById("blocks"))[0]);

  assert.equal(previewText(document), before);
  assert.equal(document.getElementById("apply").disabled, applyDisabled);
  assert.equal(document.getElementById("notice").textContent, "The rule could not be saved. Nothing was written.");
  assert.equal(previewText(document).includes("secret-token"), false);
  assert.equal(Object.hasOwn(area.data, ORGANISER_RULES_KEY), false);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);
});

test("a saved rule stays put when the preview cannot be read again", async () => {
  const tabs = gamedayTabs();
  const area = callbackArea({});
  const recorded = recordingBrowser(tabs, { failWindowReadAfter: 2 });
  const document = createPopupDocument();
  await startPopup({
    document,
    window: { close() {} },
    browser: recorded.browser,
    local: area,
    manifest: { name: "Workspace Tab Organiser", version: "0.9.0", manifest_version: 2, description: "Add a rule from the popup." },
  });

  const before = previewText(document);
  await click(addButtons(document.getElementById("blocks"))[0]);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "spicymango.atlassian.net/browse");
  assert.equal(previewText(document), before);
  assert.match(document.getElementById("notice").textContent, /Rule added/);
  assert.match(document.getElementById("notice").textContent, /left as it was/);
  assert.equal(texts(document.getElementById("blocks")).join("\n").includes("Automatic"), true);
  assert.equal(recorded.calls.some((call) => call.method !== "query"), false);
  assert.equal(previewText(document).includes("secret-token"), false);
});

test("preview targets offer a key only for an automatic card or a single unmatched tab", () => {
  const tabs = gamedayTabs();
  const scope = detectCurrentWorkspace(tabs.filter((tab) => tab.active === true));
  const inspected = inspectPreview(tabs, [], { scope, groupUnmatchedTabs: true });
  assert.deepEqual(inspected.addRule.blockKeys, ["spicymango.atlassian.net/browse"]);
  assert.deepEqual(inspected.addRule.unmatchedKeys, [
    "notes.example/alpha",
    "echo.example/a",
    "example.com",
    "home.example/x",
    "standings.example/table",
    "zebra.example/z",
  ]);
  assert.equal(JSON.stringify(inspected.preview).includes("https://"), false);
  assert.equal(JSON.stringify(inspected.preview).includes("secret-token"), false);

  const ruled = inspectPreview(tabs, [
    { id: "jira", label: "spicymango.atlassian.net/browse", hostname: "spicymango.atlassian.net", pathPrefix: "/browse" },
  ], { scope });
  assert.deepEqual(ruled.addRule.blockKeys, [null]);
  assert.equal(ruled.addRule.unmatchedKeys.includes("spicymango.atlassian.net/browse"), false);
});
