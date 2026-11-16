import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runProbe } from "../extension/dev/move-probe.js";
import {
  EXPERIMENT_LABELS,
  MOVE_SETTLE_MS,
  PRE_MOVE_DELAY_MS,
  TEST_A_WORKSPACE_NAME,
  assertUnpinnedTestAIds,
  buildExperimentRecord,
  buildReport,
  chooseComparisonOffset,
  chooseRestoreMethods,
  classifyMoves,
  guardTestAWindow,
  othersKeptRelativeOrder,
  planAppendStep,
  planExperiment,
  planOriginalIndexStep,
  publicError,
  selectShift,
  snapshotTab,
  statusLine,
} from "../extension/dev/move-plan.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tab(id, index, workspaceName, overrides = {}) {
  return {
    id,
    index,
    pinned: false,
    active: false,
    workspaceId: workspaceName === "Test A" ? "9" : "1",
    workspaceName,
    title: `Tab ${id}`,
    url: `https://example.invalid/${id}`,
    pendingUrl: `https://example.invalid/${id}?next`,
    favIconUrl: `https://example.invalid/${id}.ico`,
    ...overrides,
  };
}

/**
 * Dense window. Test A is indexes 6 to 10, with a pin at 6.
 * Four unpinned tabs give room to move right by 3.
 *
 * @returns {Object[]}
 */
function sampleWindow() {
  return [
    tab(1, 0, "Workspace 1", { active: true, workspaceId: "0", title: "Workspace 1" }),
    tab(2, 1, "Gameday", { active: true, workspaceId: "1" }),
    tab(3, 2, "Spicy Mango", { active: true, workspaceId: "2" }),
    tab(4, 3, "Atlassian", { active: true, workspaceId: "6" }),
    tab(5, 4, "Lucid", { active: true, workspaceId: "5" }),
    tab(6, 5, "LinkedIn", { active: true, workspaceId: "8" }),
    tab(7, 6, "Test A", { pinned: true, title: "Pinned" }),
    tab(8, 7, "Test A", { title: "BBC Sport" }),
    tab(9, 8, "Test A", { active: true, title: "Example" }),
    tab(10, 9, "Test A", { title: "News" }),
    tab(11, 10, "Test A", { title: "London" }),
    tab(12, 11, "Test B", { active: true, workspaceId: "10", title: "Weather" }),
    tab(13, 12, "Test B", { workspaceId: "10", title: "Other" }),
  ];
}

function guardSample() {
  const state = guardTestAWindow(sampleWindow());
  assert.equal(state.ok, true);
  return state;
}

function noUrlKeys(value, trail = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => noUrlKeys(item, `${trail}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      assert.equal(["url", "pendingUrl", "favIconUrl"].includes(key), false, `${trail}.${key}`);
      noUrlKeys(value[key], `${trail}.${key}`);
    }
  }
}

function createBrowser(initial, strategy) {
  const tabs = initial.map((entry) => ({ ...entry }));
  const calls = [];
  const listeners = new Set();
  const api = {
    query(queryInfo, callback) {
      calls.push({ method: "query", queryInfo });
      const copy = tabs.map((entry) => ({ ...entry }));
      if (typeof callback === "function") {
        callback(copy);
      }
      return Promise.resolve(tabs.map((entry) => ({ ...entry })));
    },
    move(tabIds, props, callback) {
      const ids = Array.isArray(tabIds) ? tabIds.slice() : [tabIds];
      calls.push({
        method: "move",
        tabIds: ids,
        props: { ...props },
        asArray: Array.isArray(tabIds),
      });
      strategy(tabs, ids, props, (tabId, moveInfo) => {
        for (const listener of listeners) {
          listener(tabId, moveInfo);
        }
      });
      const moved = ids.map((id) => {
        const found = tabs.find((entry) => entry.id === id);
        return found ? { ...found } : null;
      });
      const result = Array.isArray(tabIds) ? moved : moved[0];
      if (typeof callback === "function") {
        callback(result);
      }
      return Promise.resolve(result);
    },
    update(tabId, props, callback) {
      calls.push({ method: "update", tabId, props: { ...props } });
      const found = tabs.find((entry) => entry.id === tabId);
      if (found && props && props.active === true) {
        for (const other of tabs) {
          if (other.workspaceName === found.workspaceName) {
            other.active = other.id === tabId;
          }
        }
      }
      const copy = found ? { ...found } : null;
      if (typeof callback === "function") {
        callback(copy);
      }
      return Promise.resolve(copy);
    },
    onMoved: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
  };
  return {
    calls,
    tabs,
    browser: {
      tabs: api,
      runtime: {
        getManifest() {
          return { version: "0.3.0" };
        },
      },
    },
  };
}

function clampMove(tabs, ids, _props, emit) {
  for (const id of ids) {
    const moving = tabs.find((entry) => entry.id === id);
    if (!moving) {
      continue;
    }
    const peers = tabs.filter((entry) => entry.workspaceName === moving.workspaceName);
    const lastIndex = Math.max(...peers.map((entry) => entry.index));
    const fromIndex = moving.index;
    if (fromIndex !== lastIndex) {
      for (const other of tabs) {
        if (other.index > fromIndex && other.index <= lastIndex) {
          other.index -= 1;
        }
      }
      moving.index = lastIndex;
      emit(id, { fromIndex, toIndex: moving.index, windowId: 1 });
    }
  }
}

function honourMove(tabs, ids, props, emit) {
  const ordered = [...tabs].sort((left, right) => left.index - right.index);
  const moving = ids.map((id) => ordered.find((entry) => entry.id === id)).filter(Boolean);
  const staying = ordered.filter((entry) => !ids.includes(entry.id));
  let at = props.index;
  if (!Number.isInteger(at) || at < 0) {
    at = staying.length;
  }
  if (at > staying.length) {
    at = staying.length;
  }
  const next = staying.slice();
  next.splice(at, 0, ...moving);
  const from = new Map(ordered.map((entry) => [entry.id, entry.index]));
  next.forEach((entry, index) => {
    entry.index = index;
  });
  for (const entry of moving) {
    if (entry.index !== from.get(entry.id)) {
      emit(entry.id, { fromIndex: from.get(entry.id), toIndex: entry.index, windowId: 1 });
    }
  }
}

function probeOptions() {
  let tick = 0;
  return {
    delay() {
      return Promise.resolve();
    },
    now() {
      tick += 1;
      return new Date(Date.UTC(2026, 10, 9, 0, 0, tick)).toISOString();
    },
    preMoveDelayMs: 0,
    settleMs: 0,
  };
}

test("the probe waits are short and named", () => {
  assert.equal(PRE_MOVE_DELAY_MS, 400);
  assert.equal(MOVE_SETTLE_MS, 150);
  assert.equal(TEST_A_WORKSPACE_NAME, "Test A");
  assert.deepEqual(EXPERIMENT_LABELS, [
    "move-right-by-1",
    "move-right-by-2",
    "move-right-by-3",
    "move-left-by-1",
    "move-left-by-2",
    "move-to-first-unpinned",
    "move-to-index-minus-one",
    "move-two-tabs",
    "move-after-delay",
    "move-after-activate",
    "move-window-relative",
    "move-workspace-local",
  ]);
});

test("guard keeps only exact Test A tabs, sorted by window index, with no URL", () => {
  const queried = sampleWindow().slice().sort((left, right) => right.index - left.index);
  const state = guardTestAWindow(queried);
  assert.equal(state.ok, true);
  assert.deepEqual(
    state.testA.map((entry) => entry.index),
    [6, 7, 8, 9, 10],
  );
  assert.deepEqual(
    state.testA.map((entry) => entry.title),
    ["Pinned", "BBC Sport", "Example", "News", "London"],
  );
  assert.equal(state.testA[0].pinned, true);
  assert.equal(state.testA[2].active, true);
  assert.equal(state.start, 6);
  assert.equal(state.end, 10);
  const encoded = JSON.stringify(state);
  assert.equal(encoded.includes("https://"), false);
  assert.equal(encoded.includes("example.invalid"), false);
  noUrlKeys(state);
});

test("guard refuses a window that is not a safe Test A strip", () => {
  assert.equal(guardTestAWindow(null).reason, "not-an-array");
  assert.equal(
    guardTestAWindow([tab(1, 0, "Test B", { active: true })]).reason,
    "test-a-missing",
  );
  assert.equal(
    guardTestAWindow([tab(1, 0, "test a", { active: true })]).reason,
    "test-a-missing",
  );
  assert.equal(
    guardTestAWindow([tab(1, 0, "Test A ", { active: true })]).reason,
    "test-a-missing",
  );

  const missingName = tab(1, 0, "Test A", { active: true });
  missingName.workspaceName = "";
  assert.equal(guardTestAWindow([missingName]).reason, "tab-metadata-missing");

  const gap = sampleWindow().filter((entry) => entry.id !== 10);
  assert.equal(guardTestAWindow(gap).reason, "test-a-not-contiguous");

  const foreign = sampleWindow().map((entry) => ({ ...entry }));
  foreign.find((entry) => entry.id === 1).index = 8;
  foreign.find((entry) => entry.id === 9).index = 0;
  assert.equal(guardTestAWindow(foreign).reason, "foreign-index-inside-test-a");

  const mixedPin = sampleWindow().map((entry) => ({ ...entry }));
  mixedPin.find((entry) => entry.id === 10).pinned = true;
  assert.equal(guardTestAWindow(mixedPin).reason, "pinned-boundary-unclear");
});

test("snapshot drops URL fields and keeps a string workspace id", () => {
  const snap = snapshotTab(sampleWindow()[7]);
  assert.equal(snap.workspaceId, "9");
  assert.equal(snap.title, "BBC Sport");
  assert.equal(Object.hasOwn(snap, "url"), false);
  assert.equal(publicError(new Error("see https://example.invalid/secret")), "tabs call failed");
  assert.equal(publicError(new Error("tabs call failed")), "tabs call failed");
});

test("shifts stay inside unpinned Test A and never select a pinned tab", () => {
  const { testA } = guardSample();
  const pinnedId = testA.find((entry) => entry.pinned).id;
  for (const [direction, steps, fromIndex, index] of [
    ["right", 1, 7, 8],
    ["right", 2, 7, 9],
    ["right", 3, 7, 10],
    ["left", 1, 8, 7],
    ["left", 2, 9, 7],
  ]) {
    const decision = selectShift(testA, direction, steps);
    assert.equal(decision.ok, true, `${direction} ${steps}`);
    assert.equal(decision.index, index);
    assert.deepEqual(decision.tabIds, [testA.find((entry) => entry.index === fromIndex).id]);
    assert.equal(decision.tabIds.includes(pinnedId), false);
    assert.equal(assertUnpinnedTestAIds(decision.tabIds, testA).ok, true);
  }

  const short = testA.filter((entry) => entry.index <= 8);
  assert.equal(selectShift(short, "right", 3).reason, "no-room-inside-test-a");
  assert.equal(selectShift(testA.filter((entry) => entry.pinned), "left", 1).reason, "no-unpinned-tab");
});

test("window index and workspace-local index use the same n and differ when Test A starts after 0", () => {
  const { testA } = guardSample();
  const choice = chooseComparisonOffset(testA);
  assert.equal(choice.ok, true);
  assert.equal(choice.n, 2);
  assert.equal(choice.windowIndex, 8);
  assert.equal(choice.localIndex, 2);
  assert.equal(choice.inconclusive, false);
  assert.equal(choice.localHitsPinned, false);

  const context = { n: choice.n, inconclusive: false, localHitsPinned: false };
  const windowMove = planExperiment("move-window-relative", testA, context);
  const localMove = planExperiment("move-workspace-local", testA, context);
  assert.equal(windowMove.index, testA[0].index + choice.n);
  assert.equal(localMove.index, choice.n);
  assert.equal(windowMove.tabIds[0] === 7, false);
  assert.equal(assertUnpinnedTestAIds(windowMove.tabIds, testA).ok, true);
  assert.equal(assertUnpinnedTestAIds(localMove.tabIds, testA).ok, true);

  const atZero = testA.map((entry) => ({ ...entry, index: entry.index - 6 }));
  const same = chooseComparisonOffset(atZero);
  assert.equal(same.inconclusive, true);
  assert.equal(planExperiment("move-workspace-local", atZero, { n: same.n, inconclusive: true, localHitsPinned: false }).reason, "same-numeric-index");
});

test("the remaining experiments request a Test A unpinned tab", () => {
  const { testA } = guardSample();
  const context = { n: 2, inconclusive: false, localHitsPinned: false };
  const first = planExperiment("move-to-first-unpinned", testA, context);
  assert.equal(first.index, 7);
  assert.deepEqual(first.tabIds, [11]);

  const negative = planExperiment("move-to-index-minus-one", testA, context);
  assert.equal(negative.index, -1);
  assert.deepEqual(negative.tabIds, [8]);

  const pair = planExperiment("move-two-tabs", testA, context);
  assert.equal(pair.asArray, true);
  assert.deepEqual(pair.tabIds, [8, 9]);
  assert.equal(pair.index, 10);

  const delayed = planExperiment("move-after-delay", testA, context);
  assert.equal(delayed.ok, true);
  assert.equal(delayed.index, delayed.note.fromIndex + 1);

  const active = planExperiment("move-after-activate", testA, context);
  assert.equal(active.activateTabId, 8);
  assert.equal(active.restoreActiveTabId, 9);
  assert.equal(active.tabIds.includes(7), false);
});

test("experiment records compare requested and observed indexes and omit URLs", () => {
  const before = guardSample();
  const afterTabs = before.tabs.map((entry) => ({ ...entry }));
  const moved = afterTabs.find((entry) => entry.id === 8);
  moved.index = 10;
  afterTabs.find((entry) => entry.id === 9).index = 7;
  afterTabs.find((entry) => entry.id === 10).index = 8;
  afterTabs.find((entry) => entry.id === 11).index = 9;
  const after = guardTestAWindow(afterTabs);
  const record = buildExperimentRecord({
    label: "move-right-by-3",
    request: { tabIds: [8], index: 10, asArray: false },
    beforeTabs: before.tabs,
    beforeTestA: before.testA,
    afterTabs: after.tabs,
    afterTestA: after.testA,
    onMoved: [{ tabId: 8, fromIndex: 7, toIndex: 10, windowId: 1, url: "https://example.invalid/hidden" }],
    notes: { direction: "right", steps: 3 },
  });
  assert.equal(record.subjects[0].requestedIndex, 10);
  assert.equal(record.subjects[0].beforeIndex, 7);
  assert.equal(record.subjects[0].observedIndex, 10);
  assert.equal(record.subjects[0].observedWorkspaceName, "Test A");
  assert.equal(record.subjects[0].stayedInTestA, true);
  assert.equal(record.subjects[0].title, "BBC Sport");
  assert.deepEqual(record.onMoved, [{ tabId: 8, fromIndex: 7, toIndex: 10, windowId: 1 }]);
  assert.equal(record.othersKeptRelativeOrder, true);
  assert.equal(record.activeTabChanged, false);
  const report = buildReport({
    refused: false,
    experiments: [record],
    preMoveDelayMs: 400,
    settleMs: 150,
    startedAt: "2026-11-09T00:00:00.000Z",
    finishedAt: "2026-11-09T00:00:01.000Z",
  });
  noUrlKeys(report);
  assert.equal(JSON.stringify(report).includes("https://"), false);
  assert.equal(othersKeptRelativeOrder(before.testA, after.testA, [1]), false);
});

test("restore prefers the method that matches the observed moves", () => {
  const honours = buildExperimentRecord({
    label: "move-right-by-1",
    request: { tabIds: [8], index: 8, asArray: false },
    beforeTabs: guardSample().tabs,
    beforeTestA: guardSample().testA,
    afterTabs: guardSample().tabs.map((entry) => (entry.id === 8 ? { ...entry, index: 8 } : entry.id === 9 ? { ...entry, index: 7 } : entry)),
    afterTestA: guardTestAWindow(
      guardSample().tabs.map((entry) => (entry.id === 8 ? { ...entry, index: 8 } : entry.id === 9 ? { ...entry, index: 7 } : entry)),
    ).testA,
  });
  assert.equal(classifyMoves([honours]), "honours-requested-index");
  assert.deepEqual(chooseRestoreMethods("honours-requested-index", false), [
    "original-index",
    "append-to-workspace-end",
  ]);

  const { testA, tabs } = guardSample();
  const clampedTabs = tabs.map((entry) => ({ ...entry }));
  const sport = clampedTabs.find((entry) => entry.id === 8);
  const london = clampedTabs.find((entry) => entry.id === 11);
  sport.index = 10;
  london.index = 7;
  const clamped = buildExperimentRecord({
    label: "move-right-by-1",
    request: { tabIds: [8], index: 8, asArray: false },
    beforeTabs: tabs,
    beforeTestA: testA,
    afterTabs: clampedTabs,
    afterTestA: guardTestAWindow(clampedTabs).testA,
  });
  assert.equal(classifyMoves([clamped]), "clamps-to-workspace-end");
  assert.deepEqual(chooseRestoreMethods("clamps-to-workspace-end", true), [
    "append-to-workspace-end",
    "original-index",
    "append-via-index-minus-one",
  ]);
  assert.equal(classifyMoves([]), "unknown");
});

test("append and original-index plans only name unpinned Test A tabs", () => {
  const { testA } = guardSample();
  const scrambled = testA.map((entry) => ({ ...entry }));
  const sport = scrambled.find((entry) => entry.id === 8);
  const london = scrambled.find((entry) => entry.id === 11);
  sport.index = 10;
  london.index = 7;
  scrambled.sort((left, right) => left.index - right.index);
  const step = planOriginalIndexStep(scrambled, testA);
  assert.equal(step.tabId, 8);
  assert.equal(step.index, 7);
  assert.equal(step.tabId === 7, false);

  const unpinnedIds = testA.filter((entry) => !entry.pinned).map((entry) => entry.id);
  const append = planAppendStep(scrambled, unpinnedIds, 0, "end");
  assert.equal(append.skip, true);
  assert.equal(append.tabId, 8);
  const second = planAppendStep(scrambled, unpinnedIds, append.nextCursor, "end");
  assert.equal(second.skip, false);
  assert.equal(assertUnpinnedTestAIds([second.tabId], scrambled).ok, true);
});

test("a clamp-to-end browser is restored and never moved outside Test A", async () => {
  const fake = createBrowser(sampleWindow(), clampMove);
  const report = await runProbe(fake.browser, probeOptions());
  assert.equal(report.refused, false);
  assert.equal(report.manifestVersion, "0.3.0");
  assert.deepEqual(
    report.experiments.map((experiment) => experiment.label),
    EXPERIMENT_LABELS,
  );
  assert.equal(report.restore.classification, "clamps-to-workspace-end");
  assert.equal(report.restore.succeeded, true);
  assert.deepEqual(report.restore.finalOrder, [7, 8, 9, 10, 11]);
  assert.equal(report.restore.active.restored, true);

  const testAIds = new Set([7, 8, 9, 10, 11]);
  const unpinned = new Set([8, 9, 10, 11]);
  for (const call of fake.calls) {
    if (call.method === "query") {
      assert.deepEqual(call.queryInfo, { currentWindow: true });
    }
    if (call.method === "move") {
      assert.deepEqual(Object.keys(call.props), ["index"]);
      for (const id of call.tabIds) {
        assert.equal(unpinned.has(id), true, `moved ${id}`);
      }
    }
    if (call.method === "update") {
      assert.deepEqual(call.props, { active: true });
      assert.equal(testAIds.has(call.tabId), true);
    }
    assert.equal(["query", "move", "update"].includes(call.method), true);
  }
  const pair = fake.calls.find((call) => call.method === "move" && call.asArray);
  assert.ok(pair);
  assert.equal(pair.tabIds.length, 2);

  const moved = report.experiments.find((experiment) => experiment.label === "move-right-by-1");
  assert.equal(moved.subjects[0].requestedIndex !== moved.subjects[0].observedIndex, true);
  assert.equal(moved.subjects[0].observedIndex, moved.workspaceEndAfter);
  assert.equal(moved.subjects[0].stayedInTestA, true);
  assert.equal(moved.onMoved.length > 0, true);
  assert.equal(typeof moved.onMoved[0].fromIndex, "number");
  assert.equal(typeof moved.onMoved[0].toIndex, "number");

  const delayed = report.experiments.find((experiment) => experiment.label === "move-after-delay");
  assert.equal(delayed.skipped, false);
  assert.equal(delayed.notes.orderChangedDuringDelay, false);

  const activated = report.experiments.find((experiment) => experiment.label === "move-after-activate");
  assert.equal(activated.activeRestored, true);

  const local = report.experiments.find((experiment) => experiment.label === "move-workspace-local");
  assert.equal(local.requested.index, 2);
  assert.equal(local.subjects[0].stayedInTestA, true);
  noUrlKeys(report);
  assert.equal(JSON.stringify(report).includes("example.invalid"), false);
  assert.equal(statusLine(report), "Finished. Test A is back in its original order.");
});

test("a window without Test A is refused before any move", async () => {
  const fake = createBrowser(
    [tab(1, 0, "Workspace 1", { active: true, title: "Keep" })],
    clampMove,
  );
  const report = await runProbe(fake.browser, probeOptions());
  assert.equal(report.refused, true);
  assert.equal(report.refusalReason, "test-a-missing");
  assert.deepEqual(report.experiments, []);
  assert.equal(fake.calls.some((call) => call.method === "move" || call.method === "update"), false);
  assert.match(report.message, /exactly Test A/);
  noUrlKeys(report);
  assert.equal(statusLine(report), report.message);
});

test("a move that leaves Test A stops the run and does not move the other workspace", async () => {
  const fake = createBrowser(sampleWindow(), (tabs, ids, _props, emit) => {
    const moving = tabs.find((entry) => entry.id === ids[0]);
    if (!moving) {
      return;
    }
    const fromIndex = moving.index;
    moving.workspaceName = "Test B";
    emit(ids[0], { fromIndex, toIndex: fromIndex, windowId: 1 });
  });
  const report = await runProbe(fake.browser, probeOptions());
  assert.equal(report.refused, false);
  const moves = fake.calls.filter((call) => call.method === "move");
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].tabIds, [8]);
  assert.equal(report.experiments.find((experiment) => experiment.label === "move-right-by-1").subjects[0].stayedInTestA, false);
  assert.equal(report.experiments.find((experiment) => experiment.label === "move-right-by-2").skipReason, "tab-left-test-a");
  assert.equal(report.restore.succeeded, false);
  for (const call of fake.calls) {
    if (call.method === "move" || call.method === "update") {
      const ids = call.method === "move" ? call.tabIds : [call.tabId];
      for (const id of ids) {
        assert.equal([7, 8, 9, 10, 11].includes(id), true);
      }
    }
  }
});

test("an index-honouring browser is only asked to move unpinned Test A tabs", async () => {
  const fake = createBrowser(sampleWindow(), honourMove);
  const report = await runProbe(fake.browser, probeOptions());
  assert.equal(report.refused, false);
  const unpinned = new Set([8, 9, 10, 11]);
  for (const call of fake.calls.filter((entry) => entry.method === "move")) {
    assert.deepEqual(Object.keys(call.props), ["index"]);
    for (const id of call.tabIds) {
      assert.equal(unpinned.has(id), true);
    }
  }
  for (const call of fake.calls.filter((entry) => entry.method === "update")) {
    assert.deepEqual(call.props, { active: true });
    assert.equal([7, 8, 9, 10, 11].includes(call.tabId), true);
  }
  noUrlKeys(report);
});

test("the probe page is a module with a copy button and is not linked from the popup", () => {
  const html = readFileSync(path.join(root, "extension/dev/move-probe.html"), "utf8");
  const source = readFileSync(path.join(root, "extension/dev/move-probe.js"), "utf8");
  const popup = readFileSync(path.join(root, "extension/popup.html"), "utf8");
  const popupJs = readFileSync(path.join(root, "extension/popup.js"), "utf8");
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const manual = readFileSync(path.join(root, "docs/testing/manual-checks.md"), "utf8");

  assert.match(html, /<script type="module" src="move-probe\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.match(html, /id="copy"/);
  assert.match(html, /id="run"/);
  assert.match(html, /id="report"/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /writeText/);
  assert.match(source, /console\.log\(report\)/);
  assert.match(source, /addEventListener\("click"/);
  assert.doesNotMatch(source, /\.tabs\.(create|remove|reload|duplicate|discard|highlight|group|ungroup)\b/);
  assert.doesNotMatch(source, /tabGroups|fetch\(|location\.(href|assign|replace)|window\.open/);
  assert.match(source, /"move"/);
  assert.match(source, /"update"/);
  assert.match(source, /active:\s*true/);
  assert.doesNotMatch(popup, /move-probe/);
  assert.doesNotMatch(popupJs, /move-probe/);
  assert.match(manual, /extension\/dev\/move-probe\.html/);
  assert.match(manual, /chrome-extension:\/\/<id>\/dev\/move-probe\.html/);
  assert.match(readme, /docs\/testing\/manual-checks\.md/);
});
