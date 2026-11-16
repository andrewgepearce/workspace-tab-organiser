/**
 * Infer an Organiser Rule from a pasted or typed URL.
 *
 * This module is pure: it does not read storage, touch the DOM, or change
 * browser tabs. The derived name is the hostname plus the full path prefix.
 * A root URL gives the hostname alone. D13 revised: that name is not edited.
 *
 * D14: the hostname and the full path are filled in. The scheme, port,
 * query and fragment are dropped. One trailing slash is removed. A path
 * that is only `/` is no path prefix, so a bare origin matches every path
 * on that host. The result is accepted only when validateRule accepts it.
 * Anything else returns a message and does not describe a rule. The message
 * does not include the address, so a password in the URL is not copied out.
 */

import { validateRule } from "./matching.js";

const UNREADABLE = "Enter an http or https URL. The address could not be read.";
const UNSUPPORTED = "Enter an http or https URL. Other schemes are not used.";
const NO_HOST = "Enter an http or https URL with a hostname.";
const BAD_PATH = "That URL's path cannot be used as a path prefix.";

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
 * Fold a path the same way the options page displays it.
 * One trailing slash is removed. A root path is no path prefix.
 *
 * @param {string | null | undefined} pathPrefix
 * @returns {string}
 */
function foldedPath(pathPrefix) {
  if (typeof pathPrefix !== "string") {
    return "";
  }
  let path = pathPrefix.trim();
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (path === "/") {
    return "";
  }
  return path;
}

/**
 * Derived rule name: hostname plus the full path, or the hostname alone.
 * The result does not include a scheme, port, query or fragment.
 *
 * @param {unknown} hostname
 * @param {unknown} pathPrefix
 * @returns {string}
 */
export function ruleDisplayName(hostname, pathPrefix) {
  const host = typeof hostname === "string" ? hostname.trim() : "";
  if (host === "") {
    return "";
  }
  const path = foldedPath(typeof pathPrefix === "string" ? pathPrefix : null);
  if (path === "") {
    return host;
  }
  return path.startsWith("/") ? `${host}${path}` : `${host}/${path}`;
}

/**
 * @param {string} message
 * @returns {{ ok: false, message: string }}
 */
function reject(message) {
  return { ok: false, message };
}

/**
 * Infer hostname, path prefix and label from one address.
 * A blank path prefix is `""`, which the draft stores as every path.
 * The input string is not changed.
 *
 * @param {unknown} value
 * @returns {{ ok: true, hostname: string, pathPrefix: string, label: string } | { ok: false, message: string }}
 */
export function inferRuleFromUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return reject(UNREADABLE);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return reject(UNREADABLE);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject(UNSUPPORTED);
  }
  if (url.hostname === "") {
    return reject(NO_HOST);
  }

  const pathname = url.pathname === "" ? "/" : url.pathname;
  let pathPrefix = pathname === "/" ? "" : withoutSingleTrailingSlash(pathname);
  if (pathPrefix === "/") {
    pathPrefix = "";
  }

  const label = ruleDisplayName(url.hostname, pathPrefix);
  if (label === "") {
    return reject(UNREADABLE);
  }

  const validated = validateRule({
    id: "url-inference",
    label,
    hostname: url.hostname,
    pathPrefix: pathPrefix === "" ? null : pathPrefix,
  });
  if (!validated.ok) {
    if (validated.errors.some((error) => error.field === "pathPrefix")) {
      return reject(BAD_PATH);
    }
    if (validated.errors.some((error) => error.field === "hostname")) {
      return reject(NO_HOST);
    }
    return reject(UNREADABLE);
  }

  return {
    ok: true,
    hostname: validated.rule.hostname,
    pathPrefix: validated.rule.pathPrefix ?? "",
    label: validated.rule.label,
  };
}
