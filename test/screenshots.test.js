import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  fitInside,
  imageCaptures,
  padArguments,
  parsePixelSize,
  resampleArguments,
  runScreenshots,
  screenshotCommands,
  screenshotOutputName,
  unsupportedPlatformMessage,
} from "../scripts/screenshots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a capture is scaled to fit inside 612 by 408", () => {
  assert.deepEqual(fitInside(1224, 816), { width: 612, height: 408 });
  assert.deepEqual(fitInside(1000, 800), { width: 510, height: 408 });
  assert.deepEqual(fitInside(400, 200), { width: 612, height: 306 });
  assert.deepEqual(fitInside(800, 2000), { width: 163, height: 408 });
  assert.deepEqual(fitInside(612, 408), { width: 612, height: 408 });
  const wide = fitInside(1000, 800);
  assert.equal(wide.width <= 612, true);
  assert.equal(wide.height <= 408, true);
  assert.throws(() => fitInside(0, 100), /positive numbers/);
});

test("screenshot names are png files and sips arguments pad with white", () => {
  assert.equal(screenshotOutputName("popup.png"), "popup.png");
  assert.equal(screenshotOutputName("popup.JPG"), "popup.png");
  assert.equal(screenshotOutputName("folder/after-apply.jpeg"), "after-apply.png");
  assert.deepEqual(imageCaptures([".gitkeep", "notes.txt", "Popup.PNG", "shot.jpg", "shot.jpeg", ".hidden.png"]), [
    "Popup.PNG",
    "shot.jpg",
    "shot.jpeg",
  ]);

  const fitted = fitInside(1000, 800);
  const resample = resampleArguments("in.png", "out.bmp", fitted);
  assert.deepEqual(resample.slice(0, 3), ["--resampleHeightWidth", "408", "510"]);
  assert.deepEqual(resample.slice(3, 6), ["-s", "format", "bmp"]);
  const pad = padArguments("fitted.bmp", "padded.bmp");
  assert.ok(pad.indexOf("--padToHeightWidth") < pad.indexOf("--padColor"));
  assert.deepEqual(pad.slice(0, 5), ["--padToHeightWidth", "408", "612", "--padColor", "FFFFFF"]);
  assert.equal(pad.includes("-s"), false);
  assert.equal(pad.at(-1), "padded.bmp");

  const [resampleCommand, padCommand, pngCommand] = screenshotCommands({
    inputPath: "captures/shot.jpg",
    fittedPath: "shot.fitted.bmp",
    paddedPath: "shot.padded.bmp",
    outputPath: "screenshots/shot.png",
    width: 1000,
    height: 800,
  });
  assert.equal(resampleCommand[1], "408");
  assert.equal(resampleCommand[2], "510");
  assert.deepEqual(padCommand.slice(0, 5), ["--padToHeightWidth", "408", "612", "--padColor", "FFFFFF"]);
  assert.deepEqual(pngCommand.slice(0, 3), ["-s", "format", "png"]);
  assert.equal(pngCommand.at(-1), "screenshots/shot.png");
});

test("sips size text is read and a non-Mac system is refused", () => {
  assert.deepEqual(parsePixelSize("/tmp/shot.png\n  pixelWidth: 1200\n  pixelHeight: 800\n"), {
    width: 1200,
    height: 800,
  });
  assert.throws(() => parsePixelSize("no size"), /pixelWidth/);
  assert.equal(unsupportedPlatformMessage("darwin"), null);
  const message = unsupportedPlatformMessage("linux");
  assert.match(message, /macOS sips/);
  assert.match(message, /linux/);
  assert.match(message, /Mac/);
});

test("runScreenshots builds the sips commands and does not call sips off macOS", () => {
  const calls = [];
  assert.throws(() => runScreenshots({
    platform: "linux",
    fileNames: ["shot.png"],
    capturesDir: "captures",
    screenshotsDir: "screenshots",
    execFile() {
      calls.push("called");
    },
  }), /macOS sips/);
  assert.deepEqual(calls, []);

  const written = runScreenshots({
    platform: "darwin",
    fileNames: [".gitkeep", "shot.jpg"],
    capturesDir: "captures",
    screenshotsDir: "screenshots",
    tempDir: "tmp",
    execFile(_command, args) {
      calls.push(args);
      if (args[0] === "-g") {
        if (String(args.at(-1)).endsWith(".padded.bmp")) {
          return "pixelWidth: 612\n  pixelHeight: 408\n";
        }
        return "captures/shot.jpg\n  pixelWidth: 1000\n  pixelHeight: 800\n";
      }
      return "";
    },
    removeFile() {},
  });
  assert.deepEqual(written, [path.join("screenshots", "shot.png")]);
  assert.equal(calls[0][0], "-g");
  assert.deepEqual(calls[1].slice(0, 3), ["--resampleHeightWidth", "408", "510"]);
  assert.deepEqual(calls[2].slice(0, 5), ["--padToHeightWidth", "408", "612", "--padColor", "FFFFFF"]);
  assert.equal(calls[2].includes("-s"), false);
  assert.equal(calls[3][0], "-g");
  assert.equal(String(calls[3].at(-1)).endsWith(".padded.bmp"), true);
  assert.deepEqual(calls[4].slice(0, 3), ["-s", "format", "png"]);
});

test("a pad that leaves the wrong size is an error", () => {
  const calls = [];
  assert.throws(() => runScreenshots({
    platform: "darwin",
    fileNames: ["shot.jpg"],
    capturesDir: "captures",
    screenshotsDir: "screenshots",
    tempDir: "tmp",
    execFile(_command, args) {
      calls.push(args);
      if (args[0] !== "-g") {
        return "";
      }
      if (String(args.at(-1)).endsWith(".padded.bmp")) {
        return "pixelWidth: 336\n  pixelHeight: 408\n";
      }
      return "pixelWidth: 1000\n  pixelHeight: 800\n";
    },
    removeFile() {},
  }), /336 by 408/);
  assert.equal(calls.some((args) => args[0] === "-s" && args[2] === "png"), false);
});

test("npm run screenshots exits non-zero where sips is not available", { skip: process.platform === "darwin" }, () => {
  const result = spawnSync(process.execPath, ["scripts/screenshots.js"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /macOS sips/);
});
