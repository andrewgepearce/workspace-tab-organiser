import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPackage,
  isPackagedPath,
  listExtensionFiles,
  manifestListedFiles,
  packageExtension,
  packageFileName,
  selectPackagedPaths,
  validatePackage,
} from "../scripts/package.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");

const validManifest = {
  name: "Workspace Tab Organiser",
  version: "0.10.0",
  manifest_version: 2,
  description: "It groups the current workspace and keeps data on this computer.",
  options_page: "options.html",
  icons: { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" },
  browser_action: { default_popup: "popup.html" },
};

const validPkg = { version: "0.10.0" };

const present = new Set([
  "options.html",
  "popup.html",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
]);

function commandAvailable(command) {
  try {
    execFileSync(command, ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function zipEntries(zipPath) {
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  return listing.split(/\r?\n/).filter((line) => line !== "");
}

function assertStoreEntries(entries) {
  assert.equal(entries.includes("manifest.json"), true);
  assert.equal(entries.includes("extension/manifest.json"), false);
  assert.equal(entries.some((entry) => entry === "dev" || entry.startsWith("dev/")), false);
  assert.equal(entries.some((entry) => entry.split("/").includes(".DS_Store")), false);
}

test("packaged paths leave out extension/dev and .DS_Store", () => {
  assert.equal(isPackagedPath("dev"), false);
  assert.equal(isPackagedPath("dev/move-probe.js"), false);
  assert.equal(isPackagedPath(".DS_Store"), false);
  assert.equal(isPackagedPath("icons/.DS_Store"), false);
  assert.equal(isPackagedPath("popup.html"), true);
  assert.deepEqual(selectPackagedPaths([
    "popup.html",
    "dev/move-probe.html",
    "icons/.DS_Store",
    "icons/icon16.png",
    ".DS_Store",
  ]), ["icons/icon16.png", "popup.html"]);
});

test("validation rejects an Opera name, a version mismatch, a bad manifest and a long description", () => {
  const named = validatePackage({ ...validManifest, name: "Opera Tab Organiser" }, validPkg, present);
  assert.match(named.join("\n"), /must not contain "opera"/);

  const shouted = validatePackage({ ...validManifest, name: "OPERA Helper" }, validPkg, present);
  assert.match(shouted.join("\n"), /must not contain "opera"/);

  const version = validatePackage({ ...validManifest, version: "0.9.0" }, validPkg, present);
  assert.match(version.join("\n"), /differs from package.json/);

  const manifestVersion = validatePackage({ ...validManifest, manifest_version: 3 }, validPkg, present);
  assert.match(manifestVersion.join("\n"), /must be 2/);

  const missing = validatePackage(validManifest, validPkg, new Set(["options.html"]));
  assert.match(missing.join("\n"), /Missing file listed in the manifest: popup.html/);
  assert.match(missing.join("\n"), /Missing file listed in the manifest: icons\/icon16.png/);

  const empty = validatePackage({ ...validManifest, description: "   " }, validPkg, present);
  assert.match(empty.join("\n"), /description is empty/);

  const long = validatePackage({ ...validManifest, description: "a".repeat(133) }, validPkg, present);
  assert.match(long.join("\n"), /133 characters/);

  assert.deepEqual(validatePackage(validManifest, validPkg, present), []);
  assert.deepEqual(manifestListedFiles(validManifest), [
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "options.html",
    "popup.html",
  ]);
});

test("a failed validation does not run zip", () => {
  let called = false;
  assert.throws(() => createPackage({
    manifest: { ...validManifest, name: "Opera Tabs" },
    pkg: validPkg,
    files: [...present],
    cwd: extensionDir,
    zipPath: path.join(root, "dist", "should-not-exist.zip"),
    execFile() {
      called = true;
    },
  }), /must not contain "opera"/);
  assert.equal(called, false);
});

const storeSummary = "Workspace Tab Organiser groups the tabs in your current workspace by your own site rules, and previews every move before it happens.";

test("the manifest description is the one-sentence store summary", () => {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const listing = readFileSync(path.join(root, "docs/store/listing.md"), "utf8");
  assert.equal(storeSummary.startsWith("Workspace Tab Organiser"), true);
  assert.equal(storeSummary.length <= 132, true);
  assert.equal(manifest.description, storeSummary);
  assert.equal(pkg.description, storeSummary);
  assert.equal(manifest.version, pkg.version);
  assert.doesNotMatch(manifest.description, /opera/i);
  assert.doesNotMatch(manifest.name, /opera/i);
  assert.equal(listing.includes(storeSummary), true);
  assert.equal(listing.includes(manifest.version), true);
  assert.equal(listing.includes("https://github.com/andrewgepearce/workspace-tab-organiser"), true);
  assert.equal(listing.includes("\u2014"), false);
  assert.match(listing, /Productivity/);
  assert.match(listing, /\bMIT\b/);
  assert.doesNotMatch(listing, /open question/i);
  assert.doesNotMatch(listing, /\bAndrew\b/);
  assert.match(listing, /```mermaid/);
});

test("the current extension passes validation and does not depend on extension/dev", () => {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const files = listExtensionFiles(extensionDir);
  assert.equal(files.includes("manifest.json"), true);
  assert.equal(files.some((file) => file === "dev" || file.startsWith("dev/")), false);
  assert.deepEqual(validatePackage(manifest, pkg, files), []);
  assert.equal(packageFileName(manifest.version), `workspace-tab-organiser-${manifest.version}.zip`);
  for (const relative of files) {
    if (!/\.(js|html|json|css)$/.test(relative)) continue;
    const text = readFileSync(path.join(extensionDir, relative), "utf8");
    assert.equal(text.includes("dev/"), false, relative);
  }
});

test("the zip lists manifest.json at the root and has no dev entries", {
  skip: !commandAvailable("zip") || !commandAvailable("unzip"),
}, () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const output = execFileSync(process.execPath, ["scripts/package.js"], { cwd: root, encoding: "utf8" });
  const zipName = packageFileName(pkg.version);
  const zipPath = path.join(root, "dist", zipName);
  assert.match(output, new RegExp(zipName.replaceAll(".", "\\.")));
  assert.equal(output.split(/\r?\n/).includes(zipPath), true);
  assertStoreEntries(zipEntries(zipPath));
  const built = packageExtension(root);
  assert.equal(built.files.includes("manifest.json"), true);
  assert.equal(built.files.some((file) => file.startsWith("dev/")), false);
});

test("a zip path containing /dev/ is not treated as a dev entry", {
  skip: !commandAvailable("zip") || !commandAvailable("unzip"),
}, () => {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const parent = mkdtempSync(path.join(os.tmpdir(), "workspace-tab-organiser-"));
  const zipPath = path.join(parent, "dev", "github", "workspace-tab-organiser", "dist", packageFileName(pkg.version));
  mkdirSync(path.dirname(zipPath), { recursive: true });
  try {
    createPackage({
      manifest,
      pkg,
      files: listExtensionFiles(extensionDir),
      cwd: extensionDir,
      zipPath,
      execFile: execFileSync,
    });
    assert.match(zipPath, /\/dev\//);
    const verbose = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
    assert.match(verbose, /\/dev\//);
    assertStoreEntries(zipEntries(zipPath));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
