import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createRuleId,
  matchTabs,
  matchUrl,
  validateRule,
  validateRules,
} from "../extension/matching.js";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../extension/matching.js"),
  "utf8",
);

function rule(overrides = {}) {
  return {
    id: "rule-1",
    label: "Example",
    hostname: "example.com",
    pathPrefix: null,
    ...overrides,
  };
}

function matchedId(url, rules) {
  const result = matchUrl(url, rules);
  assert.equal(result.status, "matched", url);
  assert.equal(result.reason, null);
  return result.rule.id;
}

test("module stays free of browser, storage, and Node built-ins", () => {
  assert.doesNotMatch(source, /node:|chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.match(source, /export function validateRule/);
  assert.match(source, /export function matchUrl/);
  assert.match(source, /export function matchTabs/);
});

test("validateRule canonicalises hostname and label without changing the input", () => {
  const input = {
    id: "docs",
    label: "  Product documentation  ",
    hostname: "  Docs.Example.COM  ",
    pathPrefix: "/product",
    secret: "do-not-copy",
  };
  const before = structuredClone(input);
  const result = validateRule(input);

  assert.deepEqual(input, before);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rule, {
    id: "docs",
    label: "Product documentation",
    hostname: "docs.example.com",
    pathPrefix: "/product",
  });
  assert.equal(Object.isFrozen(result.rule), true);
  assert.equal(Object.hasOwn(result.rule, "secret"), false);
});

test("an omitted path prefix means any path on that exact host", () => {
  for (const pathPrefix of [null, undefined]) {
    const result = validateRule(rule({ pathPrefix }));
    assert.equal(result.ok, true);
    assert.equal(result.rule.pathPrefix, null);
  }
  const rules = [rule({ id: "host", pathPrefix: null })];
  assert.equal(matchedId("https://example.com", rules), "host");
  assert.equal(matchedId("https://example.com/", rules), "host");
  assert.equal(matchedId("http://example.com/any/path?q=1#frag", rules), "host");
});

test("invalid rules name the field and do not echo the bad value", () => {
  const result = validateRule({
    id: " bad id ",
    label: "   ",
    hostname: "https://user:secret@example.com/path",
    pathPrefix: "product",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    { field: "id", code: "invalid" },
    { field: "label", code: "empty" },
    { field: "hostname", code: "invalid" },
    { field: "pathPrefix", code: "invalid" },
  ]);
  assert.equal(JSON.stringify(result).includes("secret"), false);

  assert.deepEqual(validateRule(null), {
    ok: false,
    errors: [{ field: "rule", code: "invalid" }],
  });
  assert.deepEqual(validateRule({ id: "", label: "Docs", hostname: "" }).errors.map((error) => error.field), [
    "id",
    "hostname",
  ]);
});

test("hostnames reject patterns, ports, and paths, and keep a trailing dot distinct", () => {
  for (const hostname of [
    "*.example.com",
    "example.com:8443",
    "example.com:80",
    "example.com:443",
    "[::1]:8443",
    "example.com/docs",
    "exa mple.com",
    "https://example.com",
  ]) {
    const result = validateRule(rule({ hostname }));
    assert.equal(result.ok, false, hostname);
    assert.equal(result.errors.some((error) => error.field === "hostname"), true);
  }

  const leadingDot = validateRule(rule({ hostname: ".example.com" }));
  assert.equal(leadingDot.ok, true);
  assert.equal(leadingDot.rule.hostname, ".example.com");
  assert.equal(matchUrl("https://.example.com/docs", [leadingDot.rule]).status, "matched");
  assert.equal(matchUrl("https://example.com/docs", [leadingDot.rule]).status, "unmatched");

  const dotted = validateRule(rule({ hostname: "example.com." }));
  assert.equal(dotted.ok, true);
  assert.equal(dotted.rule.hostname, "example.com.");
  assert.equal(matchUrl("https://example.com./docs", [rule({ hostname: "example.com." })]).status, "matched");
  assert.equal(matchUrl("https://example.com./docs", [rule({ hostname: "example.com" })]).status, "unmatched");
  assert.equal(matchUrl("https://example.com/docs", [rule({ hostname: "example.com." })]).status, "unmatched");
});

test("international and address hostnames use the URL hostname form", () => {
  const idn = validateRule(rule({ hostname: "münchen.example" }));
  assert.equal(idn.ok, true);
  assert.equal(idn.rule.hostname, "xn--mnchen-3ya.example");
  assert.equal(matchUrl("https://münchen.example/docs", [idn.rule]).status, "matched");
  assert.equal(matchUrl("https://xn--mnchen-3ya.example/docs", [idn.rule]).status, "matched");

  const ipv4 = validateRule(rule({ hostname: "127.0.0.1", pathPrefix: "/admin" }));
  assert.equal(matchedId("http://127.0.0.1:8080/admin?x=1#y", [ipv4.rule]), "rule-1");

  const ipv6 = validateRule(rule({ hostname: "[::1]", pathPrefix: "/admin" }));
  assert.equal(ipv6.rule.hostname, "[::1]");
  assert.equal(matchedId("https://[::1]:8443/admin", [ipv6.rule]), "rule-1");
  assert.equal(validateRule(rule({ hostname: "::1" })).ok, false);
});

test("path prefixes must survive URL parsing unchanged apart from encoding", () => {
  const accepted = [
    ["/product", "/product"],
    ["/product/", "/product/"],
    ["/", "/"],
    ["/café", "/caf%C3%A9"],
    ["/caf%c3%a9", "/caf%C3%A9"],
    ["/foo%2fbar", "/foo%2Fbar"],
  ];
  for (const [pathPrefix, expected] of accepted) {
    const result = validateRule(rule({ pathPrefix }));
    assert.equal(result.ok, true, pathPrefix);
    assert.equal(result.rule.pathPrefix, expected);
  }

  for (const pathPrefix of ["product", "", "/product?q=1", "/product#frag", "//example.com", "/product/../admin", "/product/./guide", "/product\\admin", "/product/%2e%2e/secret", " /product"]) {
    const result = validateRule(rule({ pathPrefix }));
    assert.equal(result.ok, false, pathPrefix);
    assert.deepEqual(result.errors, [{ field: "pathPrefix", code: "invalid" }]);
  }
});

test("duplicate ids are rejected and valid order is preserved", () => {
  const result = validateRules([
    rule({ id: "first", hostname: "one.example" }),
    rule({ id: "first", hostname: "two.example" }),
    rule({ id: "third", label: "" }),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    { index: 1, field: "id", code: "duplicate" },
    { index: 2, field: "label", code: "empty" },
  ]);

  const valid = validateRules([
    rule({ id: "broader", pathPrefix: null }),
    rule({ id: "narrower", pathPrefix: "/product" }),
  ]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.rules.map((item) => item.id), ["broader", "narrower"]);
  assert.deepEqual(validateRules([]), { ok: true, rules: [] });
  assert.equal(validateRules({ id: "nope" }).ok, false);
});

test("the same hostname and path is rejected, including a trailing slash and a root path", () => {
  const same = validateRules([
    rule({ id: "first", label: "News", hostname: "www.bbc.co.uk", pathPrefix: "/sport/football" }),
    rule({ id: "second", label: "Sport", hostname: "www.bbc.co.uk", pathPrefix: "/sport/football/" }),
  ]);
  assert.equal(same.ok, false);
  assert.deepEqual(same.errors, [{ index: 1, field: "rule", code: "duplicate" }]);

  const root = validateRules([
    rule({ id: "plain", label: "Plain", hostname: "www.bbc.co.uk", pathPrefix: null }),
    rule({ id: "slash", label: "Slash", hostname: "www.bbc.co.uk", pathPrefix: "/" }),
  ]);
  assert.equal(root.ok, false);
  assert.deepEqual(root.errors, [{ index: 1, field: "rule", code: "duplicate" }]);

  const different = validateRules([
    rule({ id: "news", label: "News", hostname: "www.bbc.co.uk", pathPrefix: "/news" }),
    rule({ id: "sport", label: "Sport", hostname: "www.bbc.co.uk", pathPrefix: "/sport" }),
  ]);
  assert.equal(different.ok, true);
});

test("exact hostname matching is case-insensitive and does not include subdomains or www", () => {
  const rules = [rule({ id: "apex", hostname: "Example.COM" })];
  assert.equal(matchedId("https://example.com/docs", rules), "apex");
  assert.equal(matchedId("HTTP://EXAMPLE.COM/docs", rules), "apex");

  for (const url of [
    "https://www.example.com/docs",
    "https://docs.example.com/docs",
    "https://example.com.evil/docs",
    "https://notexample.com/docs",
    "https://example.org/docs",
  ]) {
    assert.equal(matchUrl(url, rules).status, "unmatched", url);
  }

  const subdomain = [rule({ id: "docs", hostname: "docs.example.com" })];
  assert.equal(matchedId("https://docs.example.com/guide", subdomain), "docs");
  assert.equal(matchedId("https://Docs.Example.COM/guide", subdomain), "docs");
  assert.equal(matchUrl("https://example.com/guide", subdomain).status, "unmatched");
  assert.equal(matchUrl("https://other.docs.example.com/guide", subdomain).status, "unmatched");
  assert.equal(matchUrl("https://docs.example.com.other/guide", subdomain).status, "unmatched");
});

test("www rules stay exact, including www path prefixes", () => {
  const apex = [rule({ id: "apex", hostname: "example.com", pathPrefix: "/docs" })];
  assert.equal(matchUrl("https://www.example.com/docs/item", apex).status, "unmatched");

  const www = [rule({ id: "www", hostname: "www.example.com", pathPrefix: "/docs" })];
  assert.equal(matchedId("https://www.example.com/docs", www), "www");
  assert.equal(matchedId("http://WWW.Example.COM/docs/item?q=1#section", www), "www");
  assert.equal(matchUrl("https://example.com/docs/item", www).status, "unmatched");
  assert.equal(matchUrl("https://www.example.com/docs-and-more", www).status, "unmatched");
  assert.equal(matchUrl("https://www.example.com/documentation", www).status, "unmatched");
});

test("path prefixes are case-sensitive and stop at a segment boundary", () => {
  const rules = [rule({ pathPrefix: "/product" })];
  for (const url of [
    "https://example.com/product",
    "https://example.com/product/",
    "https://example.com/product/guide",
    "https://example.com/product/guide/",
    "http://example.com/product/guide/setup?x=1#top",
  ]) {
    assert.equal(matchUrl(url, rules).status, "matched", url);
  }
  for (const url of [
    "https://example.com/production",
    "https://example.com/products",
    "https://example.com/product-extra",
    "https://example.com/Product",
    "https://example.com/PRODUCT/guide",
    "https://example.com/pro",
    "https://example.com/prefix/product",
  ]) {
    assert.equal(matchUrl(url, rules).status, "unmatched", url);
  }

  const slashed = [rule({ pathPrefix: "/product/" })];
  assert.equal(matchUrl("https://example.com/product", slashed).status, "matched");
  assert.equal(matchUrl("https://example.com/product/guide", slashed).status, "matched");
  assert.equal(matchUrl("https://example.com/production", slashed).status, "unmatched");
});

test("the root prefix matches every path and default URLs stay on the host rule", () => {
  const root = [rule({ id: "root", pathPrefix: "/" })];
  for (const url of ["https://example.com", "https://example.com/", "http://example.com/index.html", "https://example.com/product"]) {
    assert.equal(matchedId(url, root), "root");
  }

  const index = [rule({ id: "index", pathPrefix: "/index.html" })];
  for (const url of ["https://example.com", "https://example.com/", "http://example.com"]) {
    const result = matchUrl(url, index);
    assert.equal(result.status, "unmatched", url);
    assert.equal(result.rule, null);
    assert.equal(result.reason, null);
  }
  assert.equal(matchedId("https://example.com/index.html?q=1#start", index), "index");
  assert.equal(matchUrl("http://localhost/", [rule({ hostname: "localhost" })]).status, "matched");
});

test("query strings and fragments are ignored and cannot create a path match", () => {
  const rules = [rule({ id: "product", pathPrefix: "/product" })];
  const variations = [
    "https://example.com/product",
    "https://example.com/product?",
    "https://example.com/product?q=1",
    "https://example.com/product?q=2&next=/other",
    "https://example.com/product#section",
    "https://example.com/product#/other",
    "https://example.com/product?q=1#section",
    "https://example.com/product/?q=1#section",
  ];
  for (const url of variations) {
    assert.equal(matchedId(url, rules), "product");
  }

  for (const url of [
    "https://example.com/other?next=/product",
    "https://example.com/other?path=/product/guide",
    "https://example.com/?redirect=/product",
    "https://example.com/other#/product",
    "https://example.com/other#product",
    "https://example.com/production?q=/product",
  ]) {
    assert.equal(matchUrl(url, rules).status, "unmatched", url);
  }
});

test("percent-encoding case is canonical and encoded slashes are not segment boundaries", () => {
  const encoded = [rule({ pathPrefix: "/foo%2fbar" })];
  assert.equal(matchUrl("https://example.com/foo%2Fbar", encoded).status, "matched");
  assert.equal(matchUrl("https://example.com/foo%2fbar/extra", encoded).status, "matched");
  assert.equal(matchUrl("https://example.com/foo/bar", encoded).status, "unmatched");

  const cafe = [rule({ pathPrefix: "/café" })];
  assert.equal(matchUrl("https://example.com/café", cafe).status, "matched");
  assert.equal(matchUrl("https://example.com/caf%C3%A9/menu", cafe).status, "matched");
  assert.equal(matchUrl("https://example.com/caf%C3%89", cafe).status, "unmatched");
});

test("tab URL parser resolution is used before the path comparison", () => {
  const rules = [
    rule({ id: "product", pathPrefix: "/product" }),
    rule({ id: "secret", pathPrefix: "/secret" }),
  ];
  assert.equal(matchedId("https://example.com/product/../secret", rules), "secret");
  assert.equal(matchedId("https://example.com/foo/%2e%2e/secret", rules), "secret");
  assert.equal(matchedId("https://example.com\\product", [rule({ id: "product", pathPrefix: "/product" })]), "product");
});

test("the specification's overlapping docs rules follow display order", () => {
  const specificFirst = [
    rule({ id: "product", label: "Product documentation", hostname: "docs.example.com", pathPrefix: "/product" }),
    rule({ id: "other", label: "Other documentation", hostname: "docs.example.com", pathPrefix: null }),
  ];
  const productUrl = "https://docs.example.com/product/install?lang=en#setup";
  const otherUrl = "https://docs.example.com/guide?q=1";
  const boundaryUrl = "https://docs.example.com/production";

  assert.equal(matchedId(productUrl, specificFirst), "product");
  assert.equal(matchUrl(productUrl, specificFirst).rule.label, "Product documentation");
  assert.equal(matchedId(otherUrl, specificFirst), "other");
  assert.equal(matchedId(boundaryUrl, specificFirst), "other");
  assert.equal(matchUrl("https://example.com/product", specificFirst).status, "unmatched");

  const broadFirst = [specificFirst[1], specificFirst[0]];
  assert.equal(matchedId(productUrl, broadFirst), "other");
  assert.equal(matchUrl(productUrl, broadFirst).rule.label, "Other documentation");
  assert.equal(matchedId(otherUrl, broadFirst), "other");
});

test("a later longer prefix does not outrank an earlier match", () => {
  const shorterFirst = [
    rule({ id: "docs", label: "Docs", pathPrefix: "/docs" }),
    rule({ id: "api", label: "API", pathPrefix: "/docs/api/v2" }),
  ];
  const before = structuredClone(shorterFirst);
  const apiUrl = "https://example.com/docs/api/v2/users?x=1#y";
  assert.equal(matchedId(apiUrl, shorterFirst), "docs");
  assert.deepEqual(shorterFirst, before);
  assert.equal(matchedId("https://example.com/docs/guide", shorterFirst), "docs");

  const longerFirst = [shorterFirst[1], shorterFirst[0]];
  assert.equal(matchedId(apiUrl, longerFirst), "api");
  assert.equal(matchedId("https://example.com/docs/guide", longerFirst), "docs");
  assert.equal(matchUrl("https://example.net/docs/api/v2", longerFirst).status, "unmatched");
});

test("http and https both match and the port is not part of the hostname", () => {
  const rules = [rule({ pathPrefix: "/product" })];
  assert.equal(matchedId("http://example.com/product", rules), "rule-1");
  assert.equal(matchedId("https://example.com/product", rules), "rule-1");
  assert.equal(matchedId("http:example.com/product", rules), "rule-1");
  assert.equal(matchedId("https:/example.com/product", rules), "rule-1");
  assert.equal(matchedId("https://example.com:8443/product", rules), "rule-1");
  assert.equal(matchedId("http://example.com:443/product", rules), "rule-1");
  assert.equal(matchedId("https://user:secret@example.com/product?token=abc#frag", rules), "rule-1");
  const result = matchUrl("https://user:secret@example.com/product?token=abc#frag", rules);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("valid non-matching tabs stay unmatched", () => {
  const rules = [rule({ hostname: "docs.example.com", pathPrefix: "/product" })];
  for (const url of [
    "https://docs.example.com/other",
    "https://example.com/product",
    "http://localhost/",
    "https://docs.example.com",
  ]) {
    const result = matchUrl(url, rules);
    assert.deepEqual(result, { status: "unmatched", rule: null, reason: null }, url);
  }
  assert.deepEqual(matchUrl("https://example.com/product", []), {
    status: "unmatched",
    rule: null,
    reason: null,
  });
});

test("non-web URLs are unsupported and malformed URLs are rejected safely", () => {
  const rules = [rule({ pathPrefix: "/product" })];
  for (const url of [
    "opera://startpage",
    "opera:extensions",
    "chrome://extensions",
    "chrome://newtab",
    "about:blank",
    "about:config",
    "file:///tmp/x",
    "file://example.com/product",
    "ftp://example.com/product",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ws://example.com/product",
    "wss://example.com/product",
    "chrome-extension://abc/popup.html",
    "blob:https://example.com/uuid",
    "mailto:andrew@example.com",
  ]) {
    const result = matchUrl(url, rules);
    assert.deepEqual(result, { status: "rejected", rule: null, reason: "unsupported-url" }, url);
    assert.equal(JSON.stringify(result).includes(url), false);
  }

  for (const url of ["", "   ", "example.com", "http://", "https://", "//example.com/product", "https://ex ample.com/", "not a url", null, undefined, 1, {}, "https://user:secret@not a url"]) {
    const result = matchUrl(url, rules);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "malformed-url");
    assert.equal(result.rule, null);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("an invalid rule list rejects matching without throwing", () => {
  const url = "https://user:secret@example.com/product";
  const result = matchUrl(url, [{ label: "Missing id", hostname: "example.com" }]);
  assert.deepEqual(result, { status: "rejected", rule: null, reason: "invalid-rules" });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(matchUrl(url, null), { status: "rejected", rule: null, reason: "invalid-rules" });
});

test("matchTabs preserves tab order and does not change tab objects", () => {
  const rules = [
    rule({ id: "docs", hostname: "docs.example.com", pathPrefix: "/product" }),
    rule({ id: "apex", hostname: "example.com" }),
  ];
  const tabs = [
    { id: 1, url: "https://example.com/other", title: "Other" },
    { id: 2, url: "opera://startpage", title: "Start" },
    { id: 3, url: "https://docs.example.com/product/guide?q=1#top", title: "Product" },
    { id: 4, title: "No URL" },
    { id: 5, url: "https://unmatched.example/page" },
  ];
  const before = structuredClone(tabs);
  const results = matchTabs(tabs, rules);

  assert.deepEqual(tabs, before);
  assert.deepEqual(results.map((result) => [result.status, result.rule && result.rule.id, result.reason]), [
    ["matched", "apex", null],
    ["rejected", null, "unsupported-url"],
    ["matched", "docs", null],
    ["rejected", null, "malformed-url"],
    ["unmatched", null, null],
  ]);

  const throwing = {};
  Object.defineProperty(throwing, "url", {
    get() {
      throw new Error("secret-token");
    },
  });
  const [rejected] = matchTabs([throwing, { url: "https://example.com/" }], rules);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "malformed-url");
  assert.equal(JSON.stringify(rejected).includes("secret-token"), false);

  assert.throws(() => matchTabs(null, rules), TypeError);
});

test("createRuleId returns distinct UUID identifiers", () => {
  const first = createRuleId();
  const second = createRuleId();
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
