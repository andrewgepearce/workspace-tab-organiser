/**
 * Manual Opera tabs.move probe.
 *
 * Open this directory's move-probe.html in the test window. The page moves
 * or activates a tab only when workspaceName is exactly "Test A". It does
 * not create, close, reload or navigate a tab. The popup does not load it.
 */

import {
  EXPERIMENT_LABELS,
  MOVE_SETTLE_MS,
  PRE_MOVE_DELAY_MS,
  TEST_A_WORKSPACE_NAME,
  activeIds,
  assertTestAIds,
  assertUnpinnedTestAIds,
  buildExperimentRecord,
  buildReport,
  chooseComparisonOffset,
  chooseRestoreMethods,
  classifyMoves,
  foreignIds,
  guardTestAWindow,
  negativeOneMovesInside,
  planAppendStep,
  planExperiment,
  planOriginalIndexStep,
  publicError,
  refusalMessage,
  sameIdOrder,
  statusLine,
} from "./move-plan.js";

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Call a tabs method. Opera documents callbacks. Chromium also returns a
 * promise. The first successful result wins.
 *
 * @param {Object} browser
 * @param {string} method
 * @param {unknown[]} args
 * @returns {Promise<unknown>}
 */
function callTabs(browser, method, args) {
  const tabsApi = browser && browser.tabs;
  const fn = tabsApi && tabsApi[method];
  if (typeof fn !== "function") {
    return Promise.reject(new Error("tabs-method-missing"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error instanceof Error ? error : new Error("tabs call failed"));
    };

    const succeed = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const callback = (value) => {
      const runtime = browser.runtime;
      if (runtime && runtime.lastError) {
        const last = runtime.lastError;
        fail(new Error(last.message || "tabs call failed"));
        return;
      }
      succeed(value);
    };

    let result;
    try {
      result = fn.apply(tabsApi, args.concat(callback));
    } catch (error) {
      fail(error);
      return;
    }

    if (result && typeof result.then === "function") {
      result.then(
        (value) => {
          const runtime = browser.runtime;
          if (runtime && runtime.lastError) {
            const last = runtime.lastError;
            fail(new Error(last.message || "tabs call failed"));
            return;
          }
          succeed(value);
        },
        (error) => fail(error),
      );
    }
  });
}

/**
 * @param {Object} browser
 * @returns {{ available: boolean, drain: () => Object[], stop: () => void }}
 */
function listenForMoves(browser) {
  const events = [];
  const tabsApi = browser && browser.tabs;
  const onMoved = tabsApi && tabsApi.onMoved;
  if (!onMoved || typeof onMoved.addListener !== "function") {
    return {
      available: false,
      drain() {
        return [];
      },
      stop() {},
    };
  }

  const listener = (tabId, moveInfo) => {
    const info = moveInfo || {};
    events.push({
      tabId,
      fromIndex: info.fromIndex,
      toIndex: info.toIndex,
      windowId: info.windowId,
    });
  };
  onMoved.addListener(listener);
  return {
    available: true,
    drain() {
      const copy = events.slice();
      events.length = 0;
      return copy;
    },
    stop() {
      if (typeof onMoved.removeListener === "function") {
        onMoved.removeListener(listener);
      }
    },
  };
}

/**
 * @param {Object} browser
 * @returns {string | null}
 */
function manifestVersion(browser) {
  const runtime = browser && browser.runtime;
  if (!runtime || typeof runtime.getManifest !== "function") {
    return null;
  }
  try {
    const manifest = runtime.getManifest();
    return manifest && typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * @param {Object} state
 * @returns {Object}
 */
function copyState(state) {
  return {
    ok: state.ok,
    reason: state.reason,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    testA: state.testA.map((tab) => ({ ...tab })),
    start: state.start,
    end: state.end,
  };
}

/**
 * @param {Object} browser
 * @returns {Promise<Object>}
 */
function readWindow(browser) {
  return callTabs(browser, "query", [{ currentWindow: true }]).then((tabs) => guardTestAWindow(tabs));
}

/**
 * A failed contiguity check can still name every Test A tab.
 * Restore may move those ids. A missing or duplicate strip may not.
 *
 * @param {Object} state
 * @returns {boolean}
 */
function restoreAllowed(state) {
  if (state.ok) {
    return true;
  }
  return (
    state.reason === "test-a-not-contiguous" ||
    state.reason === "foreign-index-inside-test-a" ||
    state.reason === "pinned-boundary-unclear"
  );
}

/**
 * @param {Array<string | number>} ids
 * @returns {string}
 */
function idKey(ids) {
  return ids.map((id) => String(id)).sort().join(",");
}

/**
 * @param {Object} browser
 * @param {Object} original
 * @param {Object[]} experiments
 * @param {(ms: number) => Promise<void>} wait
 * @param {number} settleMs
 * @returns {Promise<Object>}
 */
async function restoreOrder(browser, original, experiments, wait, settleMs) {
  const classification = classifyMoves(experiments);
  const methods = chooseRestoreMethods(classification, negativeOneMovesInside(experiments));
  const originalIds = original.testA.map((tab) => tab.id);
  const unpinnedIds = original.testA.filter((tab) => tab.pinned !== true).map((tab) => tab.id);
  const tried = [];
  let succeeded = false;

  for (const method of methods) {
    if (succeeded) {
      break;
    }
    const attempt = await runRestoreMethod(browser, method, original, originalIds, unpinnedIds, wait, settleMs);
    tried.push(attempt);
    succeeded = attempt.succeeded === true;
  }

  const active = await restoreActiveTab(browser, original, wait, settleMs);
  const finalState = await readWindow(browser);
  const orderOk =
    finalState.testA.length === originalIds.length && sameIdOrder(finalState.testA, originalIds);
  return {
    classification,
    methods,
    methodsTried: tried,
    succeeded: orderOk,
    originalOrder: originalIds,
    finalOrder: finalState.testA.map((tab) => tab.id),
    finalReason: finalState.ok ? null : finalState.reason,
    foreignOrderBefore: foreignIds(original.tabs),
    foreignOrderAfter: foreignIds(finalState.tabs),
    active,
  };
}

/**
 * @param {Object} browser
 * @param {string} method
 * @param {Object} original
 * @param {Array<string | number>} originalIds
 * @param {Array<string | number>} unpinnedIds
 * @param {(ms: number) => Promise<void>} wait
 * @param {number} settleMs
 * @returns {Promise<Object>}
 */
async function runRestoreMethod(browser, method, original, originalIds, unpinnedIds, wait, settleMs) {
  const issued = [];
  let cursor = 0;
  let skips = 0;
  const maxSteps = Math.max(unpinnedIds.length * unpinnedIds.length, 1) + 1;
  let steps = 0;
  let reason = null;

  while (steps < maxSteps) {
    const state = await readWindow(browser);
    if (!restoreAllowed(state)) {
      reason = state.reason;
      break;
    }
    if (state.testA.length === originalIds.length && sameIdOrder(state.testA, originalIds)) {
      return {
        method,
        succeeded: true,
        reason: null,
        moves: issued,
        order: state.testA.map((tab) => tab.id),
      };
    }
    if (state.testA.length !== originalIds.length) {
      reason = "tab-missing";
      break;
    }

    const step =
      method === "original-index"
        ? planOriginalIndexStep(state.testA, original.testA)
        : planAppendStep(
            state.testA,
            unpinnedIds,
            cursor,
            method === "append-via-index-minus-one" ? "minus-one" : "end",
          );
    if (!step.ok) {
      reason = step.reason;
      break;
    }
    if (step.done) {
      reason = "no-further-move";
      break;
    }
    if (step.skip) {
      cursor = step.nextCursor;
      skips += 1;
      if (skips >= Math.max(unpinnedIds.length, 1)) {
        reason = "append-skipped-a-full-cycle";
        break;
      }
      continue;
    }

    skips = 0;
    const allowed = assertUnpinnedTestAIds([step.tabId], state.testA);
    if (!allowed.ok) {
      reason = allowed.reason;
      break;
    }
    const before = state.testA.find((tab) => tab.id === step.tabId);
    try {
      await callTabs(browser, "move", [step.tabId, { index: step.index }]);
    } catch (error) {
      reason = publicError(error);
      break;
    }
    issued.push({ tabId: step.tabId, index: step.index });
    await wait(settleMs);
    const after = await readWindow(browser);
    const moved = after.tabs.find((tab) => tab.id === step.tabId);
    if (!moved || moved.workspaceName !== TEST_A_WORKSPACE_NAME) {
      reason = "tab-left-test-a";
      break;
    }
    if (moved.index === before.index && step.index !== before.index) {
      reason = "move-had-no-effect";
      break;
    }
    if (typeof step.nextCursor === "number") {
      cursor = step.nextCursor;
    }
    steps += 1;
  }

  const finalState = await readWindow(browser);
  const order = finalState.testA.map((tab) => tab.id);
  const succeeded = order.length === originalIds.length && sameIdOrder(finalState.testA, originalIds);
  return {
    method,
    succeeded,
    reason: succeeded ? null : reason || "order-differs",
    moves: issued,
    order,
  };
}

/**
 * @param {Object} browser
 * @param {Object} original
 * @param {(ms: number) => Promise<void>} wait
 * @param {number} settleMs
 * @returns {Promise<Object>}
 */
async function restoreActiveTab(browser, original, wait, settleMs) {
  const originalActive = original.testA.filter((tab) => tab.active === true);
  if (originalActive.length !== 1) {
    return { attempted: false, restored: false, reason: "active-tab-not-singular" };
  }
  const target = originalActive[0];
  const state = await readWindow(browser);
  if (!state.ok && !restoreAllowed(state)) {
    return { attempted: false, restored: false, reason: state.reason };
  }
  const current = state.tabs.find(
    (tab) => tab.id === target.id && tab.workspaceName === TEST_A_WORKSPACE_NAME,
  );
  if (!current) {
    return { attempted: false, restored: false, reason: "tab-left-test-a" };
  }
  const activeNow = state.testA.filter((tab) => tab.active === true);
  if (activeNow.length === 1 && activeNow[0].id === target.id) {
    return { attempted: false, restored: true, reason: null };
  }
  const allowed = assertTestAIds([target.id], state.testA);
  if (!allowed.ok) {
    return { attempted: false, restored: false, reason: allowed.reason };
  }
  try {
    await callTabs(browser, "update", [target.id, { active: true }]);
  } catch (error) {
    return { attempted: true, restored: false, reason: publicError(error) };
  }
  await wait(settleMs);
  const after = await readWindow(browser);
  const activeAfter = after.testA.filter((tab) => tab.active === true);
  const restored = activeAfter.length === 1 && activeAfter[0].id === target.id;
  return { attempted: true, restored, reason: restored ? null : "active-not-restored" };
}

/**
 * @param {Object} browser
 * @param {{ delay?: (ms: number) => Promise<void>, now?: () => string, preMoveDelayMs?: number, settleMs?: number }} [options]
 * @returns {Promise<Object>}
 */
export async function runProbe(browser, options = {}) {
  const wait = options.delay || delay;
  const now = options.now || (() => new Date().toISOString());
  const preMoveDelayMs = options.preMoveDelayMs === undefined ? PRE_MOVE_DELAY_MS : options.preMoveDelayMs;
  const settleMs = options.settleMs === undefined ? MOVE_SETTLE_MS : options.settleMs;
  const startedAt = now();
  const moves = listenForMoves(browser);

  const finish = (parts) => {
    moves.stop();
    return buildReport({
      manifestVersion: manifestVersion(browser),
      startedAt,
      finishedAt: now(),
      preMoveDelayMs,
      settleMs,
      ...parts,
    });
  };

  try {
    if (!browser || !browser.tabs || typeof browser.tabs.query !== "function") {
      return finish({
        refused: true,
        refusalReason: "tabs-api-missing",
        message: refusalMessage("tabs-api-missing"),
      });
    }

    const initial = await readWindow(browser);
    if (!initial.ok) {
      const names = [...new Set(initial.tabs.map((tab) => tab.workspaceName))].sort();
      return finish({
        refused: true,
        refusalReason: initial.reason,
        message: refusalMessage(initial.reason),
        snapshot: {
          tabCount: initial.tabs.length,
          workspaceNames: names,
        },
      });
    }

    const original = copyState(initial);
    const comparison = chooseComparisonOffset(original.testA);
    const context = comparison.ok
      ? {
          n: comparison.n,
          inconclusive: comparison.inconclusive,
          localHitsPinned: comparison.localHitsPinned,
        }
      : { n: null, inconclusive: true, localHitsPinned: false, reason: comparison.reason };

    const experiments = [];
    let aborted = null;
    let latest = original;

    for (const label of EXPERIMENT_LABELS) {
      if (aborted) {
        experiments.push(
          buildExperimentRecord({
            label,
            skipReason: aborted,
            beforeTabs: latest.tabs,
            beforeTestA: latest.testA,
            afterTabs: latest.tabs,
            afterTestA: latest.testA,
            notes: { aborted: true },
          }),
        );
        continue;
      }

      let state = await readWindow(browser);
      if (!state.ok) {
        aborted = state.reason;
        latest = state;
        experiments.push(
          buildExperimentRecord({
            label,
            skipReason: state.reason,
            beforeTabs: state.tabs,
            beforeTestA: state.testA,
            afterTabs: state.tabs,
            afterTestA: state.testA,
          }),
        );
        continue;
      }

      let orderChangedDuringDelay = null;
      if (label === "move-after-delay") {
        const beforeIds = state.testA.map((tab) => tab.id);
        await wait(preMoveDelayMs);
        state = await readWindow(browser);
        if (!state.ok) {
          aborted = state.reason;
          latest = state;
          experiments.push(
            buildExperimentRecord({
              label,
              skipReason: state.reason,
              beforeTabs: state.tabs,
              beforeTestA: state.testA,
              afterTabs: state.tabs,
              afterTestA: state.testA,
              notes: { orderChangedDuringDelay: null },
            }),
          );
          continue;
        }
        orderChangedDuringDelay = !sameIdOrder(state.testA, beforeIds);
      }

      const decision = planExperiment(label, state.testA, context);
      if (!decision.ok) {
        latest = state;
        const notes = orderChangedDuringDelay === null ? null : { orderChangedDuringDelay };
        experiments.push(
          buildExperimentRecord({
            label,
            skipReason: decision.reason,
            beforeTabs: state.tabs,
            beforeTestA: state.testA,
            afterTabs: state.tabs,
            afterTestA: state.testA,
            notes,
          }),
        );
        continue;
      }

      const allowed = assertUnpinnedTestAIds(decision.tabIds, state.testA);
      if (!allowed.ok) {
        latest = state;
        experiments.push(
          buildExperimentRecord({
            label,
            skipReason: allowed.reason,
            beforeTabs: state.tabs,
            beforeTestA: state.testA,
            afterTabs: state.tabs,
            afterTestA: state.testA,
          }),
        );
        continue;
      }

      const before = copyState(state);
      let activeImmediatelyBefore = before.testA;
      let error = null;

      if (decision.activateTabId !== null) {
        const activateCheck = assertTestAIds([decision.activateTabId], before.testA);
        if (!activateCheck.ok) {
          experiments.push(
            buildExperimentRecord({
              label,
              skipReason: activateCheck.reason,
              beforeTabs: before.tabs,
              beforeTestA: before.testA,
              afterTabs: before.tabs,
              afterTestA: before.testA,
            }),
          );
          continue;
        }
        try {
          await callTabs(browser, "update", [decision.activateTabId, { active: true }]);
        } catch (updateError) {
          error = publicError(updateError);
        }
        const afterActivate = await readWindow(browser);
        if (afterActivate.testA.length > 0) {
          activeImmediatelyBefore = afterActivate.testA;
        }
      }

      moves.drain();
      if (!error) {
        const payload = decision.asArray ? decision.tabIds.slice() : decision.tabIds[0];
        try {
          await callTabs(browser, "move", [payload, { index: decision.index }]);
        } catch (moveError) {
          error = publicError(moveError);
        }
      }
      await wait(settleMs);
      const onMoved = moves.drain();
      const afterMove = await readWindow(browser);

      if (decision.restoreActiveTabId !== null) {
        const stillThere = afterMove.tabs.some(
          (tab) => tab.id === decision.restoreActiveTabId && tab.workspaceName === TEST_A_WORKSPACE_NAME,
        );
        if (stillThere) {
          try {
            await callTabs(browser, "update", [decision.restoreActiveTabId, { active: true }]);
          } catch (restoreError) {
            error = error || publicError(restoreError);
          }
        }
      }

      const after = decision.restoreActiveTabId !== null ? await readWindow(browser) : afterMove;
      const notes = Object.assign({}, decision.note || {});
      if (orderChangedDuringDelay !== null) {
        notes.orderChangedDuringDelay = orderChangedDuringDelay;
      }
      const record = buildExperimentRecord({
        label,
        request: decision,
        beforeTabs: before.tabs,
        beforeTestA: before.testA,
        afterTabs: after.tabs,
        afterTestA: after.testA,
        activeImmediatelyBeforeMove: activeImmediatelyBefore,
        activeAfterMove: afterMove.testA,
        onMoved,
        error,
        activeRestored:
          decision.restoreActiveTabId === null
            ? null
            : idKey(activeIds(before.testA)) === idKey(activeIds(after.testA)),
        notes,
      });
      experiments.push(record);
      latest = after;

      const left = record.subjects.some((subject) => subject.stayedInTestA === false);
      if (left || !after.ok) {
        aborted = left ? "tab-left-test-a" : after.reason;
      }
    }

    const restore = await restoreOrder(browser, original, experiments, wait, settleMs);
    return finish({
      refused: false,
      snapshot: {
        testA: original.testA,
        start: original.start,
        end: original.end,
        queryOrder: original.tabs.map((tab) => ({
          id: tab.id,
          index: tab.index,
          workspaceName: tab.workspaceName,
        })),
        comparison,
        onMovedAvailable: moves.available,
        activeFields:
          "activeChangedByMove compares the Test A active tabs just before the move with the query after it. activeTabChanged compares the start of that experiment with the same query.",
      },
      experiments,
      restore,
    });
  } catch (error) {
    return finish({
      refused: true,
      refusalReason: "probe-failed",
      message: publicError(error),
    });
  }
}

/**
 * Wire the page when this module is loaded by move-probe.html.
 * Node imports this file for runProbe and does not have document.
 */
function boot() {
  if (typeof document === "undefined") {
    return;
  }
  const runButton = document.getElementById("run");
  const copyButton = document.getElementById("copy");
  const statusNode = document.getElementById("status");
  const reportNode = document.getElementById("report");
  if (!runButton || !copyButton || !statusNode || !reportNode) {
    return;
  }

  let reportText = "";

  const publish = (report) => {
    reportText = JSON.stringify(report, null, 2);
    reportNode.textContent = reportText;
    statusNode.textContent = statusLine(report);
    copyButton.disabled = false;
    console.log(report);
  };

  runButton.addEventListener("click", () => {
    runButton.disabled = true;
    copyButton.disabled = true;
    statusNode.textContent = "Running. Only Test A tabs are moved, and the probe then tries to restore them.";
    runProbe(globalThis.chrome)
      .then((report) => {
        publish(report);
      })
      .catch((error) => {
        publish(
          buildReport({
            refused: true,
            refusalReason: "probe-failed",
            message: publicError(error),
            startedAt: null,
            finishedAt: null,
            preMoveDelayMs: PRE_MOVE_DELAY_MS,
            settleMs: MOVE_SETTLE_MS,
          }),
        );
      })
      .finally(() => {
        runButton.disabled = false;
      });
  });

  copyButton.addEventListener("click", () => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      statusNode.textContent = "The clipboard call failed. Select the report and copy it.";
      return;
    }
    clipboard.writeText(reportText).then(
      () => {
        statusNode.textContent = "Copied the report.";
      },
      () => {
        statusNode.textContent = "The clipboard call failed. Select the report and copy it.";
      },
    );
  });
}

boot();
