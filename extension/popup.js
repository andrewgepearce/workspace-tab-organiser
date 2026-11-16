/**
 * Popup wiring for Preview and Apply.
 *
 * Tab reading and the two mutating calls live in browser-tabs.js.
 * Display data lives in preview.js. Apply lives in apply.js.
 * Saved rules come from the Local Rule Store. Cancel closes the popup.
 * Apply is enabled when a ready preview, or a preview with no groups, would
 * move at least 1 tab. Sorting single tabs can be that move.
 * The summary, group cards and collapsed lists are the D22 preview.
 * Add rule saves a rule for one unmatched tab, or one automatic group,
 * then plans the preview again. It does not move a tab.
 */

import { applyDisplayedPreview } from "./apply.js";
import { readScopedWindow } from "./browser-tabs.js";
import { appendRuleFromGroupKey } from "./popup-rule.js";
import {
  buildTabsReadFailure,
  buildUnreadableRulesPreview,
  inspectPreview,
} from "./preview.js";
import { ruleFieldMessage } from "./rule-draft.js";
import { createRuleStore } from "./rule-store.js";

const RULE_ADDED = "Rule added";
const DUPLICATE_RULE = ruleFieldMessage("rule", "duplicate");
const RULE_SAVE_FAILED = "The rule could not be saved. Nothing was written.";
const RULES_UNREADABLE = "Saved rules could not be read. Nothing was added.";
const RULE_UNSUPPORTED = "That tab cannot be saved as a rule. Nothing was added.";
const RULE_REFRESH_FAILED = "Rule added. The window could not be read again, so this preview was left as it was.";

/**
 * Wrap the local storage area with the callback form of get and set.
 * A failure is reported without copying `lastError` text.
 *
 * @param {{ get: Function, set: Function }} local
 * @param {{ lastError?: unknown } | null | undefined} runtime
 * @returns {{ get: (key: string) => Promise<Record<string, unknown>>, set: (items: Record<string, unknown>) => Promise<void> }}
 */
function localAreaAdapter(local, runtime) {
  const failed = () => Boolean(runtime && runtime.lastError);

  return {
    get(key) {
      return new Promise((resolve, reject) => {
        local.get(key, (items) => {
          if (failed()) {
            reject(new Error("storage read failed"));
            return;
          }
          resolve(items);
        });
      });
    },
    set(items) {
      return new Promise((resolve, reject) => {
        local.set(items, () => {
          if (failed()) {
            reject(new Error("storage write failed"));
            return;
          }
          resolve();
        });
      });
    },
  };
}

/**
 * Options page URL used when `openOptionsPage` is missing or fails.
 *
 * @param {{ getURL?: Function } | null | undefined} runtime
 * @returns {string}
 */
function optionsHref(runtime) {
  if (runtime && typeof runtime.getURL === "function") {
    try {
      const url = runtime.getURL("options.html");
      if (typeof url === "string" && url !== "") {
        return url;
      }
    } catch {
      return "options.html";
    }
  }
  return "options.html";
}

/**
 * @param {number} count
 * @returns {string}
 */
function tabCount(count) {
  return count === 1 ? "1 tab" : `${count} tabs`;
}

/**
 * Short reason shown beside Apply while it is disabled.
 * An empty string means Apply can run.
 *
 * @param {{ status: string, reason: string | null }} preview
 * @param {number} changeCount
 * @returns {string}
 */
function applyReason(preview, changeCount) {
  if ((preview.status === "ready" || preview.status === "no-matches") && changeCount >= 1) {
    return "";
  }
  if (preview.status === "ready" || preview.status === "no-matches") {
    return "Nothing to move";
  }
  if (preview.status === "no-rules") {
    return "No rules saved";
  }
  if (preview.status === "unreadable-rules" || preview.reason === "invalid-rules") {
    return preview.status === "unreadable-rules" ? "Rules could not be read" : "Rules are not valid";
  }
  return "Preview is not ready";
}

/**
 * @param {Document} document
 * @param {HTMLElement} section
 * @param {string} summaryText
 * @param {readonly string[]} lines
 */
/**
 * @param {Document} document
 * @param {string} message
 */
function showNotice(document, message) {
  const notice = document.getElementById("notice");
  if (!notice) {
    return;
  }
  notice.textContent = message;
}

/**
 * @param {Document} document
 * @param {string} key
 * @param {string} accessibleName
 * @param {(key: string) => Promise<void>} onAddRule
 * @returns {HTMLButtonElement}
 */
function addRuleButton(document, key, accessibleName, onAddRule) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-rule";
  button.textContent = "Add rule";
  button.ruleKey = key;
  if (typeof button.setAttribute === "function") {
    button.setAttribute("aria-label", `Add rule for ${accessibleName}`);
  }
  button.addEventListener("click", () => onAddRule(key));
  return button;
}

function appendDetails(document, section, summaryText, lines) {
  if (lines.length === 0) {
    return;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  const list = document.createElement("ul");
  for (const line of lines) {
    const row = document.createElement("li");
    row.textContent = line;
    list.append(row);
  }
  details.append(summary, list);
  section.append(details);
}

/**
 * @param {Document} document
 * @param {HTMLElement} section
 * @param {readonly { label: string, kind?: string, workspaceName: string, category: string, titles: string[] }[]} blocks
 * @param {boolean} showWorkspace
 * @param {readonly (string | null)[] | null | undefined} blockKeys
 * @param {(key: string) => Promise<void>} onAddRule
 */
function renderBlocks(document, section, blocks, showWorkspace, blockKeys, onAddRule) {
  section.replaceChildren();
  blocks.forEach((block, index) => {
    const article = document.createElement("article");
    article.className = "group-card";
    const head = document.createElement("div");
    head.className = "group-head";
    const title = document.createElement("h2");
    title.className = "group-name";
    title.textContent = block.label;
    const tag = document.createElement("span");
    tag.className = block.kind === "automatic" ? "tag automatic" : "tag rule";
    tag.textContent = block.kind === "automatic" ? "Automatic" : "Rule";
    head.append(title, tag);
    if (block.category === "Pinned") {
      const pinned = document.createElement("span");
      pinned.className = "tag pinned";
      pinned.textContent = "Pinned";
      head.append(pinned);
    }
    const key = blockKeys && blockKeys[index];
    if (typeof key === "string" && key !== "") {
      head.append(addRuleButton(document, key, block.label, onAddRule));
    }
    const count = document.createElement("p");
    count.className = "group-count";
    count.textContent = tabCount(block.titles.length);
    const list = document.createElement("ul");
    list.className = "tab-titles";
    for (const tabTitle of block.titles) {
      const row = document.createElement("li");
      row.className = "tab-title";
      row.textContent = tabTitle;
      row.title = tabTitle;
      list.append(row);
    }
    article.append(head, count);
    if (showWorkspace) {
      const workspace = document.createElement("p");
      workspace.className = "group-workspace";
      workspace.textContent = block.workspaceName;
      article.append(workspace);
    }
    article.append(list);
    section.append(article);
  });
}

/**
 * @param {Document} document
 * @param {HTMLElement} section
 * @param {readonly { title: string }[]} unmatched
 * @param {readonly (string | null)[] | null | undefined} unmatchedKeys
 * @param {(key: string) => Promise<void>} onAddRule
 */
function renderUnmatched(document, section, unmatched, unmatchedKeys, onAddRule) {
  section.replaceChildren();
  if (unmatched.length === 0) {
    return;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Unmatched (${unmatched.length})`;
  const list = document.createElement("ul");
  unmatched.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "unmatched-row";
    const title = document.createElement("span");
    title.className = "unmatched-title";
    title.textContent = item.title;
    title.title = item.title;
    row.append(title);
    const key = unmatchedKeys && unmatchedKeys[index];
    if (typeof key === "string" && key !== "") {
      row.append(addRuleButton(document, key, item.title, onAddRule));
    }
    list.append(row);
  });
  details.append(summary, list);
  section.append(details);
}

/**
 * @param {Document} document
 * @param {HTMLElement} section
 * @param {readonly { title: string, detail: string }[]} unavailable
 */
function renderUnavailable(document, section, unavailable) {
  section.replaceChildren();
  const nonWeb = unavailable.filter((item) => item.detail === "Not an HTTP or HTTPS page");
  const noAddress = unavailable.filter((item) => item.detail !== "Not an HTTP or HTTPS page");
  appendDetails(
    document,
    section,
    nonWeb.length === 1 ? "1 non-web tab ignored" : `${nonWeb.length} non-web tabs ignored`,
    nonWeb.map((item) => item.title),
  );
  appendDetails(
    document,
    section,
    noAddress.length === 1 ? "1 tab with no address" : `${noAddress.length} tabs with no address`,
    noAddress.map((item) => item.title),
  );
}

/**
 * @param {Document} document
 * @param {{ title: string, workspaceName: string, detail: string }[]} failures
 */
function renderReport(document, failures) {
  const section = document.getElementById("report");
  section.replaceChildren();
  if (failures.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const heading = document.createElement("h2");
  heading.textContent = "Could not move";
  const list = document.createElement("ul");
  for (const failure of failures) {
    const row = document.createElement("li");
    row.textContent = `${failure.title}. ${failure.workspaceName}. ${failure.detail}`;
    list.append(row);
  }
  section.append(heading, list);
}

/**
 * @param {Document} document
 * @param {import("./preview.js").PreviewView} preview
 * @param {number} changeCount
 * @param {{ blockKeys: readonly (string | null)[], unmatchedKeys: readonly (string | null)[] } | null | undefined} addRule
 * @param {(key: string) => Promise<void>} onAddRule
 */
function renderPreview(document, preview, changeCount, addRule, onAddRule) {
  document.getElementById("heading").textContent = preview.heading;
  const note = document.getElementById("scope-note");
  note.hidden = preview.note === null || preview.note === "";
  note.textContent = preview.note || "";
  document.getElementById("status").textContent = preview.message;
  renderBlocks(
    document,
    document.getElementById("blocks"),
    preview.blocks,
    preview.scoped !== true,
    addRule && addRule.blockKeys,
    onAddRule,
  );
  renderUnmatched(
    document,
    document.getElementById("unmatched"),
    preview.unmatched,
    addRule && addRule.unmatchedKeys,
    onAddRule,
  );
  renderUnavailable(document, document.getElementById("unavailable"), preview.unavailable);
  const reason = applyReason(preview, changeCount);
  document.getElementById("apply-reason").textContent = reason;
  document.getElementById("apply").disabled = reason !== "";
  renderReport(document, []);
}

/**
 * @param {Document} document
 * @param {{ name: string, version: string }} manifest
 */
function showManifest(document, manifest) {
  document.getElementById("name").textContent = manifest.name;
  document.getElementById("version").textContent = manifest.version;
}

/**
 * Open the options page. Opera's Runtime list records no difference from
 * Chrome, which provides `openOptionsPage`. If that method is missing or
 * fails, the click keeps the options URL on the link.
 *
 * @param {Event} event
 * @param {{ browser?: { runtime?: object }, window: Window }} page
 */
function openOptions(event, page) {
  const runtime = page.browser && page.browser.runtime;
  if (!runtime || typeof runtime.openOptionsPage !== "function") {
    return;
  }
  event.preventDefault();
  let settled = false;
  const fallback = () => {
    if (settled) {
      return;
    }
    settled = true;
    const location = page.window && page.window.location;
    if (location && typeof location.assign === "function") {
      location.assign(optionsHref(runtime));
    }
  };
  const succeed = () => {
    if (settled) {
      return;
    }
    settled = true;
  };
  try {
    const result = runtime.openOptionsPage(() => {
      if (runtime.lastError) {
        fallback();
        return;
      }
      succeed();
    });
    if (result && typeof result.then === "function") {
      result.then(() => succeed(), () => fallback());
    }
  } catch {
    fallback();
  }
}

/**
 * Bind the popup. `browser` is the chrome-like API. `local` is the local
 * storage area. Rules are loaded before tabs so an empty or unreadable list
 * does not query tab URLs.
 *
 * @param {{
 *   document: Document,
 *   window: Window,
 *   browser: { tabs?: { query?: Function }, runtime?: object },
 *   local: { get: Function, set: Function },
 *   manifest: { name: string, version: string, manifest_version: number, description: string }
 * }} page
 * @returns {Promise<void>}
 */
export async function startPopup(page) {
  const document = page.document;
  showManifest(document, page.manifest);
  const runtime = page.browser && page.browser.runtime;
  const options = document.getElementById("options");
  options.href = optionsHref(runtime);
  options.addEventListener("click", (event) => {
    openOptions(event, page);
  });
  document.getElementById("cancel").addEventListener("click", () => {
    page.window.close();
  });

  /** @type {{ fingerprint: Object | null }} */
  const shown = { fingerprint: null };

  let adding = false;

  /**
   * Save one rule from a grouping key and plan the preview again.
   * A duplicate or a failed write leaves the preview on screen.
   *
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function onAddRule(key) {
    if (adding) {
      return;
    }
    adding = true;
    try {
      let loaded;
      try {
        loaded = await createRuleStore(localAreaAdapter(page.local, runtime)).load();
      } catch {
        showNotice(document, RULES_UNREADABLE);
        return;
      }
      if (!loaded.ok) {
        showNotice(document, RULES_UNREADABLE);
        return;
      }
      const built = appendRuleFromGroupKey(key, loaded.rules);
      if (!built.ok) {
        if (built.reason === "duplicate") {
          showNotice(document, DUPLICATE_RULE);
          return;
        }
        if (built.reason === "invalid-rules") {
          showNotice(document, RULES_UNREADABLE);
          return;
        }
        showNotice(document, RULE_UNSUPPORTED);
        return;
      }
      let saved;
      try {
        saved = await createRuleStore(localAreaAdapter(page.local, runtime)).save(built.rules, {
          groupUnmatchedTabs: loaded.groupUnmatchedTabs,
        });
      } catch {
        showNotice(document, RULE_SAVE_FAILED);
        return;
      }
      if (!saved.ok || saved.written !== true) {
        showNotice(document, RULE_SAVE_FAILED);
        return;
      }
      try {
        const scoped = await readScopedWindow(page.browser);
        showInspection(inspectPreview(scoped.tabs, saved.rules, {
          groupUnmatchedTabs: saved.groupUnmatchedTabs,
          scope: scoped.scope,
        }));
        showNotice(document, RULE_ADDED);
      } catch {
        showNotice(document, RULE_REFRESH_FAILED);
      }
    } finally {
      adding = false;
    }
  }

  const showInspection = (inspected) => {
    shown.fingerprint = inspected.fingerprint;
    renderPreview(document, inspected.preview, inspected.changeCount, inspected.addRule, onAddRule);
  };

  document.getElementById("apply").addEventListener("click", async () => {
    const apply = document.getElementById("apply");
    if (apply.disabled || shown.fingerprint === null) {
      return;
    }
    apply.disabled = true;
    document.getElementById("status").textContent = "Checking this window before moving tabs.";
    let loaded;
    try {
      loaded = await createRuleStore(localAreaAdapter(page.local, runtime)).load();
    } catch {
      showInspection({ preview: buildUnreadableRulesPreview(), fingerprint: null, changeCount: 0 });
      return;
    }
    if (!loaded.ok) {
      showInspection({ preview: buildUnreadableRulesPreview(), fingerprint: null, changeCount: 0 });
      return;
    }
    const planning = { groupUnmatchedTabs: loaded.groupUnmatchedTabs };
    const result = await applyDisplayedPreview(page.browser, shown.fingerprint, loaded.rules, planning);
    if (result.status === "stale") {
      showInspection({
        preview: result.preview,
        fingerprint: result.fingerprint,
        changeCount: result.changeCount,
        addRule: result.addRule,
      });
      document.getElementById("status").textContent = "The tabs or saved rules changed, so nothing was moved. Review this preview and choose Apply again.";
      return;
    }
    if (result.status !== "applied" || !result.report) {
      showInspection({ preview: result.preview, fingerprint: null, changeCount: 0 });
      return;
    }
    document.getElementById("status").textContent = result.report.message;
    renderReport(document, result.report.failures);
    apply.disabled = true;
  });

  let loaded;
  try {
    loaded = await createRuleStore(localAreaAdapter(page.local, runtime)).load();
  } catch {
    showInspection({ preview: buildUnreadableRulesPreview(), fingerprint: null, changeCount: 0 });
    return;
  }
  if (!loaded.ok) {
    showInspection({ preview: buildUnreadableRulesPreview(), fingerprint: null, changeCount: 0 });
    return;
  }
  const planning = { groupUnmatchedTabs: loaded.groupUnmatchedTabs };
  if (loaded.rules.length === 0 && planning.groupUnmatchedTabs === false) {
    showInspection(inspectPreview([], loaded.rules, planning));
    return;
  }

  try {
    const scoped = await readScopedWindow(page.browser);
    showInspection(inspectPreview(scoped.tabs, loaded.rules, { ...planning, scope: scoped.scope }));
  } catch {
    showInspection({ preview: buildTabsReadFailure(), fingerprint: null, changeCount: 0 });
  }
}

const manifestSource = typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function"
  ? chrome.runtime.getManifest()
  : null;
const localArea = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

if (typeof document !== "undefined") {
  if (manifestSource && localArea) {
    startPopup({
      document,
      window,
      browser: chrome,
      local: localArea,
      manifest: manifestSource,
    });
  } else {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "The current window could not be read, so no preview was planned.";
    }
  }
}
