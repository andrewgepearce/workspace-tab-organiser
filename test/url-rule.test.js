import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { matchUrl } from "../extension/matching.js";
import { inferRuleFromUrl, ruleDisplayName } from "../extension/url-rule.js";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../extension/url-rule.js"),
  "utf8",
);

/**
 * @param {{ hostname: string, pathPrefix: string, label: string }} inferred
 */
function ruleFrom(inferred) {
  return {
    id: "inferred",
    label: inferred.label,
    hostname: inferred.hostname,
    pathPrefix: inferred.pathPrefix === "" ? null : inferred.pathPrefix,
  };
}

test("the inference module stays free of browser, storage and tab movement", () => {
  assert.match(source, /export function inferRuleFromUrl/);
  assert.match(source, /export function ruleDisplayName/);
  assert.doesNotMatch(source, /node:|chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(source, /tabs\.(move|create|remove|update|group)|tabGroups|storage\./);
});

test("D14 fills the hostname and the full path and the derived name uses that path", () => {
  const inferred = inferRuleFromUrl("https://www.bbc.co.uk/sport/football?x=1#a");
  assert.deepEqual(inferred, {
    ok: true,
    hostname: "www.bbc.co.uk",
    pathPrefix: "/sport/football",
    label: "www.bbc.co.uk/sport/football",
  });
  assert.equal(ruleDisplayName("www.bbc.co.uk", "/sport/football"), "www.bbc.co.uk/sport/football");
  assert.equal(ruleDisplayName("www.bbc.co.uk", null), "www.bbc.co.uk");
  assert.equal(ruleDisplayName("www.bbc.co.uk", "/"), "www.bbc.co.uk");
  assert.equal(ruleDisplayName("www.bbc.co.uk", "/sport/"), "www.bbc.co.uk/sport");

  const github = inferRuleFromUrl("https://github.com/andrewgepearce/repo");
  assert.deepEqual(github, {
    ok: true,
    hostname: "github.com",
    pathPrefix: "/andrewgepearce/repo",
    label: "github.com/andrewgepearce/repo",
  });

  const matched = matchUrl("https://www.bbc.co.uk/sport/football/live?x=2#b", [ruleFrom(inferred)]);
  assert.equal(matched.status, "matched");
  assert.equal(matched.rule.label, "www.bbc.co.uk/sport/football");
  const narrower = matchUrl("https://www.bbc.co.uk/sport/footballing", [ruleFrom(inferred)]);
  assert.equal(narrower.status, "unmatched");
});

test("a bare origin has no path prefix and the label is the hostname", () => {
  for (const url of ["https://www.bbc.co.uk", "https://www.bbc.co.uk/", "http://www.bbc.co.uk/?q=1#top"]) {
    const inferred = inferRuleFromUrl(url);
    assert.equal(inferred.ok, true);
    assert.equal(inferred.hostname, "www.bbc.co.uk");
    assert.equal(inferred.pathPrefix, "");
    assert.equal(inferred.label, "www.bbc.co.uk");
    const matched = matchUrl("https://www.bbc.co.uk/news/uk", [ruleFrom(inferred)]);
    assert.equal(matched.status, "matched");
  }
});

test("one trailing slash is removed and the scheme, port and userinfo are dropped", () => {
  const slashed = inferRuleFromUrl("https://www.bbc.co.uk/sport/football/");
  assert.equal(slashed.ok, true);
  assert.equal(slashed.pathPrefix, "/sport/football");
  assert.equal(slashed.label, "www.bbc.co.uk/sport/football");

  const port = inferRuleFromUrl("http://example.com:8080/sport/football?x=1#a");
  assert.deepEqual(port, {
    ok: true,
    hostname: "example.com",
    pathPrefix: "/sport/football",
    label: "example.com/sport/football",
  });

  const secret = "https://user:secret-token@www.bbc.co.uk/sport/football";
  const inferred = inferRuleFromUrl(secret);
  assert.equal(inferred.ok, true);
  assert.equal(inferred.hostname, "www.bbc.co.uk");
  assert.equal(inferred.pathPrefix, "/sport/football");
  assert.equal(JSON.stringify(inferred).includes("secret-token"), false);
  assert.equal(JSON.stringify(inferred).includes("user"), false);
});

test("the hostname is lower case and the path keeps its case", () => {
  const inferred = inferRuleFromUrl("https://WWW.BBC.co.uk/Sport/Football");
  assert.deepEqual(inferred, {
    ok: true,
    hostname: "www.bbc.co.uk",
    pathPrefix: "/Sport/Football",
    label: "www.bbc.co.uk/Sport/Football",
  });
  const dotted = inferRuleFromUrl("https://example.com/a/./b/");
  assert.equal(dotted.ok, true);
  assert.equal(dotted.pathPrefix, "/a/b");
  assert.equal(dotted.label, "example.com/a/b");
  const resolved = inferRuleFromUrl("https://example.com/a/../b");
  assert.equal(resolved.pathPrefix, "/b");
  assert.equal(resolved.label, "example.com/b");
});

test("a non-HTTP URL or an unreadable address is a message and not a rule", () => {
  const ftp = inferRuleFromUrl("ftp://user:secret-token@example.com/a");
  assert.equal(ftp.ok, false);
  assert.match(ftp.message, /http or https/);
  assert.match(ftp.message, /Other schemes are not used/);
  assert.equal(ftp.message.includes("secret-token"), false);

  const opera = inferRuleFromUrl("opera://settings");
  assert.equal(opera.ok, false);
  assert.match(opera.message, /Other schemes are not used/);

  const broken = inferRuleFromUrl("not a url secret-token");
  assert.equal(broken.ok, false);
  assert.match(broken.message, /could not be read/);
  assert.equal(broken.message.includes("secret-token"), false);

  assert.equal(inferRuleFromUrl("").ok, false);
  assert.equal(inferRuleFromUrl("   ").ok, false);
  assert.equal(inferRuleFromUrl(null).ok, false);
  assert.equal(inferRuleFromUrl(12).ok, false);

  const doubleSlash = inferRuleFromUrl("https://example.com//sport");
  assert.equal(doubleSlash.ok, false);
  assert.match(doubleSlash.message, /path prefix/);
  assert.equal(Object.hasOwn(doubleSlash, "hostname"), false);
});
