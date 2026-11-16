/**
 * Grouping key for tabs that match none of Andrew's Organiser Rules.
 *
 * This module is pure: it does not read storage, touch the DOM, or change
 * browser tabs. Only `http:` and `https:` URLs produce a key. Any other
 * scheme, including `opera:` and `chrome:` pages, returns null.
 *
 * The key is the WHATWG hostname plus the first non-empty path segment.
 * The hostname is already lower case. `www.` is kept, so `www.bbc.co.uk`
 * does not share a key with `bbc.co.uk`. A root path, or a path with no
 * segment, is the hostname alone. One trailing slash is ignored. Query
 * strings, fragments, the scheme and the port are not part of the key.
 * The path segment keeps its case. Percent-encoding hex digits are
 * uppercased. The URL parser resolves dot segments before the segment is
 * taken. Empty segments, as in `//sport`, are skipped.
 *
 * D12: the default rule is on unless the saved value is exactly false.
 * A missing setting, null, or any other value is on.
 */

/**
 * Uppercase percent-encoded hex digits so equivalent encodings share a key.
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
 * First non-empty path segment, or null when the path is only the root.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function firstPathSegment(pathname) {
  const path = withoutSingleTrailingSlash(normalisePercentEncoding(pathname || "/"));
  if (path === "" || path === "/") {
    return null;
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment !== "") {
      return segment;
    }
  }
  return null;
}

/**
 * Grouping key for one tab URL, or null when the URL cannot join a group.
 * The input is not changed. The result does not include userinfo, a query
 * or a fragment.
 *
 * @param {unknown} url
 * @returns {string | null}
 */
export function autoGroupKey(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.hostname === "") {
    return null;
  }
  const segment = firstPathSegment(parsed.pathname || "/");
  if (segment === null) {
    return parsed.hostname;
  }
  return `${parsed.hostname}/${segment}`;
}

/**
 * The default rule is on unless the value is exactly false.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function groupUnmatchedEnabled(value) {
  return value !== false;
}
