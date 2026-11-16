/**
 * Build an Organiser Rule from an unmatched tab or an automatic group.
 *
 * This module is pure: it does not read storage, touch the DOM, or change
 * browser tabs. The grouping key comes from autoGroupKey. The name comes
 * from ruleDisplayName. The saved shape is the same one validateRules
 * accepts for a rule typed on the Options page.
 *
 * D27 uses the hostname plus the first path segment. A path that is only
 * `/` is no path prefix. The scheme, port, query and fragment are dropped.
 * The new rule is appended. A rule with the same hostname and path is
 * rejected, including a trailing slash and a path of `/`. D13 keeps the
 * derived name unique: if an older label uses that name for a different
 * host and path, that older label is stored as its own derived name.
 */

import { autoGroupKey } from "./auto-group.js";
import { createRuleId, validateRules } from "./matching.js";
import { ruleDisplayName } from "./url-rule.js";

/**
 * @param {{ id: string, label: string, hostname: string, pathPrefix: string | null }} rule
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
 * @param {string} reason
 * @returns {{ ok: false, reason: string }}
 */
function reject(reason) {
  return { ok: false, reason };
}

/**
 * @param {() => string} createId
 * @returns {string | null}
 */
function readId(createId) {
  let id;
  try {
    id = createId();
  } catch {
    return null;
  }
  if (typeof id !== "string" || id.trim() === "" || /\s/.test(id)) {
    return null;
  }
  return id;
}

/**
 * Give an older rule its derived name when its label is the new rule's name.
 * Other rules are copied unchanged. The input list is not changed.
 *
 * @param {readonly { id: string, label: string, hostname: string, pathPrefix: string | null }[]} rules
 * @param {string} label
 */
function releaseLabel(rules, label) {
  return rules.map((rule) => {
    if (rule.label !== label) {
      return plainRule(rule);
    }
    const derived = ruleDisplayName(rule.hostname, rule.pathPrefix);
    if (derived === "" || derived === rule.label) {
      return plainRule(rule);
    }
    return {
      id: rule.id,
      label: derived,
      hostname: rule.hostname,
      pathPrefix: rule.pathPrefix,
    };
  });
}

/**
 * Append one canonical rule, or explain why it was not appended.
 *
 * @param {string} hostname
 * @param {string | null} pathPrefix
 * @param {unknown} existingRules
 * @param {{ createId?: () => string }} options
 */
function appendBuilt(hostname, pathPrefix, existingRules, options) {
  const existing = validateRules(existingRules);
  if (!existing.ok) {
    return reject("invalid-rules");
  }
  const label = ruleDisplayName(hostname, pathPrefix);
  if (label === "") {
    return reject("unsupported");
  }
  const id = readId(options.createId ?? createRuleId);
  if (id === null) {
    return reject("invalid");
  }

  const candidate = { id, label, hostname, pathPrefix };
  const probe = validateRules([...existing.rules, candidate]);
  if (!probe.ok) {
    const duplicate = probe.errors.some((error) => error.field === "rule" && error.code === "duplicate");
    return reject(duplicate ? "duplicate" : "invalid");
  }

  const released = releaseLabel(existing.rules, label);
  if (released.some((rule) => rule.label === label)) {
    return reject("duplicate");
  }
  const saved = validateRules([...released, candidate]);
  if (!saved.ok) {
    const duplicate = saved.errors.some((error) => error.field === "rule" && error.code === "duplicate");
    return reject(duplicate ? "duplicate" : "invalid");
  }
  const rules = saved.rules.map(plainRule);
  return { ok: true, rule: rules[rules.length - 1], rules };
}

/**
 * Append a rule for one automatic-group key.
 * The key is a hostname, or a hostname plus one path segment. Anything
 * else, including a full URL, is rejected.
 *
 * @param {unknown} key
 * @param {unknown} existingRules
 * @param {{ createId?: () => string }} [options]
 * @returns {{ ok: true, rule: { id: string, label: string, hostname: string, pathPrefix: string | null }, rules: Array<{ id: string, label: string, hostname: string, pathPrefix: string | null }> } | { ok: false, reason: "unsupported" | "duplicate" | "invalid" | "invalid-rules" }}
 */
export function appendRuleFromGroupKey(key, existingRules, options = {}) {
  if (typeof key !== "string" || key.trim() === "" || key !== key.trim() || /\s/.test(key)) {
    return reject("unsupported");
  }
  if (autoGroupKey(`https://${key}`) !== key) {
    return reject("unsupported");
  }
  const slash = key.indexOf("/");
  const hostname = slash === -1 ? key : key.slice(0, slash);
  const pathPrefix = slash === -1 ? null : `/${key.slice(slash + 1)}`;
  return appendBuilt(hostname, pathPrefix, existingRules, options);
}

/**
 * Append a rule for one tab URL.
 * Only an HTTP or HTTPS URL with a hostname can produce a rule. The input
 * string is not changed.
 *
 * @param {unknown} url
 * @param {unknown} existingRules
 * @param {{ createId?: () => string }} [options]
 * @returns {{ ok: true, rule: { id: string, label: string, hostname: string, pathPrefix: string | null }, rules: Array<{ id: string, label: string, hostname: string, pathPrefix: string | null }> } | { ok: false, reason: "unsupported" | "duplicate" | "invalid" | "invalid-rules" }}
 */
export function appendRuleFromTabUrl(url, existingRules, options = {}) {
  const key = autoGroupKey(url);
  if (key === null) {
    return reject("unsupported");
  }
  return appendRuleFromGroupKey(key, existingRules, options);
}
