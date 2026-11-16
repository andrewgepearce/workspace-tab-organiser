import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { autoGroupKey, groupUnmatchedEnabled } from "../extension/auto-group.js";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../extension/auto-group.js"),
  "utf8",
);

test("the key module stays free of browser, storage and tab movement", () => {
  assert.match(source, /export function autoGroupKey/);
  assert.match(source, /export function groupUnmatchedEnabled/);
  assert.doesNotMatch(source, /node:|chrome\.|browser\.|document\.|localStorage|indexedDB|eval\(|fetch\(/);
  assert.doesNotMatch(source, /tabs\.(move|create|remove|update|group)|tabGroups|storage\./);
});

test("D10 keys use the hostname and the first path segment", () => {
  assert.equal(autoGroupKey("https://www.bbc.co.uk/sport/football"), "www.bbc.co.uk/sport");
  assert.equal(autoGroupKey("https://www.bbc.co.uk/sport/tennis"), "www.bbc.co.uk/sport");
  assert.equal(autoGroupKey("https://www.bbc.co.uk/sport"), "www.bbc.co.uk/sport");
  assert.equal(autoGroupKey("https://en.wikipedia.org/wiki/London"), "en.wikipedia.org/wiki");
  assert.equal(
    autoGroupKey("https://www.bbc.co.uk/sport/football") === autoGroupKey("https://www.bbc.co.uk/news/uk"),
    false,
  );
});

test("the hostname is lower case and www is kept", () => {
  assert.equal(autoGroupKey("https://WWW.BBC.co.uk/Sport/x"), "www.bbc.co.uk/Sport");
  assert.equal(autoGroupKey("https://Example.COM/News/a"), "example.com/News");
  assert.equal(autoGroupKey("https://www.example.com/docs/item"), "www.example.com/docs");
  assert.equal(autoGroupKey("https://example.com/docs/item"), "example.com/docs");
  assert.equal(
    autoGroupKey("https://www.example.com/docs/item") === autoGroupKey("https://example.com/docs/item"),
    false,
  );
});

test("a root path is the hostname alone", () => {
  assert.equal(autoGroupKey("https://example.com"), "example.com");
  assert.equal(autoGroupKey("https://example.com/"), "example.com");
  assert.equal(autoGroupKey("http://example.com"), "example.com");
  assert.equal(autoGroupKey("https://example.com/?q=1#frag"), "example.com");
  assert.equal(autoGroupKey("https://example.com/."), "example.com");
});

test("trailing slashes, queries, fragments, ports and userinfo are not part of the key", () => {
  assert.equal(autoGroupKey("https://www.bbc.co.uk/sport/"), "www.bbc.co.uk/sport");
  assert.equal(autoGroupKey("https://www.bbc.co.uk/sport/football/"), "www.bbc.co.uk/sport");
  assert.equal(autoGroupKey("https://example.com/sport/football?token=secret#frag"), "example.com/sport");
  assert.equal(autoGroupKey("http://example.com:8080/sport/a"), "example.com/sport");
  assert.equal(autoGroupKey("https://user:secret@example.com/sport/a"), "example.com/sport");
  assert.equal(autoGroupKey("https://user:secret@example.com/sport/a").includes("secret"), false);
});

test("the path segment keeps its case and percent-encoding hex is uppercased", () => {
  assert.equal(autoGroupKey("https://example.com/Sport/football"), "example.com/Sport");
  assert.equal(autoGroupKey("https://example.com/sport/football"), "example.com/sport");
  assert.equal(autoGroupKey("https://example.com/a%2fb/c"), "example.com/a%2Fb");
  assert.equal(autoGroupKey("https://example.com/a%2Fb/c"), "example.com/a%2Fb");
});

test("empty segments are skipped and dot segments are resolved first", () => {
  assert.equal(autoGroupKey("https://example.com//sport/a"), "example.com/sport");
  assert.equal(autoGroupKey("https://example.com/sport/../news/a"), "example.com/news");
  assert.equal(autoGroupKey("https://example.com/%2e%2e/news"), "example.com/news");
});

test("only HTTP and HTTPS URLs can form a key", () => {
  assert.equal(autoGroupKey("opera://extensions"), null);
  assert.equal(autoGroupKey("chrome://extensions"), null);
  assert.equal(autoGroupKey("file:///tmp/notes"), null);
  assert.equal(autoGroupKey(""), null);
  assert.equal(autoGroupKey("   "), null);
  assert.equal(autoGroupKey("not a url"), null);
  assert.equal(autoGroupKey(null), null);
  assert.equal(autoGroupKey(undefined), null);
  assert.equal(autoGroupKey(4), null);
});

test("D12 is on unless the value is exactly false", () => {
  assert.equal(groupUnmatchedEnabled(undefined), true);
  assert.equal(groupUnmatchedEnabled(null), true);
  assert.equal(groupUnmatchedEnabled(true), true);
  assert.equal(groupUnmatchedEnabled("true"), true);
  assert.equal(groupUnmatchedEnabled("false"), true);
  assert.equal(groupUnmatchedEnabled(1), true);
  assert.equal(groupUnmatchedEnabled({}), true);
  assert.equal(groupUnmatchedEnabled(false), false);
});
