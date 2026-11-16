/**
 * Build the store zip from extension/ after checking the manifest.
 * Validation and file selection are pure. The zip command runs only from
 * packageExtension and the command-line entry point.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A path under extension/ is packaged unless it is inside dev/ or is .DS_Store.
 *
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isPackagedPath(relativePath) {
  const parts = String(relativePath).split(/[/\\]/).filter((part) => part !== "");
  if (parts.length === 0) {
    return false;
  }
  if (parts[0] === "dev") {
    return false;
  }
  return !parts.some((part) => part === ".DS_Store");
}

/**
 * @param {string[]} relativePaths
 * @returns {string[]}
 */
export function selectPackagedPaths(relativePaths) {
  return relativePaths.filter(isPackagedPath).sort();
}

/**
 * Files the manifest names and that must exist in the zip.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
export function manifestListedFiles(manifest) {
  const files = [];
  if (manifest && manifest.icons && typeof manifest.icons === "object") {
    for (const value of Object.values(manifest.icons)) {
      if (typeof value === "string") {
        files.push(value);
      }
    }
  }
  if (manifest && typeof manifest.options_page === "string") {
    files.push(manifest.options_page);
  }
  const popup = manifest && manifest.browser_action && manifest.browser_action.default_popup;
  if (typeof popup === "string") {
    files.push(popup);
  }
  return files;
}

/**
 * Store checks that do not need zip. An empty array means the package may be built.
 *
 * @param {object} manifest
 * @param {{ version?: string }} pkg
 * @param {Set<string> | string[]} existingFiles
 * @returns {string[]}
 */
export function validatePackage(manifest, pkg, existingFiles) {
  const errors = [];
  const present = existingFiles instanceof Set ? existingFiles : new Set(existingFiles);
  const safeManifest = manifest || {};
  const safePkg = pkg || {};
  if (typeof safeManifest.name !== "string" || /opera/i.test(safeManifest.name)) {
    errors.push('The extension name must not contain "opera".');
  }
  if (safeManifest.version !== safePkg.version) {
    errors.push(`The manifest version (${safeManifest.version}) differs from package.json (${safePkg.version}).`);
  }
  if (safeManifest.manifest_version !== 2) {
    errors.push(`manifest_version is ${safeManifest.manifest_version}. It must be 2.`);
  }
  for (const relative of manifestListedFiles(safeManifest)) {
    if (!present.has(relative)) {
      errors.push(`Missing file listed in the manifest: ${relative}`);
    }
  }
  const description = typeof safeManifest.description === "string" ? safeManifest.description : "";
  if (description.trim().length === 0) {
    errors.push("The description is empty.");
  } else if (description.length > 132) {
    errors.push(`The description is ${description.length} characters. The maximum is 132.`);
  }
  return errors;
}

/**
 * @param {string} extensionDir
 * @param {{ readdirSync: Function, statSync: Function }} [fs]
 * @returns {string[]}
 */
export function listExtensionFiles(extensionDir, fs = { readdirSync, statSync }) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      const relative = path.relative(extensionDir, fullPath).split(path.sep).join("/");
      if (!isPackagedPath(relative)) {
        continue;
      }
      const info = fs.statSync(fullPath);
      if (info.isDirectory()) {
        walk(fullPath);
      } else if (info.isFile()) {
        files.push(relative);
      }
    }
  };
  walk(extensionDir);
  return files.sort();
}

/**
 * @param {string} version
 * @returns {string}
 */
export function packageFileName(version) {
  return `workspace-tab-organiser-${version}.zip`;
}

/**
 * Validate, then ask zip to archive the selected files with the manifest at the root.
 *
 * @param {{ manifest: object, pkg: object, files: string[], cwd: string, zipPath: string, execFile: Function, removeFile?: Function }} options
 * @returns {{ zipPath: string, files: string[] }}
 */
export function createPackage({ manifest, pkg, files, cwd, zipPath, execFile, removeFile = rmSync }) {
  const errors = validatePackage(manifest, pkg, files);
  if (errors.length > 0) {
    const error = new Error(errors.join("\n"));
    error.errors = errors;
    throw error;
  }
  const packed = [...files].sort();
  removeFile(zipPath, { force: true });
  execFile("zip", ["-X", zipPath, ...packed], { cwd });
  return { zipPath, files: packed };
}

/**
 * Read this repository and build dist/workspace-tab-organiser-<version>.zip.
 *
 * @param {string} root
 * @param {{ execFile?: Function }} [deps]
 * @returns {{ zipPath: string, files: string[] }}
 */
export function packageExtension(root, { execFile = execFileSync } = {}) {
  const extensionDir = path.join(root, "extension");
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const files = listExtensionFiles(extensionDir);
  const distDir = path.join(root, "dist");
  mkdirSync(distDir, { recursive: true });
  const zipPath = path.join(distDir, packageFileName(manifest.version));
  return createPackage({ manifest, pkg, files, cwd: extensionDir, zipPath, execFile });
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = packageExtension(root);
    console.log(result.zipPath);
    for (const file of result.files) {
      console.log(file);
    }
  } catch (error) {
    const detail = error.stderr ? `\n${error.stderr}` : "";
    console.error(`${error.message}${detail}`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main();
}
