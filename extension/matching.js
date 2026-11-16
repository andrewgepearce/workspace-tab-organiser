/**
 * Ordered hostname and path-prefix matching for Organiser Rules.
 *
 * This module is pure: it does not read storage, touch the DOM, or change
 * browser tabs. A later popup can import it as a module script.
 *
 * Hostnames are compared exactly after WHATWG URL canonicalisation
 * (lowercase ASCII, punycode). A rule for `example.com` does not match
 * `www.example.com`, a parent host, or a deeper subdomain. Ports are not
 * part of the comparison. Asterisks are rejected so a hostname cannot be
 * read as a subdomain pattern.
 *
 * An omitted path prefix matches every path on that host. A prefix must
 * begin with `/` and is compared case-sensitively with the URL path.
 * Percent-encoding hex digits are uppercased. One trailing slash is ignored
 * on both sides, except for the prefix `/`, which matches every path. The
 * path must then equal the prefix or continue at a `/` segment boundary, so
 * `/product` does not match `/production`. Query strings and fragments are
 * ignored. Dot segments in a tab URL are resolved by the URL parser before
 * matching. A configured prefix that the parser would rewrite, including
 * `.` or `..` segments, is invalid.
 *
 * Rules are tried in the given order. The first match wins, including when
 * a later rule has a longer path prefix. Only `http:` and `https:` URLs can
 * match. Other schemes are unsupported. Malformed URLs and invalid rule
 * lists are rejected without throwing and without copying the URL into the
 * result. Two rules with the same hostname and the same path prefix are
 * rejected. One trailing slash does not make a path different, and a path
 * of `/` is the same as no path.
 */

/**
 * @typedef {Object} OrganiserRule
 * @property {string} id Stable identifier.
 * @property {string} label Non-empty display label.
 * @property {string} hostname Canonical hostname.
 * @property {string | null} pathPrefix Canonical path prefix, or null for any path.
 */

/**
 * @typedef {Object} RuleError
 * @property {string} field Rule field, or `rule` / `rules` for the whole value.
 * @property {"empty" | "invalid" | "duplicate"} code Machine-readable problem.
 */

/**
 * @typedef {Object} MatchResult
 * @property {"matched" | "unmatched" | "rejected"} status
 * @property {OrganiserRule | null} rule The first matching rule, otherwise null.
 * @property {"malformed-url" | "unsupported-url" | "invalid-rules" | null} reason
 */

/**
 * Uppercase percent-encoded hex digits so equivalent encodings compare equally.
 *
 * @param {string} value
 * @returns {string}
 */
function normalisePercentEncoding(value) {
  return value.replace(/%[0-9A-Fa-f]{2}/g, (encoded) => encoded.toUpperCase());
}

/**
 * Remove one trailing slash from a path that is not the root path.
 *
 * @param {string} pathname
 * @returns {string}
 */
function withoutSingleTrailingSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * Path used for the unique hostname-and-path check.
 * One trailing slash is ignored. The root path matches an omitted prefix.
 *
 * @param {string | null} pathPrefix
 * @returns {string}
 */
function identityPath(pathPrefix) {
  if (pathPrefix == null || pathPrefix === "/") {
    return "";
  }
  if (pathPrefix.length > 1 && pathPrefix.endsWith("/")) {
    return pathPrefix.slice(0, -1);
  }
  return pathPrefix;
}

/**
 * Report whether a canonical pathname matches a canonical path prefix.
 *
 * @param {string} pathname
 * @param {string | null} pathPrefix
 * @returns {boolean}
 */
function pathPrefixMatches(pathname, pathPrefix) {
  if (pathPrefix == null || pathPrefix === "/") {
    return true;
  }
  const path = withoutSingleTrailingSlash(pathname);
  const prefix = withoutSingleTrailingSlash(pathPrefix);
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Return the canonical hostname, or null when the value is not an exact host.
 *
 * @param {string} value
 * @returns {string | null}
 */
function canonicalHostname(value) {
  if (typeof value !== "string") {
    return null;
  }
  const hostname = value.trim();
  if (hostname.length === 0 || /[\s/?#\\@*]/.test(hostname) || hostname.includes("%")) {
    return null;
  }
  let url;
  try {
    url = new URL(`http://${hostname}/`);
  } catch {
    return null;
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === "" ||
    url.hostname.length > 253
  ) {
    return null;
  }
  const lowered = hostname.toLowerCase();
  const literal = lowered === url.hostname || lowered === url.host;
  const international = /[^\u0000-\u007f]/.test(hostname) && url.href === `http://${url.host}/`;
  if (!literal && !international) {
    return null;
  }
  return url.hostname;
}

/**
 * Return whether two paths are the same after encoding canonicalisation.
 * A parser rewrite such as removing `..` makes them different.
 *
 * @param {string} entered
 * @param {string} pathname
 * @returns {boolean}
 */
function sameDecodedPath(entered, pathname) {
  const left = normalisePercentEncoding(entered);
  const right = normalisePercentEncoding(pathname);
  if (left === right) {
    return true;
  }
  try {
    return decodeURIComponent(left) === decodeURIComponent(right);
  } catch {
    return false;
  }
}

/**
 * Canonicalise an optional path prefix.
 *
 * @param {string | null | undefined} value
 * @returns {{ ok: true, pathPrefix: string | null } | { ok: false }}
 */
function canonicalPathPrefix(value) {
  if (value == null) {
    return { ok: true, pathPrefix: null };
  }
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/") || value.startsWith("//")) {
    return { ok: false };
  }
  if (/[?#\\]/.test(value) || /\s/.test(value)) {
    return { ok: false };
  }
  let url;
  try {
    url = new URL(value, "http://example.invalid");
  } catch {
    return { ok: false };
  }
  if (
    url.hostname !== "example.invalid" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/")
  ) {
    return { ok: false };
  }
  if (!sameDecodedPath(value, url.pathname)) {
    return { ok: false };
  }
  return { ok: true, pathPrefix: normalisePercentEncoding(url.pathname) };
}

/**
 * Parse an eligible tab URL into a hostname and path.
 *
 * @param {unknown} value
 * @returns {{ ok: true, hostname: string, pathname: string } | { ok: false, reason: "malformed-url" | "unsupported-url" }}
 */
function parseHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: "malformed-url" };
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: "malformed-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported-url" };
  }
  if (url.hostname === "") {
    return { ok: false, reason: "malformed-url" };
  }
  return {
    ok: true,
    hostname: url.hostname.toLowerCase(),
    pathname: normalisePercentEncoding(url.pathname || "/"),
  };
}

/**
 * Copy a validated rule into a frozen object.
 *
 * @param {OrganiserRule} rule
 * @returns {OrganiserRule}
 */
function freezeRule(rule) {
  return Object.freeze({
    id: rule.id,
    label: rule.label,
    hostname: rule.hostname,
    pathPrefix: rule.pathPrefix,
  });
}

/**
 * Validate one Organiser Rule and return its canonical form.
 * The input object is not changed.
 *
 * @param {unknown} input
 * @returns {{ ok: true, rule: OrganiserRule } | { ok: false, errors: RuleError[] }}
 */
export function validateRule(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "rule", code: "invalid" }] };
  }

  const errors = [];
  let id = "";
  if (input.id == null) {
    errors.push({ field: "id", code: "empty" });
  } else if (typeof input.id !== "string") {
    errors.push({ field: "id", code: "invalid" });
  } else if (input.id.trim() === "") {
    errors.push({ field: "id", code: "empty" });
  } else if (input.id !== input.id.trim() || /\s/.test(input.id)) {
    errors.push({ field: "id", code: "invalid" });
  } else {
    id = input.id;
  }

  let label = "";
  if (input.label == null || (typeof input.label === "string" && input.label.trim() === "")) {
    errors.push({ field: "label", code: "empty" });
  } else if (typeof input.label !== "string") {
    errors.push({ field: "label", code: "invalid" });
  } else {
    label = input.label.trim();
  }

  const hostname = canonicalHostname(input.hostname);
  if (input.hostname == null || (typeof input.hostname === "string" && input.hostname.trim() === "")) {
    errors.push({ field: "hostname", code: "empty" });
  } else if (hostname === null) {
    errors.push({ field: "hostname", code: "invalid" });
  }

  const path = canonicalPathPrefix(input.pathPrefix);
  if (!path.ok) {
    errors.push({ field: "pathPrefix", code: "invalid" });
  }

  if (errors.length > 0 || hostname === null || !path.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rule: freezeRule({
      id,
      label,
      hostname,
      pathPrefix: path.pathPrefix,
    }),
  };
}

/**
 * Validate ordered Organiser Rules. Order is preserved. Ids must be unique.
 * The hostname and path prefix must be unique together.
 *
 * @param {unknown} inputs
 * @returns {{ ok: true, rules: OrganiserRule[] } | { ok: false, errors: Array<RuleError & { index: number | null }> }}
 */
export function validateRules(inputs) {
  if (!Array.isArray(inputs)) {
    return { ok: false, errors: [{ index: null, field: "rules", code: "invalid" }] };
  }

  const errors = [];
  const rules = [];
  const seenIds = new Set();
  const seenPaths = new Set();
  for (let index = 0; index < inputs.length; index += 1) {
    const result = validateRule(inputs[index]);
    if (!result.ok) {
      for (const error of result.errors) {
        errors.push({ index, field: error.field, code: error.code });
      }
      continue;
    }
    if (seenIds.has(result.rule.id)) {
      errors.push({ index, field: "id", code: "duplicate" });
      continue;
    }
    const pathKey = `${result.rule.hostname}\n${identityPath(result.rule.pathPrefix)}`;
    if (seenPaths.has(pathKey)) {
      errors.push({ index, field: "rule", code: "duplicate" });
      continue;
    }
    seenIds.add(result.rule.id);
    seenPaths.add(pathKey);
    rules.push(result.rule);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, rules };
}

/**
 * Assign a URL to the first matching rule.
 *
 * @param {readonly OrganiserRule[]} rules Canonical rules in priority order.
 * @param {{ ok: true, hostname: string, pathname: string }} parsed
 * @returns {MatchResult}
 */
function matchParsedUrl(rules, parsed) {
  for (const rule of rules) {
    if (rule.hostname === parsed.hostname && pathPrefixMatches(parsed.pathname, rule.pathPrefix)) {
      return { status: "matched", rule, reason: null };
    }
  }
  return { status: "unmatched", rule: null, reason: null };
}

/**
 * Select the first matching Organiser Rule for one URL.
 * Invalid rules and ineligible URLs are rejected without throwing.
 *
 * @param {unknown} url
 * @param {unknown} rules
 * @returns {MatchResult}
 */
export function matchUrl(url, rules) {
  const validated = validateRules(rules);
  if (!validated.ok) {
    return { status: "rejected", rule: null, reason: "invalid-rules" };
  }
  const parsed = parseHttpUrl(url);
  if (!parsed.ok) {
    return { status: "rejected", rule: null, reason: parsed.reason };
  }
  return matchParsedUrl(validated.rules, parsed);
}

/**
 * Read a tab URL without letting a throwing getter abort the batch.
 *
 * @param {unknown} tab
 * @returns {unknown}
 */
function readTabUrl(tab) {
  if (tab === null || typeof tab !== "object" || Array.isArray(tab)) {
    return undefined;
  }
  try {
    return tab.url;
  } catch {
    return undefined;
  }
}

/**
 * Assign each tab, in the given order, to its first matching rule.
 * Tab objects are not changed. A non-array tab list is a caller error.
 *
 * @param {unknown} tabs
 * @param {unknown} rules
 * @returns {MatchResult[]}
 */
export function matchTabs(tabs, rules) {
  if (!Array.isArray(tabs)) {
    throw new TypeError("tabs must be an array");
  }
  const validated = validateRules(rules);
  return tabs.map((tab) => {
    if (!validated.ok) {
      return { status: "rejected", rule: null, reason: "invalid-rules" };
    }
    const parsed = parseHttpUrl(readTabUrl(tab));
    if (!parsed.ok) {
      return { status: "rejected", rule: null, reason: parsed.reason };
    }
    return matchParsedUrl(validated.rules, parsed);
  });
}

/**
 * Create a stable rule identifier.
 *
 * @returns {string}
 */
export function createRuleId() {
  return crypto.randomUUID();
}
