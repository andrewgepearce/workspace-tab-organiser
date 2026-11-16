/**
 * Local Rule Store for Organiser Rules.
 *
 * The store talks only to an injected storage adapter. The options page
 * supplies the local storage area. Tests pass a fake. This module does not
 * call synchronised storage, managed storage or a remote service.
 *
 * load treats a missing rules key as an empty list and does not write. A
 * present value that fails validateRules is reported as unreadable and is
 * left unchanged. The default-rule setting is a separate key. A missing
 * setting, or any value other than false, means the default rule is on.
 * save validates the whole ordered list and writes the canonical rules and
 * the setting in 1 adapter set, or writes nothing when the list is invalid.
 */

import { groupUnmatchedEnabled } from "./auto-group.js";
import { validateRules } from "./matching.js";

/** Storage key for the ordered rule list. Unrelated keys are not read or removed. */
export const ORGANISER_RULES_KEY = "organiserRules";

/** Storage key for the default-rule checkbox. */
export const ORGANISER_SETTINGS_KEY = "organiserSettings";

/**
 * @typedef {Object} StorageAdapter
 * @property {(key: string) => Promise<Record<string, unknown> | null>} get
 * @property {(items: Record<string, unknown>) => Promise<void>} set
 */

/**
 * @typedef {Object} StoredRule
 * @property {string} id
 * @property {string} label
 * @property {string} hostname
 * @property {string | null} pathPrefix
 */

/**
 * Copy a canonical rule into a plain object the storage API can hold.
 *
 * @param {{ id: string, label: string, hostname: string, pathPrefix: string | null }} rule
 * @returns {StoredRule}
 */
function plainRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    hostname: rule.hostname,
    pathPrefix: rule.pathPrefix,
  };
}

/**
 * Read the default-rule flag. Only an explicit false turns it off.
 *
 * @param {Record<string, unknown> | null} stored
 * @returns {boolean}
 */
function readGroupUnmatched(stored) {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return true;
  }
  if (!Object.hasOwn(stored, ORGANISER_SETTINGS_KEY)) {
    return true;
  }
  const value = stored[ORGANISER_SETTINGS_KEY];
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  if (!Object.hasOwn(value, "groupUnmatchedTabs")) {
    return true;
  }
  return groupUnmatchedEnabled(value.groupUnmatchedTabs);
}

/**
 * @param {Array<{ index: number | null, field: string, code: string }>} errors
 * @param {boolean} [groupUnmatchedTabs]
 * @returns {{ ok: false, rules: StoredRule[], reason: "unreadable", errors: Array<{ index: number | null, field: string, code: string }>, groupUnmatchedTabs: boolean }}
 */
function unreadable(errors, groupUnmatchedTabs = true) {
  return { ok: false, rules: [], reason: "unreadable", errors, groupUnmatchedTabs };
}

/**
 * Create a Local Rule Store bound to one storage adapter.
 *
 * @param {StorageAdapter} storage
 */
export function createRuleStore(storage) {
  if (
    storage === null ||
    typeof storage !== "object" ||
    typeof storage.get !== "function" ||
    typeof storage.set !== "function"
  ) {
    throw new TypeError("storage adapter must provide get and set");
  }

  return {
    /**
     * Read the saved rules. Does not write.
     *
     * @returns {Promise<{ ok: true, rules: StoredRule[], reason: null, groupUnmatchedTabs: boolean } | { ok: false, rules: StoredRule[], reason: "unreadable", errors: Array<{ index: number | null, field: string, code: string }>, groupUnmatchedTabs: boolean }>}
     */
    async load() {
      const stored = await storage.get(ORGANISER_RULES_KEY);
      const settings = await storage.get(ORGANISER_SETTINGS_KEY);
      const groupUnmatchedTabs = readGroupUnmatched(settings);
      if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
        return unreadable([{ index: null, field: "rules", code: "invalid" }], groupUnmatchedTabs);
      }
      if (!Object.hasOwn(stored, ORGANISER_RULES_KEY)) {
        return { ok: true, rules: [], reason: null, groupUnmatchedTabs };
      }
      const value = stored[ORGANISER_RULES_KEY];
      if (value == null) {
        return { ok: true, rules: [], reason: null, groupUnmatchedTabs };
      }
      const validated = validateRules(value);
      if (!validated.ok) {
        return unreadable(validated.errors, groupUnmatchedTabs);
      }
      return { ok: true, rules: validated.rules.map(plainRule), reason: null, groupUnmatchedTabs };
    },

    /**
     * Validate and persist the whole ordered list and the default-rule
     * setting in one write. An invalid list does not call the adapter set.
     * An omitted setting is stored as on.
     *
     * @param {unknown} inputs
     * @param {{ groupUnmatchedTabs?: unknown }} [options]
     * @returns {Promise<{ ok: true, written: true, rules: StoredRule[], groupUnmatchedTabs: boolean } | { ok: false, written: false, errors: Array<{ index: number | null, field: string, code: string }> }>}
     */
    async save(inputs, options = {}) {
      const validated = validateRules(inputs);
      if (!validated.ok) {
        return { ok: false, written: false, errors: validated.errors };
      }
      const rules = validated.rules.map(plainRule);
      const groupUnmatchedTabs = groupUnmatchedEnabled(options.groupUnmatchedTabs);
      await storage.set({
        [ORGANISER_RULES_KEY]: rules,
        [ORGANISER_SETTINGS_KEY]: { groupUnmatchedTabs },
      });
      return { ok: true, written: true, rules, groupUnmatchedTabs };
    },
  };
}
