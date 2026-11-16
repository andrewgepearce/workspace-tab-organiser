import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");

const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const popupJs = readFileSync(path.join(extensionDir, "popup.js"), "utf8");
const popupHtml = readFileSync(path.join(extensionDir, "popup.html"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");

function isOperaVersion(value) {
  const parts = String(value).split(".");
  if (parts.length < 1 || parts.length > 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^(0|[1-9]\d*)$/.test(part)) {
      return false;
    }
    const number = Number(part);
    return number >= 0 && number <= 65535;
  });
}

function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function extensionScripts() {
  const scripts = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".js")) {
        scripts.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  };
  walk(extensionDir);
  return scripts.sort();
}

test("the store name is Workspace Tab Organiser", () => {
  const optionsHtml = readFileSync(path.join(extensionDir, "options.html"), "utf8");
  assert.equal(manifest.name, "Workspace Tab Organiser");
  assert.equal(manifest.browser_action.default_title, "Workspace Tab Organiser");
  assert.doesNotMatch(manifest.name, /opera/i);
  assert.doesNotMatch(manifest.browser_action.default_title, /opera/i);
  assert.match(popupHtml, /<title>Workspace Tab Organiser<\/title>/);
  assert.match(optionsHtml, /<title>Workspace Tab Organiser rules<\/title>/);
  assert.match(optionsHtml, /<h1>Workspace Tab Organiser rules<\/h1>/);
});

test("manifest follows Opera's documented Manifest V2 popup shape", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length > 0);
  assert.ok(manifest.name.length <= 45);
  assert.equal(isOperaVersion(manifest.version), true);
  assert.equal(isOperaVersion(manifest.minimum_opera_version), true);
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
  assert.ok(manifest.description.length <= 132);
  assert.equal(manifest.browser_action.default_popup, "popup.html");
  assert.equal(manifest.browser_action.default_title, manifest.name);
  assert.equal(manifest.browser_action.default_icon, "icons/icon48.png");
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "48"]);
});

test("manifest requests storage and tabs and declares an options page", () => {
  assert.equal(manifest.options_page, "options.html");
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  const absent = [
    "action",
    "background",
    "chrome_url_overrides",
    "content_scripts",
    "options_ui",
    "page_action",
    "optional_permissions",
    "host_permissions",
  ];
  for (const key of absent) {
    assert.equal(Object.hasOwn(manifest, key), false, key);
  }
});

test("the three manifest icons exist and match their pixel sizes", () => {
  for (const size of [16, 48, 128]) {
    const file = readFileSync(path.join(extensionDir, "icons", `icon${size}.png`));
    const { width, height } = pngSize(file);
    assert.equal(width, size);
    assert.equal(height, size);
    assert.equal(file[28], 0);
  }
});

test("the 512 pixel icon master sits outside the extension package", () => {
  const master = readFileSync(path.join(root, "docs/store/icon-512.png"));
  const { width, height } = pngSize(master);
  assert.equal(width, 512);
  assert.equal(height, 512);
  assert.equal(statSync(path.join(extensionDir, "icons", "icon512.png"), { throwIfNoEntry: false }), undefined);
});

test("documented icon sizes exist as PNG files", () => {
  for (const [size, relativePath] of Object.entries(manifest.icons)) {
    const file = readFileSync(path.join(extensionDir, relativePath));
    const { width, height } = pngSize(file);
    assert.equal(width, Number(size));
    assert.equal(height, Number(size));
  }
  assert.equal(statSync(path.join(extensionDir, manifest.browser_action.default_icon)).isFile(), true);
});

test("popup is a read-only preview wired from runtime.getManifest", () => {
  assert.match(popupHtml, /<script type="module" src="popup\.js"><\/script>/);
  assert.doesNotMatch(popupHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(popupHtml, /\son\w+=/i);
  assert.match(popupHtml, /href="popup\.css"/);
  assert.equal(statSync(path.join(extensionDir, "popup.css")).isFile(), true);
  assert.match(popupHtml, /id="cancel"/);
  assert.match(popupHtml, />Cancel</);
  assert.match(popupHtml, /id="apply"/);
  assert.match(popupHtml, />Apply</);
  assert.match(popupHtml, /id="report"/);

  assert.match(popupJs, /chrome\.runtime\.getManifest\(\)/);
  assert.match(popupJs, /textContent/);
  assert.match(popupJs, /export async function startPopup/);
  assert.match(popupJs, /from "\.\/browser-tabs\.js"/);
  assert.match(popupJs, /from "\.\/preview\.js"/);
  assert.match(popupJs, /from "\.\/rule-store\.js"/);
  assert.doesNotMatch(popupJs, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.doesNotMatch(popupJs, /chrome\.tabs\b|browser\.tabs\b|chrome\.tabGroups\b|browser\.tabGroups\b/);
  assert.doesNotMatch(popupJs, /planArrangement|arrangement/);
  assert.doesNotMatch(popupJs, /tabs\.(move|create|remove|update|reload|highlight|group)\b/);

  for (const id of ["heading", "scope-note", "status", "notice", "blocks", "unmatched", "unavailable", "apply-reason", "name", "version", "options", "cancel", "apply", "report"]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
});

test("the repository is under the MIT licence", () => {
  const licence = readFileSync(path.join(root, "LICENSE"), "utf8");
  assert.match(licence, /Copyright \(c\) 2026 Andrew Pearce/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  assert.equal(pkg.license, "MIT");
});

test("package scripts use Node's built-in runner and syntax check", () => {
  assert.equal(pkg.version, manifest.version);
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.match(pkg.engines.node, />=\s*20/);
  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.scripts.package, "node scripts/package.js");
  assert.equal(pkg.scripts.screenshots, "node scripts/screenshots.js");
  assert.match(pkg.scripts.check, /node --check /);
  assert.match(pkg.scripts.check, /node --check scripts\/package\.js(?:\s|&&|$)/);
  assert.match(pkg.scripts.check, /node --check scripts\/screenshots\.js(?:\s|&&|$)/);
  assert.doesNotMatch(`${pkg.scripts.test}\n${pkg.scripts.check}`, /jest|mocha|vitest|ava/);

  const scripts = extensionScripts();
  assert.deepEqual(scripts, [
    "extension/apply-plan.js",
    "extension/apply.js",
    "extension/arrangement.js",
    "extension/auto-group.js",
    "extension/browser-tabs.js",
    "extension/dev/move-plan.js",
    "extension/dev/move-probe.js",
    "extension/matching.js",
    "extension/options.js",
    "extension/popup-rule.js",
    "extension/popup.js",
    "extension/preview.js",
    "extension/rule-draft.js",
    "extension/rule-store.js",
    "extension/url-rule.js",
    "extension/workspace.js",
  ]);
  for (const script of scripts) {
    assert.match(pkg.scripts.check, new RegExp(`node --check ${script}(?:\\s|&&|$)`));
  }
  const testScripts = readdirSync(path.join(root, "test"))
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => `test/${entry}`)
    .sort();
  assert.deepEqual(testScripts, [
    "test/apply.test.js",
    "test/arrangement.test.js",
    "test/auto-group.test.js",
    "test/matching.test.js",
    "test/move-probe.test.js",
    "test/options-page.test.js",
    "test/order.test.js",
    "test/package.test.js",
    "test/popup-rule.test.js",
    "test/preview.test.js",
    "test/rule-draft.test.js",
    "test/rule-store.test.js",
    "test/screenshots.test.js",
    "test/skeleton.test.js",
    "test/url-rule.test.js",
    "test/workspace.test.js",
  ]);
  for (const script of testScripts) {
    assert.match(pkg.scripts.check, new RegExp(`node --check ${script}(?:\\s|&&|$)`));
  }
});

test("gitignore covers dependencies, secrets, and local editor files", () => {
  const lines = new Set(gitignore.split(/\r?\n/));
  for (const entry of [
    "node_modules/",
    ".env",
    ".DS_Store",
    "Thumbs.db",
    "Desktop.ini",
    ".idea/",
    ".vscode/",
    "dist/",
    "store-assets/captures/*",
    "!store-assets/captures/.gitkeep",
    "store-assets/screenshots/*",
    "!store-assets/screenshots/.gitkeep",
  ]) {
    assert.equal(lines.has(entry), true, entry);
  }
});
