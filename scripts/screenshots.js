/**
 * Scale store captures to 612 by 408 on macOS.
 * Argument building is pure. sips runs only from the command-line entry point
 * and from runScreenshots when the caller passes an execFile.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCREENSHOT_WIDTH = 612;
export const SCREENSHOT_HEIGHT = 408;

/**
 * Largest whole-pixel size that fits inside the box and keeps the aspect ratio.
 * A capture smaller than the box is scaled up.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [boxWidth]
 * @param {number} [boxHeight]
 * @returns {{ width: number, height: number }}
 */
export function fitInside(width, height, boxWidth = SCREENSHOT_WIDTH, boxHeight = SCREENSHOT_HEIGHT) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The capture width and height must be positive numbers.");
  }
  const scale = Math.min(boxWidth / width, boxHeight / height);
  let fittedWidth = Math.round(width * scale);
  let fittedHeight = Math.round(height * scale);
  if (fittedWidth > boxWidth) {
    fittedWidth = boxWidth;
  }
  if (fittedHeight > boxHeight) {
    fittedHeight = boxHeight;
  }
  if (fittedWidth < 1) {
    fittedWidth = 1;
  }
  if (fittedHeight < 1) {
    fittedHeight = 1;
  }
  return { width: fittedWidth, height: fittedHeight };
}

/**
 * @param {string} fileName
 * @returns {string}
 */
export function screenshotOutputName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  if (!base || base === "." || base === "..") {
    throw new Error(`Cannot name a screenshot for ${fileName}.`);
  }
  return `${base}.png`;
}

/**
 * PNG and JPG captures. Dotfiles, including .gitkeep, are skipped.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
export function imageCaptures(names) {
  return names.filter((name) => {
    const base = path.basename(name);
    return !base.startsWith(".") && /\.(png|jpe?g)$/i.test(base);
  });
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {{ width: number, height: number }} fitted
 * @returns {string[]}
 */
export function resampleArguments(inputPath, outputPath, fitted) {
  return [
    "--resampleHeightWidth",
    String(fitted.height),
    String(fitted.width),
    "-s",
    "format",
    "bmp",
    inputPath,
    "--out",
    outputPath,
  ];
}

/**
 * Pad a BMP to the store size.
 * On sips 316, --padToHeightWidth must come before --padColor. The other order skips the pad.
 * This call does not change the format. A combined format change warned that the output suffix
 * should be bmp, and it was not checked with this argument order.
 * sips ignores --padColor on a PNG, so the caller resamples to BMP first and converts to PNG afterwards.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} [height]
 * @param {number} [width]
 * @returns {string[]}
 */
export function padArguments(inputPath, outputPath, height = SCREENSHOT_HEIGHT, width = SCREENSHOT_WIDTH) {
  return [
    "--padToHeightWidth",
    String(height),
    String(width),
    "--padColor",
    "FFFFFF",
    inputPath,
    "--out",
    outputPath,
  ];
}

/**
 * Write a PNG from the padded BMP. Kept separate from the pad.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {string[]}
 */
export function pngFormatArguments(inputPath, outputPath) {
  return ["-s", "format", "png", inputPath, "--out", outputPath];
}

/**
 * @param {{ inputPath: string, fittedPath: string, paddedPath: string, outputPath: string, width: number, height: number }} options
 * @returns {string[][]}
 */
export function screenshotCommands({ inputPath, fittedPath, paddedPath, outputPath, width, height }) {
  const fitted = fitInside(width, height);
  return [
    resampleArguments(inputPath, fittedPath, fitted),
    padArguments(fittedPath, paddedPath),
    pngFormatArguments(paddedPath, outputPath),
  ];
}

/**
 * @param {string} text
 * @returns {{ width: number, height: number }}
 */
export function parsePixelSize(text) {
  const width = Number(String(text).match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(String(text).match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("sips did not report pixelWidth and pixelHeight.");
  }
  return { width, height };
}

/**
 * @param {string} platform
 * @returns {string | null}
 */
export function unsupportedPlatformMessage(platform) {
  if (platform === "darwin") {
    return null;
  }
  return `npm run screenshots needs macOS sips. This computer is ${platform}, so no screenshots were written. Run this command on a Mac.`;
}

/**
 * @param {{ platform?: string, fileNames: string[], capturesDir: string, screenshotsDir: string, tempDir?: string, execFile: Function, removeFile?: Function }} options
 * @returns {string[]}
 */
export function runScreenshots({
  platform = process.platform,
  fileNames,
  capturesDir,
  screenshotsDir,
  tempDir = os.tmpdir(),
  execFile,
  removeFile = rmSync,
}) {
  const blocked = unsupportedPlatformMessage(platform);
  if (blocked) {
    throw new Error(blocked);
  }
  const images = imageCaptures(fileNames);
  if (images.length === 0) {
    throw new Error("No PNG or JPG files in store-assets/captures. Add captures, then run npm run screenshots again.");
  }
  const written = [];
  for (const name of images) {
    const inputPath = path.join(capturesDir, name);
    const outputName = screenshotOutputName(name);
    const outputPath = path.join(screenshotsDir, outputName);
    const stem = outputName.slice(0, -".png".length);
    const fittedPath = path.join(tempDir, `workspace-tab-organiser-${stem}.fitted.bmp`);
    const paddedPath = path.join(tempDir, `workspace-tab-organiser-${stem}.padded.bmp`);
    const probed = execFile("sips", ["-g", "pixelWidth", "-g", "pixelHeight", inputPath], { encoding: "utf8" });
    const size = parsePixelSize(probed);
    const [resample, pad, toPng] = screenshotCommands({
      inputPath,
      fittedPath,
      paddedPath,
      outputPath,
      width: size.width,
      height: size.height,
    });
    try {
      execFile("sips", resample);
      execFile("sips", pad);
      const padded = parsePixelSize(execFile("sips", ["-g", "pixelWidth", "-g", "pixelHeight", paddedPath], { encoding: "utf8" }));
      if (padded.width !== SCREENSHOT_WIDTH || padded.height !== SCREENSHOT_HEIGHT) {
        throw new Error(`sips did not pad ${name} to ${SCREENSHOT_WIDTH} by ${SCREENSHOT_HEIGHT}. The image is ${padded.width} by ${padded.height}.`);
      }
      execFile("sips", toPng);
    } finally {
      removeFile(fittedPath, { force: true });
      removeFile(paddedPath, { force: true });
    }
    written.push(outputPath);
  }
  return written;
}

function main() {
  const blocked = unsupportedPlatformMessage(process.platform);
  if (blocked) {
    console.error(blocked);
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const capturesDir = path.join(root, "store-assets", "captures");
  const screenshotsDir = path.join(root, "store-assets", "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });
  let fileNames = [];
  try {
    fileNames = readdirSync(capturesDir);
  } catch {
    fileNames = [];
  }
  try {
    const written = runScreenshots({ fileNames, capturesDir, screenshotsDir, execFile: execFileSync });
    for (const file of written) {
      console.log(file);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main();
}
