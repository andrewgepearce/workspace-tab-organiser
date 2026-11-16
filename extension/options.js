/**
 * Options page wiring for Organiser Rules.
 *
 * Draft edits, validation messages and reorder live in rule-draft.js.
 * A URL is turned into a hostname, path prefix and derived name by url-rule.js.
 * Persistence lives in rule-store.js. This file binds those modules to the
 * document and to the local storage area. Edits stay in the draft until
 * Save or Discard. Save writes only when the whole list is valid.
 *
 * A resting row shows a grip, the derived name, the hostname, the path,
 * an edit icon and a delete icon. The URL field appears after Add from URL,
 * or after the edit icon on a card. Dragging the grip reorders the row.
 * Delete has no confirmation because Discard restores the saved list until Save.
 *
 * A rule added from the popup is already in local storage. If this page is
 * open with no unsaved edits, a storage change reloads that list. Save reads
 * storage again and keeps a rule that was added after this page loaded, so
 * a stale draft cannot replace it. Unsaved edits stay, and those external
 * rules are appended.
 */

import { validateRules } from "./matching.js";
import { createRuleDraft, ruleFieldMessage } from "./rule-draft.js";
import { createRuleStore, ORGANISER_RULES_KEY, ORGANISER_SETTINGS_KEY } from "./rule-store.js";
import { inferRuleFromUrl, ruleDisplayName } from "./url-rule.js";

/**
 * Read a storage callback failure without copying the stored value.
 *
 * @returns {string}
 */
function storageFailureMessage() {
  const runtime = globalThis.chrome && globalThis.chrome.runtime;
  const message = runtime && runtime.lastError && runtime.lastError.message;
  return message ? "storage failed" : "";
}

/**
 * Wrap the local storage area with the callback form of get and set.
 *
 * @param {{ get: Function, set: Function }} local
 * @returns {{ get: (key: string) => Promise<Record<string, unknown>>, set: (items: Record<string, unknown>) => Promise<void> }}
 */
function localAreaAdapter(local) {
  return {
    get(key) {
      return new Promise((resolve, reject) => {
        local.get(key, (items) => {
          if (storageFailureMessage()) {
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
          if (storageFailureMessage()) {
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
 * @param {number} count
 * @returns {string}
 */
/**
 * Identity used to notice a rule added or removed outside this page.
 * Labels are left out, because Save still rewrites an older label.
 *
 * @param {{ id: string, hostname: string, pathPrefix: string | null }} rule
 * @returns {string}
 */
function ruleIdentity(rule) {
  return `${rule.id}\n${ruleDisplayName(rule.hostname, rule.pathPrefix)}`;
}

/**
 * @param {readonly { id: string, hostname: string, pathPrefix: string | null }[]} left
 * @param {readonly { id: string, hostname: string, pathPrefix: string | null }[]} right
 * @returns {boolean}
 */
function sameRuleIdentity(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((rule, index) => ruleIdentity(rule) === ruleIdentity(right[index]));
}

/**
 * Append rules that were saved elsewhere and are not already in this list.
 * A duplicate hostname and path is left out.
 *
 * @param {readonly object[]} rules
 * @param {readonly object[]} external
 */
function appendExternalRules(rules, external) {
  const next = rules.slice();
  for (const rule of external) {
    const probe = validateRules([...next, rule]);
    if (probe.ok) {
      next.push(probe.rules[probe.rules.length - 1]);
    }
  }
  return next;
}

function savedMessage(count) {
  if (count === 1) {
    return "Saved 1 rule on this browser.";
  }
  return `Saved ${count} rules on this browser.`;
}

/**
 * @param {string} pathPrefix
 * @returns {string}
 */
function shownPath(pathPrefix) {
  const named = ruleDisplayName("x", pathPrefix);
  if (named === "x") {
    return "Any path";
  }
  return named.slice("x".length);
}

/**
 * @param {Document} document
 * @param {string} tag
 * @returns {Element}
 */
function svgElement(document, tag) {
  if (typeof document.createElementNS === "function") {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }
  return document.createElement(tag);
}

/**
 * @param {Document} document
 * @returns {HTMLElement}
 */
function gripGraphic(document) {
  const grip = document.createElement("span");
  grip.className = "grip";
  grip.setAttribute("aria-hidden", "true");
  for (let dot = 0; dot < 6; dot += 1) {
    grip.append(document.createElement("span"));
  }
  return grip;
}

/**
 * @param {Document} document
 * @returns {Element}
 */
function penGraphic(document) {
  const icon = svgElement(document, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  const path = svgElement(document, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M2.2 13.8l.8-2.9 8.2-8.2a1.2 1.2 0 0 1 1.7 0l1.4 1.4a1.2 1.2 0 0 1 0 1.7l-8.2 8.2-2.9.8-.8-1z");
  icon.append(path);
  return icon;
}

function trashGraphic(document) {
  const icon = svgElement(document, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  const path = svgElement(document, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M6 2.2h4l.4.8H14v1.3h-.7l-.7 8.2a1 1 0 0 1-1 .9H4.4a1 1 0 0 1-1-.9l-.7-8.2H2V3h3.6l.4-.8zm.3 1.6h3.4v-.5H6.3v.5zM4.4 5.2l.5 7.2h6.2l.5-7.2H4.4z");
  icon.append(path);
  return icon;
}

/**
 * Bind the options page. Storage must be the local area.
 *
 * @param {{ document: Document, window: Window, local: { get: Function, set: Function } }} page
 */
export function startOptionsPage(page) {
  const document = page.document;
  const store = createRuleStore(localAreaAdapter(page.local));
  let draft = createRuleDraft([]);
  let visibleErrors = [];
  let busy = false;
  let settled = false;
  let committing = false;
  /** @type {{ id: string | null, value: string, error: string } | null} */
  let pending = null;
  let draggingId = null;
  let writing = false;

  const status = document.getElementById("status");
  const unsaved = document.getElementById("unsaved");
  const empty = document.getElementById("empty");
  const list = document.getElementById("rules");
  const addButton = document.getElementById("add");
  const saveButton = document.getElementById("save");
  const discardButton = document.getElementById("discard");
  const groupUnmatched = document.getElementById("group-unmatched");
  let savedGrouping = true;
  let draftGrouping = true;

  function dirty() {
    return draft.hasEdits() || draftGrouping !== savedGrouping || pending !== null;
  }

  function refreshActions() {
    unsaved.textContent = dirty() ? "You have unsaved changes." : "";
    addButton.disabled = busy || !settled || pending !== null;
    saveButton.disabled = busy || !settled;
    discardButton.disabled = busy || !settled || !dirty();
    groupUnmatched.disabled = busy || !settled;
    groupUnmatched.checked = draftGrouping;
    for (const control of list.querySelectorAll("input, button")) {
      const locked = control.dataset.locked === "true";
      control.disabled = busy || locked;
      if (String(control.className).split(/\s+/).includes("drag-handle")) {
        control.draggable = !control.disabled;
      }
    }
  }

  function alignLabels() {
    for (const rule of draft.rules()) {
      const name = ruleDisplayName(rule.hostname, rule.pathPrefix);
      if (name !== "" && rule.label !== name) {
        draft.updateRule(rule.id, { label: name });
      }
    }
  }

  /**
   * @param {HTMLElement} input
   * @param {HTMLElement} wrap
   * @param {string} message
   */
  function showUrlError(input, wrap, message) {
    input.setAttribute("aria-invalid", "true");
    let messageEl = wrap.querySelector(".field-error");
    if (!messageEl) {
      messageEl = document.createElement("p");
      messageEl.className = "field-error";
      messageEl.id = `${input.id}-error`;
      wrap.append(messageEl);
    }
    messageEl.textContent = message;
    input.setAttribute("aria-describedby", messageEl.id);
  }

  /**
   * @param {{ hostname: string, pathPrefix: string }} rule
   * @returns {string}
   */
  function ruleAsUrl(rule) {
    const host = typeof rule.hostname === "string" ? rule.hostname.trim() : "";
    const named = ruleDisplayName("x", rule.pathPrefix);
    const path = named === "x" ? "" : named.slice(1);
    return `https://${host}${path}`;
  }

  /**
   * @param {string | null} exceptId
   * @param {string} hostname
   * @param {string} pathPrefix
   * @returns {boolean}
   */
  function duplicatesOther(exceptId, hostname, pathPrefix) {
    const name = ruleDisplayName(hostname, pathPrefix);
    return draft.rules().some((rule) => {
      return rule.id !== exceptId && ruleDisplayName(rule.hostname, rule.pathPrefix) === name;
    });
  }

  function cancelPending() {
    const editedId = pending && pending.id;
    pending = null;
    renderRules();
    refreshActions();
    const edited = editedId ? document.getElementById(`edit-${editedId}`) : null;
    if (edited) {
      edited.focus();
    } else {
      addButton.focus();
    }
  }

  /**
   * @returns {boolean}
   */
  function commitPending() {
    if (!pending || committing) {
      return false;
    }
    committing = true;
    try {
      const inputId = pending.id ? `url-${pending.id}` : "url-new";
      const inferred = inferRuleFromUrl(pending.value);
      if (!inferred.ok) {
        pending.error = inferred.message;
        renderRules();
        refreshActions();
        const input = document.getElementById(inputId);
        if (input) {
          input.focus();
        }
        return false;
      }
      if (duplicatesOther(pending.id, inferred.hostname, inferred.pathPrefix)) {
        pending.error = ruleFieldMessage("rule", "duplicate");
        renderRules();
        refreshActions();
        const input = document.getElementById(inputId);
        if (input) {
          input.focus();
        }
        return false;
      }
      let focusId;
      if (pending.id) {
        draft.updateRule(pending.id, {
          label: inferred.label,
          hostname: inferred.hostname,
          pathPrefix: inferred.pathPrefix,
        });
        focusId = `edit-${pending.id}`;
      } else {
        const id = draft.addRule();
        draft.updateRule(id, {
          label: inferred.label,
          hostname: inferred.hostname,
          pathPrefix: inferred.pathPrefix,
        });
        focusId = `drag-${id}`;
      }
      pending = null;
      renderRules();
      refreshActions();
      const focusTarget = document.getElementById(focusId);
      if (focusTarget) {
        focusTarget.focus();
      }
      return true;
    } finally {
      committing = false;
    }
  }

  /**
   * @param {HTMLElement} item
   * @param {boolean} on
   */
  function markDrop(item, on) {
    const names = new Set(String(item.className).split(/\s+/).filter(Boolean));
    if (on) {
      names.add("drop-target");
    } else {
      names.delete("drop-target");
    }
    item.className = [...names].join(" ");
  }

  /**
   * @param {{ id: string, hostname: string, pathPrefix: string }} rule
   * @param {number} index
   */
  function renderRestingRow(rule, index) {
    const name = ruleDisplayName(rule.hostname, rule.pathPrefix) || `rule ${index + 1}`;
    const item = document.createElement("li");
    item.className = "rule";
    item.id = `rule-${rule.id}`;

    const handle = document.createElement("button");
    handle.type = "button";
    handle.id = `drag-${rule.id}`;
    handle.className = "drag-handle";
    handle.draggable = true;
    handle.setAttribute("aria-label", `Reorder ${name}`);
    handle.append(gripGraphic(document));
    handle.addEventListener("dragstart", (event) => {
      if (busy || handle.disabled) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        return;
      }
      draggingId = rule.id;
      if (event && event.dataTransfer) {
        event.dataTransfer.setData("text/plain", rule.id);
        event.dataTransfer.effectAllowed = "move";
      }
    });
    handle.addEventListener("dragend", () => {
      draggingId = null;
      for (const row of list.children) {
        markDrop(row, false);
      }
    });

    const nameEl = document.createElement("span");
    nameEl.className = "rule-name";
    nameEl.id = `name-${rule.id}`;
    nameEl.textContent = name;

    const editing = pending !== null && pending.id === rule.id;
    const hostEl = document.createElement("span");
    hostEl.className = "rule-host";
    hostEl.id = `host-${rule.id}`;
    hostEl.textContent = rule.hostname;

    const pathEl = document.createElement("span");
    pathEl.className = "rule-path";
    pathEl.id = `path-${rule.id}`;
    pathEl.textContent = shownPath(rule.pathPrefix);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.id = `edit-${rule.id}`;
    edit.className = "edit-rule";
    edit.setAttribute("aria-label", `Edit rule ${name}`);
    edit.append(penGraphic(document));
    if (pending && pending.id !== rule.id) {
      edit.dataset.locked = "true";
      edit.disabled = true;
    }
    edit.addEventListener("click", () => {
      if (busy || pending) {
        return;
      }
      pending = { id: rule.id, value: ruleAsUrl(rule), error: "" };
      renderRules();
      refreshActions();
      const input = document.getElementById(`url-${rule.id}`);
      if (input) {
        input.focus();
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.id = `delete-${rule.id}`;
    remove.className = "delete-rule";
    remove.setAttribute("aria-label", `Delete rule ${name}`);
    remove.append(trashGraphic(document));
    remove.addEventListener("click", () => {
      if (busy) {
        return;
      }
      if (pending && pending.id === rule.id) {
        pending = null;
      }
      const at = draft.rules().findIndex((itemRule) => itemRule.id === rule.id);
      draft.deleteRule(rule.id);
      visibleErrors = visibleErrors.filter((error) => error.id !== rule.id);
      renderRules();
      refreshActions();
      const remaining = draft.rules();
      const next = remaining[at] || remaining[at - 1];
      const nextButton = next ? document.getElementById(`delete-${next.id}`) : null;
      if (nextButton) {
        nextButton.focus();
      } else {
        addButton.focus();
      }
    });

    item.addEventListener("dragover", (event) => {
      if (!draggingId || draggingId === rule.id) {
        return;
      }
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      for (const row of list.children) {
        markDrop(row, row === item);
      }
    });
    item.addEventListener("drop", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      markDrop(item, false);
      const fromTransfer = event && event.dataTransfer && typeof event.dataTransfer.getData === "function"
        ? event.dataTransfer.getData("text/plain")
        : "";
      const sourceId = draggingId || fromTransfer;
      draggingId = null;
      if (busy || !sourceId || sourceId === rule.id) {
        return;
      }
      const to = draft.rules().findIndex((itemRule) => itemRule.id === rule.id);
      if (!draft.moveRuleTo(sourceId, to)) {
        return;
      }
      renderRules();
      refreshActions();
      const handleEl = document.getElementById(`drag-${sourceId}`);
      if (handleEl) {
        handleEl.focus();
      }
    });

    const actions = document.createElement("div");
    actions.className = "rule-actions";
    actions.append(edit, remove);
    const rowErrors = visibleErrors.filter((error) => error.id === rule.id);
    if (editing) {
      item.append(handle, nameEl, urlEditor(`url-${rule.id}`, `delete-${rule.id}`), actions);
    } else {
      item.append(handle, nameEl, hostEl, pathEl, actions);
    }
    if (rowErrors.length > 0) {
      handle.setAttribute("aria-invalid", "true");
      const message = document.createElement("p");
      message.className = "field-error rule-error";
      message.id = `error-${rule.id}`;
      message.textContent = rowErrors.map((error) => error.message).join(" ");
      handle.setAttribute("aria-describedby", message.id);
      item.append(message);
    }
    list.append(item);
  }

  /**
   * @param {string} inputId
   * @param {string} deleteId
   * @returns {HTMLElement}
   */
  function urlEditor(inputId, deleteId) {
    const wrap = document.createElement("div");
    wrap.className = "rule-entry";
    const labelEl = document.createElement("label");
    labelEl.htmlFor = inputId;
    labelEl.className = "visually-hidden";
    labelEl.textContent = "URL";
    const input = document.createElement("input");
    input.id = inputId;
    input.type = "text";
    input.value = pending ? pending.value : "";
    input.placeholder = "Paste a URL";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.autocapitalize = "off";
    wrap.append(labelEl, input);
    if (pending && pending.error) {
      showUrlError(input, wrap, pending.error);
    }
    input.addEventListener("input", () => {
      if (!pending || busy) {
        return;
      }
      pending.value = input.value;
      pending.error = "";
      input.removeAttribute("aria-invalid");
      const message = wrap.querySelector(".field-error");
      if (message) {
        message.remove();
      }
      input.removeAttribute("aria-describedby");
      refreshActions();
    });
    input.addEventListener("keydown", (event) => {
      if (!event || !pending) {
        return;
      }
      if (event.key === "Enter") {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        commitPending();
      } else if (event.key === "Escape") {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        cancelPending();
      }
    });
    input.addEventListener("blur", (event) => {
      if (!pending || committing) {
        return;
      }
      const next = event && event.relatedTarget;
      if (next && next.id === deleteId) {
        return;
      }
      if (pending.value.trim() === "") {
        return;
      }
      commitPending();
    });
    return wrap;
  }

  function renderPendingRow() {
    const item = document.createElement("li");
    item.className = "rule rule-pending";
    item.id = "rule-new";

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.dataset.locked = "true";
    handle.disabled = true;
    handle.setAttribute("aria-label", "Reorder the new rule");
    handle.append(gripGraphic(document));

    const nameEl = document.createElement("span");
    nameEl.className = "rule-name";
    nameEl.id = "name-new";
    nameEl.textContent = "";

    const wrap = urlEditor("url-new", "delete-new");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.id = "delete-new";
    remove.className = "delete-rule";
    remove.setAttribute("aria-label", "Delete rule");
    remove.append(trashGraphic(document));
    remove.addEventListener("click", () => {
      if (busy) {
        return;
      }
      cancelPending();
    });

    item.append(handle, nameEl, wrap, remove);
    list.append(item);
  }

  function renderRules() {
    const rules = draft.rules();
    empty.hidden = rules.length > 0 || pending !== null;
    list.replaceChildren();
    rules.forEach((rule, index) => {
      renderRestingRow(rule, index);
    });
    if (pending && pending.id === null) {
      renderPendingRow();
    }
  }

  function showInvalid() {
    status.textContent = "Nothing was saved. Correct the marked fields.";
    renderRules();
    refreshActions();
    const field = document.querySelector("[aria-invalid='true']");
    if (field) {
      field.focus();
    }
  }

  async function reloadSaved() {
    let loaded;
    try {
      loaded = await store.load();
    } catch {
      return;
    }
    if (!loaded.ok || writing || dirty()) {
      return;
    }
    draft = createRuleDraft(loaded.rules);
    savedGrouping = loaded.groupUnmatchedTabs !== false;
    draftGrouping = savedGrouping;
    visibleErrors = [];
    pending = null;
    status.textContent = "";
    renderRules();
    refreshActions();
  }

  /**
   * @param {Record<string, unknown> | null | undefined} changes
   * @param {string} areaName
   */
  function onStorageChanged(changes, areaName) {
    if (writing || busy || !settled || areaName !== "local" || dirty()) {
      return;
    }
    if (!changes || (!changes[ORGANISER_RULES_KEY] && !changes[ORGANISER_SETTINGS_KEY])) {
      return;
    }
    reloadSaved();
  }

  async function onSave() {
    if (busy || !settled || writing) {
      return;
    }
    if (pending && !commitPending()) {
      status.textContent = "Nothing was saved. Correct the marked fields.";
      return;
    }
    const clean = !draft.hasEdits() && !draft.isUnreadable() && pending === null && draftGrouping === savedGrouping;
    let loaded = null;
    try {
      loaded = await store.load();
    } catch {
      status.textContent = "The rules could not be saved. Nothing was written.";
      return;
    }
    if (loaded.ok && clean && !sameRuleIdentity(draft.savedRules(), loaded.rules)) {
      draft = createRuleDraft(loaded.rules);
      savedGrouping = loaded.groupUnmatchedTabs !== false;
      draftGrouping = savedGrouping;
      visibleErrors = [];
      pending = null;
      status.textContent = "Showing rules saved in another view. Nothing was written.";
      renderRules();
      refreshActions();
      return;
    }
    alignLabels();
    const view = draft.validate();
    if (!view.ok) {
      visibleErrors = view.errors;
      showInvalid();
      return;
    }
    const namedInputs = view.rules.map((rule) => ({
      ...rule,
      label: ruleDisplayName(rule.hostname, rule.pathPrefix) || rule.label,
    }));
    const baselineIds = new Set(draft.savedRules().map((rule) => rule.id));
    const external = loaded && loaded.ok
      ? loaded.rules.filter((rule) => !baselineIds.has(rule.id))
      : [];
    const named = validateRules(appendExternalRules(namedInputs, external));
    if (!named.ok) {
      visibleErrors = named.errors.map((error) => ({
        index: error.index,
        id: error.index == null ? null : draft.rules()[error.index]?.id ?? null,
        field: error.field,
        code: error.code,
        message: ruleFieldMessage(error.field, error.code),
      }));
      showInvalid();
      return;
    }
    busy = true;
    writing = true;
    refreshActions();
    try {
      const saved = await store.save(named.rules, { groupUnmatchedTabs: draftGrouping });
      if (!saved.ok || saved.written !== true) {
        status.textContent = "Nothing was saved.";
        return;
      }
      draft.replaceSaved(saved.rules);
      savedGrouping = saved.groupUnmatchedTabs;
      draftGrouping = savedGrouping;
      visibleErrors = [];
      status.textContent = savedMessage(saved.rules.length);
      renderRules();
    } catch {
      status.textContent = "The rules could not be saved. Nothing was written.";
    } finally {
      busy = false;
      writing = false;
      refreshActions();
    }
  }

  function onDiscard() {
    if (busy || !settled || !dirty()) {
      return;
    }
    draft.revert();
    draftGrouping = savedGrouping;
    visibleErrors = [];
    pending = null;
    draggingId = null;
    status.textContent = draft.isUnreadable()
      ? "Discarded unsaved changes. Saved rules could still not be read. Nothing was written."
      : "Discarded unsaved changes. Showing the last saved rules.";
    renderRules();
    refreshActions();
  }

  function onAdd() {
    if (busy || !settled || pending) {
      return;
    }
    pending = { id: null, value: "", error: "" };
    renderRules();
    refreshActions();
    const input = document.getElementById("url-new");
    if (input) {
      input.focus();
    }
  }

  addButton.addEventListener("click", onAdd);
  saveButton.addEventListener("click", onSave);
  discardButton.addEventListener("click", onDiscard);
  groupUnmatched.addEventListener("change", () => {
    if (busy || !settled) {
      groupUnmatched.checked = draftGrouping;
      return;
    }
    draftGrouping = groupUnmatched.checked === true;
    refreshActions();
  });

  const storageEvents = page.storageEvents
    || (globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.onChanged);
  if (storageEvents && typeof storageEvents.addListener === "function") {
    storageEvents.addListener(onStorageChanged);
  }

  page.window.addEventListener("beforeunload", (event) => {
    if (!dirty()) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  });

  addButton.disabled = true;
  saveButton.disabled = true;
  discardButton.disabled = true;
  groupUnmatched.disabled = true;

  store.load().then((loaded) => {
    settled = true;
    savedGrouping = loaded.groupUnmatchedTabs !== false;
    draftGrouping = savedGrouping;
    if (!loaded.ok) {
      draft = createRuleDraft([], { unreadable: true });
      status.textContent = "Saved rules could not be read. Nothing was written. Save a valid list to replace them.";
    } else {
      draft = createRuleDraft(loaded.rules);
      status.textContent = "";
    }
    renderRules();
    refreshActions();
  }).catch(() => {
    settled = true;
    draft = createRuleDraft([], { unreadable: true });
    status.textContent = "The rules could not be read. Nothing was written.";
    renderRules();
    refreshActions();
  });
}

const localArea = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
if (typeof document !== "undefined") {
  if (localArea) {
    startOptionsPage({ document, window, local: localArea });
  } else {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Local storage is not available. Nothing was written.";
    }
    for (const id of ["add", "save", "discard"]) {
      const button = document.getElementById(id);
      if (button) {
        button.disabled = true;
      }
    }
  }
}
