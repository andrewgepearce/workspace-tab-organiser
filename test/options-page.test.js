import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY } from "../extension/rule-store.js";
import { startOptionsPage } from "../extension/options.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");
const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const optionsJs = readFileSync(path.join(extensionDir, "options.js"), "utf8");
const optionsHtml = readFileSync(path.join(extensionDir, "options.html"), "utf8");

function extensionSources() {
  const sources = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".js")) {
        sources.push(readFileSync(fullPath, "utf8"));
      }
    }
  };
  walk(extensionDir);
  return sources;
}

function makeElement(tag) {
  return {
    tag,
    id: "",
    className: "",
    type: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    htmlFor: "",
    autocomplete: "",
    spellcheck: true,
    autocapitalize: "",
    dataset: {},
    attrs: {},
    children: [],
    parent: null,
    listeners: {},
    focusCalls: 0,
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    focus() {
      this.focusCalls += 1;
    },
    remove() {
      if (!this.parent) {
        return;
      }
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
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
    replaceChildren() {
      for (const child of this.children) {
        child.parent = null;
      }
      this.children = [];
    },
    querySelector(selector) {
      return queryAll(this, selector)[0] || null;
    },
    querySelectorAll(selector) {
      return queryAll(this, selector);
    },
  };
}

function matches(node, selector) {
  if (selector === "input") {
    return node.tag === "input";
  }
  if (selector === "input, button") {
    return node.tag === "input" || node.tag === "button";
  }
  if (selector === ".field-error") {
    return node.className.split(/\s+/).includes("field-error");
  }
  if (selector === "[aria-invalid='true']") {
    return node.attrs["aria-invalid"] === "true";
  }
  return false;
}

function queryAll(node, selector) {
  const found = [];
  for (const child of node.children) {
    if (matches(child, selector)) {
      found.push(child);
    }
    found.push(...queryAll(child, selector));
  }
  return found;
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

function createDocument() {
  const root = makeElement("main");
  const document = {
    getElementById(id) {
      return findById(root, id);
    },
    createElement(tag) {
      return makeElement(tag);
    },
    querySelector(selector) {
      return queryAll(root, selector)[0] || null;
    },
    querySelectorAll(selector) {
      return queryAll(root, selector);
    },
    createElementNS(_namespace, tag) {
      return makeElement(tag);
    },
  };
  for (const id of ["status", "unsaved", "empty", "rules", "add", "save", "discard"]) {
    const tag = id === "rules" ? "ol" : id === "add" || id === "save" || id === "discard" ? "button" : "p";
    const element = makeElement(tag);
    element.id = id;
    if (tag === "button") {
      element.disabled = true;
    }
    root.append(element);
  }
  const checkbox = makeElement("input");
  checkbox.id = "group-unmatched";
  checkbox.type = "checkbox";
  checkbox.checked = true;
  root.append(checkbox);
  return document;
}

function createWindow() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
  };
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
      if (!this.failWrites) {
        this.sets.push(structuredClone(items));
        Object.assign(data, structuredClone(items));
      }
      callback();
    },
  };
}

function click(element) {
  for (const listener of element.listeners.click || []) {
    listener();
  }
}

function fire(element, type, event = {}) {
  for (const listener of element.listeners[type] || []) {
    listener(event);
  }
}

function inputByPrefix(document, prefix) {
  return document.querySelectorAll("input").find((input) => input.id.startsWith(prefix)) || null;
}

function typeInto(element, value) {
  element.value = value;
  for (const listener of element.listeners.input || []) {
    listener();
  }
}

async function flush() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function texts(node) {
  const values = [node.textContent];
  for (const child of node.children) {
    values.push(...texts(child));
  }
  return values;
}

test("OTO-003 options page is local storage only and uses Opera's options_page", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.version, "0.10.0");
  assert.equal(manifest.options_page, "options.html");
  assert.equal(Object.hasOwn(manifest, "options_ui"), false);
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.equal(statSync(path.join(extensionDir, "options.html")).isFile(), true);
  assert.equal(statSync(path.join(extensionDir, "options.css")).isFile(), true);

  assert.match(optionsHtml, /<script type="module" src="options\.js"><\/script>/);
  assert.doesNotMatch(optionsHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(optionsHtml, /\son\w+=/i);
  assert.match(optionsHtml, /href="options\.css"/);
  assert.match(optionsHtml, /No rules yet/);
  assert.match(optionsHtml, /id="save"/);
  assert.match(optionsHtml, /id="discard"/);
  assert.match(optionsHtml, /id="add"/);

  assert.match(optionsJs, /chrome\.storage\.local/);
  assert.match(optionsJs, /beforeunload/);
  assert.match(optionsHtml, /Add from URL/);
  assert.match(optionsJs, /dragstart/);
  assert.doesNotMatch(optionsHtml, /Alt\+Arrow|aria-live/);
  assert.doesNotMatch(optionsJs, /Alt\+Arrow|aria-live|aria-keyshortcuts/);
  assert.match(optionsJs, /Delete rule /);
  assert.match(optionsJs, /Edit rule /);
  assert.doesNotMatch(optionsJs, /textContent = "Up"|textContent = "Down"|textContent = "Move up"|textContent = "Delete"/);
  assert.match(optionsJs, /from "\.\/rule-draft\.js"/);
  assert.match(optionsJs, /from "\.\/rule-store\.js"/);
  assert.match(optionsJs, /from "\.\/url-rule\.js"/);
  assert.doesNotMatch(optionsJs, /chrome\.storage\.sync|chrome\.storage\.managed|chrome\.storage\.session/);
  assert.doesNotMatch(optionsJs, /localStorage|indexedDB|innerHTML|outerHTML|insertAdjacentHTML|eval\(|fetch\(/);
  assert.doesNotMatch(optionsJs, /chrome\.tabs|browser\.tabs|tabGroups|from "\.\/arrangement\.js"/);

  for (const source of extensionSources()) {
    assert.doesNotMatch(source, /tabGroups|storage\.sync|storage\.managed|storage\.session/);
    assert.doesNotMatch(source, /localStorage|indexedDB|fetch\(/);
    assert.doesNotMatch(source, /\.tabs\.(move|create|remove|update|reload|highlight|group|discard|duplicate|ungroup)\b/);
  }
});
test("a saved friendly label still loads and the row shows the derived name", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
      { id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/beta" },
    ],
  });
  const document = createDocument();
  const window = createWindow();
  startOptionsPage({ document, window, local: area });
  await flush();

  assert.equal(document.getElementById("empty").hidden, true);
  assert.equal(document.getElementById("name-a").textContent, "a.example");
  assert.equal(document.getElementById("host-a").textContent, "a.example");
  assert.equal(document.getElementById("path-a").textContent, "Any path");
  assert.equal(document.getElementById("name-b").textContent, "b.example/beta");
  assert.equal(document.getElementById("path-b").textContent, "/beta");
  assert.equal(document.getElementById("rules").querySelector("input"), null);
  assert.equal(document.getElementById("drag-a").draggable, true);
  assert.equal(document.getElementById("drag-a").getAttribute("aria-label"), "Reorder a.example");
  assert.equal(document.getElementById("delete-b").getAttribute("aria-label"), "Delete rule b.example/beta");
  assert.equal(document.getElementById("delete-b").textContent.includes("Delete"), false);
  assert.equal(document.getElementById("up-a"), null);
  assert.equal(document.getElementById("discard").disabled, true);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "Alpha");
  assert.deepEqual(area.sets, []);

  const event = { returnValue: undefined, preventDefault() { this.prevented = true; } };
  window.listeners.beforeunload[0](event);
  assert.equal(event.prevented, undefined);

  click(document.getElementById("save"));
  await flush();
  assert.deepEqual(area.data[ORGANISER_RULES_KEY].map((rule) => rule.id), ["a", "b"]);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "a.example");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "b.example/beta");
  assert.equal(document.getElementById("status").textContent, "Saved 2 rules on this browser.");
  assert.equal(document.getElementById("name-a").textContent, "a.example");
});

test("dragging a row by its grip reorders, shows a drop target and Save keeps that order", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
      { id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/beta" },
      { id: "c", label: "Gamma", hostname: "c.example", pathPrefix: "/gamma" },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  const transfer = {
    data: "",
    setData(_type, value) {
      this.data = value;
    },
    getData() {
      return this.data;
    },
    effectAllowed: "",
    dropEffect: "",
  };
  fire(document.getElementById("drag-a"), "dragstart", { dataTransfer: transfer, preventDefault() {} });
  const target = document.getElementById("rule-c");
  fire(target, "dragover", { dataTransfer: transfer, preventDefault() {} });
  assert.equal(target.className.includes("drop-target"), true);
  fire(target, "drop", { dataTransfer: transfer, preventDefault() {} });

  assert.deepEqual(
    document.getElementById("rules").children.map((row) => row.id),
    ["rule-b", "rule-c", "rule-a"],
  );
  assert.equal(document.getElementById("drag-a").focusCalls, 1);
  assert.equal(document.getElementById("name-a").textContent, "a.example");

  click(document.getElementById("save"));
  await flush();
  assert.deepEqual(area.data[ORGANISER_RULES_KEY].map((rule) => rule.id), ["b", "c", "a"]);
  assert.equal(Object.hasOwn(area.data[ORGANISER_RULES_KEY][0], "url"), false);
});

test("the delete icon removes a row and Discard restores the saved label", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
      { id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/beta" },
      { id: "c", label: "Gamma", hostname: "c.example", pathPrefix: "/gamma" },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  click(document.getElementById("delete-a"));
  assert.deepEqual(
    document.getElementById("rules").children.map((row) => row.id),
    ["rule-b", "rule-c"],
  );
  assert.equal(document.getElementById("delete-b").focusCalls, 1);
  assert.equal(document.getElementById("unsaved").textContent, "You have unsaved changes.");
  assert.deepEqual(area.sets, []);

  click(document.getElementById("delete-c"));
  assert.equal(document.getElementById("rules").children.length, 1);
  assert.equal(document.getElementById("delete-b").focusCalls, 1);

  click(document.getElementById("discard"));
  assert.deepEqual(
    document.getElementById("rules").children.map((row) => row.id),
    ["rule-a", "rule-b", "rule-c"],
  );
  assert.equal(document.getElementById("name-a").textContent, "a.example");
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "Alpha");
  assert.deepEqual(area.sets, []);

  click(document.getElementById("delete-c"));
  click(document.getElementById("save"));
  await flush();
  assert.deepEqual(area.data[ORGANISER_RULES_KEY].map((rule) => rule.id), ["a", "b"]);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "a.example");
});

test("deleting the only rule focuses Add rule", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  click(document.getElementById("delete-a"));
  assert.equal(document.getElementById("rules").children.length, 0);
  assert.equal(document.getElementById("empty").hidden, false);
  assert.equal(document.getElementById("add").focusCalls, 1);
});

test("Add from URL stays hidden until it is opened, then Enter, Escape and blur behave", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "kept", label: "Kept", hostname: "kept.example", pathPrefix: "/kept" },
    ],
  });
  const document = createDocument();
  const window = createWindow();
  startOptionsPage({ document, window, local: area });
  await flush();

  assert.equal(document.getElementById("url-new"), null);
  assert.equal(document.getElementById("name-kept").textContent, "kept.example/kept");
  click(document.getElementById("add"));
  const url = document.getElementById("url-new");
  assert.equal(url.focusCalls, 1);
  assert.equal(document.getElementById("add").disabled, true);
  assert.equal(document.getElementById("rules").querySelectorAll("input").length, 1);

  typeInto(url, "ftp://user:secret-token@example.com/hidden");
  fire(url, "keydown", { key: "Enter", preventDefault() {} });
  const pageText = texts(document.getElementById("rules")).join("\n");
  assert.match(pageText, /http or https/);
  assert.equal(pageText.includes("secret-token"), false);
  assert.equal(document.getElementById("url-new") !== null, true);
  assert.equal(document.getElementById("rules").children.length, 2);
  assert.deepEqual(area.sets, []);

  fire(document.getElementById("url-new"), "keydown", { key: "Escape", preventDefault() {} });
  assert.equal(document.getElementById("url-new"), null);
  assert.equal(document.getElementById("rules").children.length, 1);
  assert.equal(document.getElementById("add").focusCalls, 1);
  assert.equal(document.getElementById("unsaved").textContent, "");

  click(document.getElementById("add"));
  typeInto(document.getElementById("url-new"), "https://www.bbc.co.uk/sport/football?x=1#a");
  fire(document.getElementById("url-new"), "blur", {});
  assert.equal(document.getElementById("url-new"), null);
  assert.equal(document.getElementById("name-new"), null);
  const added = document.getElementById("rules").children[1];
  assert.match(added.id, /^rule-/);
  const addedId = added.id.slice("rule-".length);
  assert.equal(document.getElementById(`name-${addedId}`).textContent, "www.bbc.co.uk/sport/football");
  assert.equal(document.getElementById(`host-${addedId}`).textContent, "www.bbc.co.uk");
  assert.equal(document.getElementById(`path-${addedId}`).textContent, "/sport/football");
  assert.equal(document.getElementById(`delete-${addedId}`).getAttribute("aria-label"), "Delete rule www.bbc.co.uk/sport/football");
  assert.equal(document.getElementById(`drag-${addedId}`).focusCalls, 1);

  click(document.getElementById("save"));
  await flush();
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "www.bbc.co.uk/sport/football");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].hostname, "www.bbc.co.uk");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].pathPrefix, "/sport/football");
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "kept.example/kept");
  assert.equal(Object.hasOwn(area.data[ORGANISER_RULES_KEY][1], "url"), false);

  const event = { returnValue: undefined, preventDefault() { this.prevented = true; } };
  window.listeners.beforeunload[0](event);
  assert.equal(event.prevented, undefined);
});

test("a duplicate hostname and path is rejected and Discard restores the saved rule", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "kept", label: "Kept", hostname: "kept.example", pathPrefix: "/kept" },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  click(document.getElementById("add"));
  typeInto(document.getElementById("url-new"), "https://kept.example/kept/");
  fire(document.getElementById("url-new"), "keydown", { key: "Enter", preventDefault() {} });
  click(document.getElementById("save"));
  await flush();

  assert.deepEqual(area.sets, []);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "Kept");
  assert.equal(document.getElementById("status").textContent, "Nothing was saved. Correct the marked fields.");
  const pageText = texts(document.getElementById("rules")).join("\n");
  assert.match(pageText, /already used/);
  assert.equal(pageText.includes("secret"), false);

  click(document.getElementById("discard"));
  assert.equal(document.getElementById("rules").children.length, 1);
  assert.equal(document.getElementById("name-kept").textContent, "kept.example/kept");
  assert.equal(document.getElementById("unsaved").textContent, "");
  assert.match(document.getElementById("status").textContent, /Discarded unsaved changes/);
  assert.deepEqual(area.sets, []);
});

test("a missing store stays empty and a corrupt store is not rewritten until Save", async () => {
  const missing = callbackArea();
  const missingDocument = createDocument();
  startOptionsPage({ document: missingDocument, window: createWindow(), local: missing });
  await flush();
  assert.equal(missingDocument.getElementById("empty").hidden, false);
  assert.deepEqual(missing.sets, []);

  const corrupt = callbackArea({ [ORGANISER_RULES_KEY]: { bad: true } });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: corrupt });
  await flush();
  assert.match(document.getElementById("status").textContent, /could not be read/);
  assert.equal(document.getElementById("unsaved").textContent, "");
  assert.deepEqual(corrupt.sets, []);
  assert.deepEqual(corrupt.data[ORGANISER_RULES_KEY], { bad: true });

  click(document.getElementById("add"));
  typeInto(document.getElementById("url-new"), "https://mail.example/");
  fire(document.getElementById("url-new"), "keydown", { key: "Enter", preventDefault() {} });
  click(document.getElementById("save"));
  await flush();

  assert.equal(corrupt.sets.length, 1);
  assert.equal(corrupt.data[ORGANISER_RULES_KEY].length, 1);
  assert.equal(corrupt.data[ORGANISER_RULES_KEY][0].label, "mail.example");
  assert.equal(corrupt.data[ORGANISER_RULES_KEY][0].hostname, "mail.example");
  assert.equal(corrupt.data[ORGANISER_RULES_KEY][0].pathPrefix, null);
  assert.match(corrupt.data[ORGANISER_RULES_KEY][0].id, /^[0-9a-f-]{36}$/);
});

test("a storage write failure leaves the draft unsaved", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
  });
  const document = createDocument();
  const window = createWindow();
  startOptionsPage({ document, window, local: area });
  await flush();

  click(document.getElementById("delete-a"));
  area.failWrites = true;
  globalThis.chrome = { runtime: { lastError: { message: "quota" } } };
  try {
    click(document.getElementById("save"));
    await flush();
  } finally {
    delete globalThis.chrome;
    area.failWrites = false;
  }

  assert.deepEqual(area.sets, []);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "Alpha");
  assert.equal(document.getElementById("status").textContent, "The rules could not be saved. Nothing was written.");
  assert.equal(document.getElementById("rules").children.length, 0);
  assert.equal(document.getElementById("unsaved").textContent, "You have unsaved changes.");
});

function setChecked(element, checked) {
  element.checked = checked;
  for (const listener of element.listeners.change || []) {
    listener();
  }
}

test("D12 the checkbox defaults to on, saves with the rules and discards", async () => {
  assert.match(optionsHtml, /id="group-unmatched"/);
  assert.match(optionsHtml, /Group unmatched tabs automatically/);
  assert.match(optionsHtml, /ordered from A to Z/);
  assert.match(optionsHtml, /sorted by its title/);
  assert.match(optionsJs, /groupUnmatchedTabs/);

  const missing = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
  });
  const missingDocument = createDocument();
  const missingWindow = createWindow();
  startOptionsPage({ document: missingDocument, window: missingWindow, local: missing });
  await flush();
  const missingBox = missingDocument.getElementById("group-unmatched");
  assert.equal(missingBox.checked, true);
  assert.equal(missingDocument.getElementById("name-a").textContent, "a.example");
  assert.deepEqual(missing.sets, []);

  setChecked(missingBox, false);
  assert.equal(missingDocument.getElementById("unsaved").textContent, "You have unsaved changes.");
  assert.equal(missingDocument.getElementById("discard").disabled, false);
  const warn = { returnValue: undefined, preventDefault() { this.prevented = true; } };
  missingWindow.listeners.beforeunload[0](warn);
  assert.equal(warn.prevented, true);

  click(missingDocument.getElementById("discard"));
  assert.equal(missingBox.checked, true);
  assert.equal(missingDocument.getElementById("unsaved").textContent, "");
  assert.deepEqual(missing.sets, []);

  setChecked(missingBox, false);
  click(missingDocument.getElementById("save"));
  await flush();
  assert.equal(missing.sets.length, 1);
  assert.deepEqual(missing.data[ORGANISER_SETTINGS_KEY], { groupUnmatchedTabs: false });
  assert.equal(missing.data[ORGANISER_RULES_KEY][0].label, "a.example");
  assert.equal(missing.data[ORGANISER_RULES_KEY][0].hostname, "a.example");
  assert.equal(missingBox.checked, false);
  assert.equal(missingDocument.getElementById("unsaved").textContent, "");

  const off = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: false },
  });
  const offDocument = createDocument();
  startOptionsPage({ document: offDocument, window: createWindow(), local: off });
  await flush();
  assert.equal(offDocument.getElementById("group-unmatched").checked, false);

  const odd = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
    [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs: "false" },
  });
  const oddDocument = createDocument();
  startOptionsPage({ document: oddDocument, window: createWindow(), local: odd });
  await flush();
  assert.equal(oddDocument.getElementById("group-unmatched").checked, true);

  click(missingDocument.getElementById("add"));
  typeInto(missingDocument.getElementById("url-new"), "https://a.example/");
  fire(missingDocument.getElementById("url-new"), "keydown", { key: "Enter", preventDefault() {} });
  setChecked(missingBox, true);
  click(missingDocument.getElementById("save"));
  await flush();
  assert.equal(missing.sets.length, 1);
  assert.deepEqual(missing.data[ORGANISER_SETTINGS_KEY], { groupUnmatchedTabs: false });
  assert.equal(missing.data[ORGANISER_RULES_KEY].length, 1);
  assert.equal(missingDocument.getElementById("status").textContent, "Nothing was saved. Correct the marked fields.");
});

test("the edit icon reopens the URL, updates the draft and Discard restores the saved rule", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
      { id: "b", label: "Beta", hostname: "b.example", pathPrefix: "/beta" },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  assert.equal(document.getElementById("edit-b").getAttribute("aria-label"), "Edit rule b.example/beta");
  assert.equal(document.getElementById("edit-b").textContent.includes("Edit"), false);
  click(document.getElementById("edit-b"));
  const url = document.getElementById("url-b");
  assert.equal(url.value, "https://b.example/beta");
  assert.equal(url.focusCalls, 1);
  assert.equal(document.getElementById("host-b"), null);
  assert.equal(document.getElementById("path-b"), null);
  assert.equal(document.getElementById("name-b").textContent, "b.example/beta");
  assert.equal(document.getElementById("add").disabled, true);

  typeInto(url, "ftp://user:secret-token@example.com/hidden");
  fire(document.getElementById("url-b"), "keydown", { key: "Enter", preventDefault() {} });
  const invalidText = texts(document.getElementById("rule-b")).join("\n");
  assert.match(invalidText, /http or https/);
  assert.equal(invalidText.includes("secret-token"), false);
  assert.equal(document.getElementById("url-b") !== null, true);
  assert.equal(area.data[ORGANISER_RULES_KEY][1].hostname, "b.example");

  fire(document.getElementById("url-b"), "keydown", { key: "Escape", preventDefault() {} });
  assert.equal(document.getElementById("url-b"), null);
  assert.equal(document.getElementById("host-b").textContent, "b.example");
  assert.equal(document.getElementById("path-b").textContent, "/beta");
  assert.equal(document.getElementById("edit-b").focusCalls, 1);
  assert.equal(document.getElementById("discard").disabled, true);
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "Beta");

  click(document.getElementById("edit-b"));
  typeInto(document.getElementById("url-b"), "https://a.example/");
  fire(document.getElementById("url-b"), "keydown", { key: "Enter", preventDefault() {} });
  assert.match(texts(document.getElementById("rule-b")).join("\n"), /already used/);
  assert.equal(document.getElementById("url-b") !== null, true);
  assert.equal(area.data[ORGANISER_RULES_KEY][1].pathPrefix, "/beta");

  fire(document.getElementById("url-b"), "keydown", { key: "Escape", preventDefault() {} });
  click(document.getElementById("edit-b"));
  typeInto(document.getElementById("url-b"), "https://news.example/uk");
  fire(document.getElementById("url-b"), "blur", {});
  assert.equal(document.getElementById("url-b"), null);
  assert.equal(document.getElementById("name-b").textContent, "news.example/uk");
  assert.equal(document.getElementById("host-b").textContent, "news.example");
  assert.equal(document.getElementById("path-b").textContent, "/uk");
  assert.equal(document.getElementById("unsaved").textContent, "You have unsaved changes.");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "Beta");
  assert.deepEqual(area.sets, []);

  click(document.getElementById("discard"));
  assert.equal(document.getElementById("name-b").textContent, "b.example/beta");
  assert.equal(document.getElementById("host-b").textContent, "b.example");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "Beta");

  click(document.getElementById("edit-b"));
  typeInto(document.getElementById("url-b"), "https://news.example/uk");
  fire(document.getElementById("url-b"), "keydown", { key: "Enter", preventDefault() {} });
  click(document.getElementById("save"));
  await flush();
  assert.equal(area.data[ORGANISER_RULES_KEY][1].label, "news.example/uk");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].hostname, "news.example");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].pathPrefix, "/uk");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].id, "b");
});

test("a clean options page keeps a rule added from the popup at the end of the list", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "Alpha", hostname: "a.example", pathPrefix: null },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();
  assert.equal(document.getElementById("name-a").textContent, "a.example");

  area.data[ORGANISER_RULES_KEY].push({
    id: "popup-rule",
    label: "b.example/docs",
    hostname: "b.example",
    pathPrefix: "/docs",
  });
  click(document.getElementById("save"));
  await flush();

  assert.deepEqual(area.data[ORGANISER_RULES_KEY].map((rule) => rule.id), ["a", "popup-rule"]);
  assert.equal(area.data[ORGANISER_RULES_KEY][0].label, "Alpha");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].hostname, "b.example");
  assert.equal(area.data[ORGANISER_RULES_KEY][1].pathPrefix, "/docs");
  assert.equal(document.getElementById("name-popup-rule").textContent, "b.example/docs");
  assert.equal(document.getElementById("rules").children[1].id, "rule-popup-rule");
  assert.equal(area.sets.length, 0);
});

test("options Save keeps an unsaved edit and a rule added from the popup", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "a.example", hostname: "a.example", pathPrefix: null },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();

  click(document.getElementById("add"));
  typeInto(document.getElementById("url-new"), "https://c.example/notes/today");
  fire(document.getElementById("url-new"), "keydown", { key: "Enter", preventDefault() {} });
  area.data[ORGANISER_RULES_KEY].push({
    id: "popup-rule",
    label: "b.example/docs",
    hostname: "b.example",
    pathPrefix: "/docs",
  });
  click(document.getElementById("save"));
  await flush();

  const saved = area.data[ORGANISER_RULES_KEY];
  assert.deepEqual(saved.map((rule) => rule.hostname), ["a.example", "c.example", "b.example"]);
  assert.equal(saved[1].pathPrefix, "/notes/today");
  assert.equal(saved[2].id, "popup-rule");
  assert.equal(saved[2].pathPrefix, "/docs");
  assert.equal(document.getElementById("name-popup-rule").textContent, "b.example/docs");
});

test("an open options page reloads a rule added from the popup when nothing is unsaved", async () => {
  const listeners = [];
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "a.example", hostname: "a.example", pathPrefix: null },
    ],
  });
  const document = createDocument();
  startOptionsPage({
    document,
    window: createWindow(),
    local: area,
    storageEvents: {
      addListener(fn) {
        listeners.push(fn);
      },
    },
  });
  await flush();
  assert.equal(listeners.length, 1);

  area.data[ORGANISER_RULES_KEY].push({
    id: "popup-rule",
    label: "b.example/docs",
    hostname: "b.example",
    pathPrefix: "/docs",
  });
  listeners[0]({ [ORGANISER_RULES_KEY]: {} }, "local");
  await flush();

  assert.equal(document.getElementById("name-popup-rule").textContent, "b.example/docs");
  assert.equal(document.getElementById("rules").children[1].id, "rule-popup-rule");
  assert.equal(document.getElementById("unsaved").textContent, "");
  assert.deepEqual(area.sets, []);

  click(document.getElementById("add"));
  area.data[ORGANISER_RULES_KEY].push({
    id: "later",
    label: "d.example",
    hostname: "d.example",
    pathPrefix: null,
  });
  listeners[0]({ [ORGANISER_RULES_KEY]: {} }, "local");
  await flush();
  assert.equal(document.getElementById("url-new") !== null, true);
  assert.equal(document.getElementById("name-later"), null);
});

test("opening the options page shows a rule the popup already saved, at the end", async () => {
  const area = callbackArea({
    [ORGANISER_RULES_KEY]: [
      { id: "a", label: "a.example", hostname: "a.example", pathPrefix: null },
      { id: "popup-rule", label: "spicymango.atlassian.net/browse", hostname: "spicymango.atlassian.net", pathPrefix: "/browse" },
    ],
  });
  const document = createDocument();
  startOptionsPage({ document, window: createWindow(), local: area });
  await flush();
  assert.equal(document.getElementById("rules").children[1].id, "rule-popup-rule");
  assert.equal(document.getElementById("name-popup-rule").textContent, "spicymango.atlassian.net/browse");
  assert.equal(document.getElementById("host-popup-rule").textContent, "spicymango.atlassian.net");
  assert.equal(document.getElementById("path-popup-rule").textContent, "/browse");
  assert.deepEqual(area.sets, []);
});
