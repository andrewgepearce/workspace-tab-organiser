import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readActiveWindowTabs, readScopedWindow } from "../extension/browser-tabs.js";
import {
  WINDOW_SCOPE_NOTE,
  WORKSPACE_NAME_UNAVAILABLE,
  detectCurrentWorkspace,
  tabsInScope,
} from "../extension/workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "extension/workspace.js"), "utf8");

/**
 * Opera 139 sample from 10 November 2026. Eight active tabs, one per
 * workspace. Test A's lastAccessed is newer than the others.
 */
function operaActiveSample() {
  return [
    { id: "w1", workspaceId: "0", workspaceName: "Workspace 1", lastAccessed: 1794234711598, highlighted: false },
    { id: "gameday", workspaceId: "1", workspaceName: "Gameday", lastAccessed: 1794235123456, highlighted: false },
    { id: "spicy", workspaceId: "2", workspaceName: "Spicy Mango", lastAccessed: 1794236800000, highlighted: false },
    { id: "atlassian", workspaceId: "6", workspaceName: "Atlassian", lastAccessed: 1794239000000, highlighted: false },
    { id: "lucid", workspaceId: "5", workspaceName: "Lucid", lastAccessed: 1794240000000, highlighted: false },
    { id: "linkedin", workspaceId: "8", workspaceName: "LinkedIn", lastAccessed: 1794241057999, highlighted: false },
    { id: "test-b", workspaceId: "10", workspaceName: "Test B", lastAccessed: 1794239500000, highlighted: false },
    { id: "test-a", workspaceId: "9", workspaceName: "Test A", lastAccessed: 1794315478421.848, highlighted: false },
  ];
}

test("workspace detection does not use highlighted, focus or a browser API", () => {
  assert.doesNotMatch(source, /highlighted|lastFocusedWindow|chrome\.|browser\.|document\.|localStorage|fetch\(/);
  assert.match(source, /export function detectCurrentWorkspace/);
  assert.match(source, /lastAccessed/);
});

test("Andrew's Opera 139 sample selects Test A by the newest lastAccessed", () => {
  const tabs = operaActiveSample();
  const before = structuredClone(tabs);
  const detected = detectCurrentWorkspace(tabs);
  assert.deepEqual(tabs, before);
  assert.deepEqual(detected, {
    mode: "workspace",
    workspaceId: "9",
    workspaceName: "Test A",
    note: null,
  });
  assert.equal(detected.workspaceName, "Test A");
});

test("an earlier tab wins when lastAccessed is equal", () => {
  const detected = detectCurrentWorkspace([
    { workspaceId: "a", workspaceName: "First", lastAccessed: 50 },
    { workspaceId: "b", workspaceName: "Second", lastAccessed: 50 },
  ]);
  assert.equal(detected.workspaceId, "a");
  assert.equal(detected.workspaceName, "First");
});

test("a tab with no lastAccessed is not a candidate", () => {
  const detected = detectCurrentWorkspace([
    { workspaceId: "old", workspaceName: "Old", lastAccessed: 10 },
    { workspaceId: "blank", workspaceName: "Blank" },
    { workspaceId: "newer", workspaceName: "Newer", lastAccessed: 11 },
  ]);
  assert.equal(detected.workspaceId, "newer");
});

test("a missing workspace id on the newest tab falls back to the whole window", () => {
  const cases = [
    [{ workspaceId: "older", workspaceName: "Older", lastAccessed: 1 }, { lastAccessed: 9, workspaceName: "Current" }],
    [{ workspaceId: "", workspaceName: "Blank", lastAccessed: 9 }],
    [{ workspaceId: null, workspaceName: "Null", lastAccessed: 9 }],
    [{ workspaceName: "No id", lastAccessed: 9 }],
    [{ workspaceId: "only" }],
    [],
    null,
    { workspaceId: "not-a-list", lastAccessed: 9 },
  ];
  for (const tabs of cases) {
    const detected = detectCurrentWorkspace(tabs);
    assert.equal(detected.mode, "window");
    assert.equal(detected.workspaceId, null);
    assert.equal(detected.workspaceName, null);
    assert.equal(detected.note, WINDOW_SCOPE_NOTE);
  }
});

test("a throwing lastAccessed or workspace id falls back to the whole window", () => {
  const tab = { workspaceName: "Hidden" };
  Object.defineProperty(tab, "lastAccessed", {
    get() {
      throw new Error("secret-token");
    },
  });
  const detected = detectCurrentWorkspace([tab]);
  assert.equal(detected.mode, "window");
  assert.equal(JSON.stringify(detected).includes("secret-token"), false);

  const nameless = { workspaceId: "9", lastAccessed: 4, workspaceName: "   " };
  const named = detectCurrentWorkspace([nameless]);
  assert.equal(named.mode, "workspace");
  assert.equal(named.workspaceName, WORKSPACE_NAME_UNAVAILABLE);
});

test("a throwing workspace id on the newest tab does not select an older workspace", () => {
  const newest = { workspaceName: "Newest", lastAccessed: 20 };
  Object.defineProperty(newest, "workspaceId", {
    get() {
      throw new Error("secret-token");
    },
  });
  const detected = detectCurrentWorkspace([
    { workspaceId: "older", workspaceName: "Older", lastAccessed: 1 },
    newest,
  ]);
  assert.equal(detected.mode, "window");
  assert.equal(JSON.stringify(detected).includes("secret-token"), false);
});

test("tabsInScope keeps one workspace and leaves the input list unchanged", () => {
  const tabs = [
    { id: "a", workspaceId: "9" },
    { id: "b", workspaceId: "10" },
    { id: "c", workspaceId: "9" },
    null,
  ];
  const scope = detectCurrentWorkspace([
    { workspaceId: "9", workspaceName: "Test A", lastAccessed: 2 },
    { workspaceId: "10", workspaceName: "Test B", lastAccessed: 1 },
  ]);
  const selected = tabsInScope(tabs, scope);
  assert.deepEqual(selected.map((tab) => tab && tab.id), ["a", "c"]);
  assert.equal(tabs.length, 4);
  assert.equal(tabsInScope(tabs, detectCurrentWorkspace([])).length, 4);
  assert.equal(tabsInScope(null, scope), null);
});

test("readActiveWindowTabs asks for the active tabs in the current window", async () => {
  const calls = [];
  const browser = {
    tabs: {
      query(queryInfo, callback) {
        calls.push(queryInfo);
        callback([
          { id: "later", index: 2, workspaceId: "9", lastAccessed: 3 },
          { id: "first", index: 0, workspaceId: "0", lastAccessed: 1 },
        ]);
      },
    },
  };
  const tabs = await readActiveWindowTabs(browser);
  assert.deepEqual(calls, [{ active: true, currentWindow: true }]);
  assert.deepEqual(tabs.map((tab) => tab.id), ["first", "later"]);
});

test("readScopedWindow keeps the newest workspace and falls back when active tabs cannot be read", async () => {
  const all = [
    { id: "a", index: 1, active: true, workspaceId: "9", workspaceName: "Test A", lastAccessed: 1794315478421.848 },
    { id: "b", index: 2, active: false, workspaceId: "9", workspaceName: "Test A", title: "Stay" },
    { id: "c", index: 0, active: true, workspaceId: "10", workspaceName: "Test B", lastAccessed: 1794241057999, title: "Weather" },
  ];
  const calls = [];
  const browser = {
    tabs: {
      query(queryInfo, callback) {
        calls.push({ ...queryInfo });
        const rows = queryInfo.active === true ? all.filter((tab) => tab.active) : all;
        callback(rows);
      },
    },
  };
  const scoped = await readScopedWindow(browser);
  assert.deepEqual(calls, [
    { active: true, currentWindow: true },
    { currentWindow: true },
  ]);
  assert.equal(scoped.scope.workspaceName, "Test A");
  assert.deepEqual(scoped.tabs.map((tab) => tab.id), ["a", "b"]);
  assert.equal(JSON.stringify(scoped.tabs).includes("Weather"), false);

  const failing = {
    tabs: {
      query(queryInfo, callback) {
        if (queryInfo.active === true) {
          throw new Error("secret-token");
        }
        callback(all);
      },
    },
  };
  const fallback = await readScopedWindow(failing);
  assert.equal(fallback.scope.mode, "window");
  assert.match(fallback.scope.note, /could not be detected/);
  assert.deepEqual(fallback.tabs.map((tab) => tab.id), ["c", "a", "b"]);
  assert.equal(JSON.stringify(fallback.scope).includes("secret-token"), false);
});
