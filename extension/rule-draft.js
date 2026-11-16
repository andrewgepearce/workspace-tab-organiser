/**
 * In-page draft for the Options Page.
 *
 * Edits stay in this draft until the caller saves or discards them. The
 * module does not touch the DOM or storage. Save validation uses
 * validateRules from the matching module. A blank or whitespace-only path
 * prefix is omitted, which means any path on that hostname. Any other path
 * prefix is passed through for validation.
 *
 * Each added rule gets an identifier from createRuleId, or from the injected
 * createId. That identifier is not changed by edit, move, or delete of
 * another rule. Moving a rule to an index repeats the one-step neighbour
 * swap until it lands there.
 */

import { createRuleId, validateRules } from "./matching.js";

/**
 * @typedef {Object} DraftRule
 * @property {string} id
 * @property {string} label
 * @property {string} hostname
 * @property {string} pathPrefix Blank means any path.
 */

/**
 * @typedef {Object} DraftFieldError
 * @property {number | null} index
 * @property {string | null} id
 * @property {string} field
 * @property {string} code
 * @property {string} message
 */

const FIELD_MESSAGES = {
  label: {
    empty: "Enter a label.",
    invalid: "Enter a label.",
  },
  hostname: {
    empty: "Enter a hostname.",
    invalid: "Enter a hostname such as example.com, without a scheme, port, path or wildcard.",
  },
  pathPrefix: {
    empty: "Enter a path prefix starting with /, or leave the field blank to match every path.",
    invalid: "Enter a path prefix starting with /, or leave the field blank to match every path.",
  },
  id: {
    empty: "This rule needs an identifier.",
    invalid: "This rule has an invalid identifier.",
    duplicate: "This identifier is already used by another rule.",
  },
  rule: {
    invalid: "This rule is not valid.",
    duplicate: "This hostname and path are already used by another rule.",
  },
  rules: {
    invalid: "The rule list is not valid.",
  },
};

/**
 * British English message for one validation problem.
 * The message does not include the entered value.
 *
 * @param {string} field
 * @param {string} code
 * @returns {string}
 */
export function ruleFieldMessage(field, code) {
  const forField = FIELD_MESSAGES[field];
  if (forField && Object.hasOwn(forField, code)) {
    return forField[code];
  }
  return "This value is not valid.";
}

/**
 * @param {DraftRule} rule
 * @returns {DraftRule}
 */
function copyRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    hostname: rule.hostname,
    pathPrefix: rule.pathPrefix,
  };
}

/**
 * @param {readonly DraftRule[]} rules
 * @returns {string}
 */
function snapshot(rules) {
  return JSON.stringify(rules.map(copyRule));
}

/**
 * Turn a stored or canonical rule into draft fields.
 *
 * @param {object} rule
 * @returns {DraftRule}
 */
function toDraftRule(rule) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    throw new TypeError("rule must be an object");
  }
  if (typeof rule.id !== "string" || rule.id.trim() === "" || /\s/.test(rule.id)) {
    throw new TypeError("rule id must be a non-empty string without spaces");
  }
  return {
    id: rule.id,
    label: typeof rule.label === "string" ? rule.label : "",
    hostname: typeof rule.hostname === "string" ? rule.hostname : "",
    pathPrefix: typeof rule.pathPrefix === "string" ? rule.pathPrefix : "",
  };
}

/**
 * @param {readonly object[]} rules
 * @returns {DraftRule[]}
 */
function copyDraft(rules) {
  return rules.map(toDraftRule);
}

/**
 * Prepare one draft rule for validateRules.
 * A blank path prefix becomes null. Other fields are left for the matcher.
 *
 * @param {DraftRule} rule
 * @returns {{ id: string, label: string, hostname: string, pathPrefix: string | null }}
 */
function toValidationRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    hostname: rule.hostname,
    pathPrefix: rule.pathPrefix.trim() === "" ? null : rule.pathPrefix,
  };
}

/**
 * Create a draft from the last saved rules.
 * Pass `{ unreadable: true }` when storage held a value that failed validation.
 * That flag does not count as an edit. replaceSaved clears it after a write.
 *
 * @param {readonly object[]} savedRules
 * @param {{ createId?: () => string, unreadable?: boolean }} [options]
 */
export function createRuleDraft(savedRules, options = {}) {
  if (!Array.isArray(savedRules)) {
    throw new TypeError("saved rules must be an array");
  }
  const createId = options.createId ?? createRuleId;
  if (typeof createId !== "function") {
    throw new TypeError("createId must be a function");
  }

  let unreadable = options.unreadable === true;
  let saved = copyDraft(savedRules);
  let draft = copyDraft(saved);

  /**
   * @param {string} id
   * @returns {number}
   */
  function indexOf(id) {
    return draft.findIndex((rule) => rule.id === id);
  }

  /**
   * Swap one rule with its neighbour. "up" raises priority.
   *
   * @param {number} index
   * @param {"up" | "down"} direction
   * @returns {boolean}
   */
  function swapWithNeighbour(index, direction) {
    const target = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
    if (target < 0 || target >= draft.length) {
      return false;
    }
    const current = draft[index];
    draft[index] = draft[target];
    draft[target] = current;
    return true;
  }

  return {
    /**
     * @returns {DraftRule[]}
     */
    rules() {
      return draft.map(copyRule);
    },

    /**
     * @returns {DraftRule[]}
     */
    savedRules() {
      return saved.map(copyRule);
    },

    /**
     * True when storage was unreadable or the draft differs from the saved list.
     *
     * @returns {boolean}
     */
    isDirty() {
      return unreadable || snapshot(draft) !== snapshot(saved);
    },

    /**
     * True only when the draft fields differ from the saved baseline.
     *
     * @returns {boolean}
     */
    hasEdits() {
      return snapshot(draft) !== snapshot(saved);
    },

    /**
     * True when the last load could not read a valid rule list.
     *
     * @returns {boolean}
     */
    isUnreadable() {
      return unreadable;
    },

    /**
     * Append a blank rule with a new stable identifier.
     *
     * @returns {string}
     */
    addRule() {
      const id = createId();
      if (typeof id !== "string" || id.trim() === "" || /\s/.test(id)) {
        throw new TypeError("createId must return a non-empty string without spaces");
      }
      draft.push({ id, label: "", hostname: "", pathPrefix: "" });
      return id;
    },

    /**
     * Change label, hostname, or path prefix. The identifier is ignored.
     *
     * @param {string} id
     * @param {Partial<Pick<DraftRule, "label" | "hostname" | "pathPrefix">>} patch
     * @returns {boolean}
     */
    updateRule(id, patch) {
      const index = indexOf(id);
      if (index < 0 || patch === null || typeof patch !== "object" || Array.isArray(patch)) {
        return false;
      }
      const rule = draft[index];
      if (Object.hasOwn(patch, "label")) {
        rule.label = typeof patch.label === "string" ? patch.label : "";
      }
      if (Object.hasOwn(patch, "hostname")) {
        rule.hostname = typeof patch.hostname === "string" ? patch.hostname : "";
      }
      if (Object.hasOwn(patch, "pathPrefix")) {
        rule.pathPrefix = typeof patch.pathPrefix === "string" ? patch.pathPrefix : "";
      }
      return true;
    },

    /**
     * Remove one rule. Other identifiers stay put.
     *
     * @param {string} id
     * @returns {boolean}
     */
    deleteRule(id) {
      const index = indexOf(id);
      if (index < 0) {
        return false;
      }
      draft.splice(index, 1);
      return true;
    },

    /**
     * Swap a rule with its neighbour. "up" raises priority.
     *
     * @param {string} id
     * @param {"up" | "down"} direction
     * @returns {boolean}
     */
    moveRule(id, direction) {
      const index = indexOf(id);
      if (index < 0) {
        return false;
      }
      return swapWithNeighbour(index, direction);
    },

    /**
     * Move a rule to an index by repeating the one-step swap.
     * Other rules keep their relative order. The same index is not a move.
     *
     * @param {string} id
     * @param {number} index
     * @returns {boolean}
     */
    moveRuleTo(id, index) {
      const start = indexOf(id);
      if (start < 0 || !Number.isInteger(index) || index < 0 || index >= draft.length || index === start) {
        return false;
      }
      const direction = index < start ? "up" : "down";
      let guard = draft.length;
      while (indexOf(id) !== index) {
        if (!swapWithNeighbour(indexOf(id), direction)) {
          return false;
        }
        guard -= 1;
        if (guard < 0) {
          return false;
        }
      }
      return true;
    },

    /**
     * Reload the saved rules into the draft.
     */
    revert() {
      draft = saved.map(copyRule);
    },

    /**
     * Adopt a list that has just been written. Clears the unreadable flag.
     *
     * @param {readonly object[]} rules
     */
    replaceSaved(rules) {
      if (!Array.isArray(rules)) {
        throw new TypeError("saved rules must be an array");
      }
      saved = copyDraft(rules);
      draft = saved.map(copyRule);
      unreadable = false;
    },

    /**
     * Ordered inputs for validateRules and the store.
     *
     * @returns {Array<{ id: string, label: string, hostname: string, pathPrefix: string | null }>}
     */
    validationInputs() {
      return draft.map(toValidationRule);
    },

    /**
     * Validate the whole draft. Does not write.
     *
     * @returns {{ ok: true, rules: Array<{ id: string, label: string, hostname: string, pathPrefix: string | null }>, errors: DraftFieldError[] } | { ok: false, errors: DraftFieldError[] }}
     */
    validate() {
      const inputs = draft.map(toValidationRule);
      const result = validateRules(inputs);
      if (!result.ok) {
        return {
          ok: false,
          errors: result.errors.map((error) => ({
            index: error.index,
            id: error.index == null ? null : draft[error.index]?.id ?? null,
            field: error.field,
            code: error.code,
            message: ruleFieldMessage(error.field, error.code),
          })),
        };
      }
      return {
        ok: true,
        rules: result.rules.map((rule) => ({
          id: rule.id,
          label: rule.label,
          hostname: rule.hostname,
          pathPrefix: rule.pathPrefix,
        })),
        errors: [],
      };
    },
  };
}
