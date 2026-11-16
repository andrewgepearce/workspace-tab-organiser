# Store screenshots

Capture the shots in Opera. `npm run screenshots` scales and pads them. There is no need to resize by hand.

## Where the files go

- Put each capture in `store-assets/captures/`. PNG and JPG are both read.
- The command writes a 612 by 408 PNG to `store-assets/screenshots/`, using the same file name with a `.png` ending.
- Both folders are gitignored apart from `.gitkeep`. A capture can show a real window, so it stays off the remote.

## Shots to capture

1. The popup Preview, with rule groups, in the current workspace.
2. The popup with an Automatic group and the Add rule button.
3. The popup after Apply, with the result summary.
4. The Options page with a few rules.
5. The toolbar button, so the icon is visible in the browser. The publishing guidelines ask for one shot of how the extension looks in the browser, as well as one of how it works.

Use pages that show the extension. Do not use a private window.

## Store rules

- 612 by 408 pixels. That is the size the guidelines prefer. The maximum is 800 by 600.
- White background.
- Other extensions disabled.
- No personal or private tabs or URLs visible.
- No interlaced PNG. The acceptance criteria say interlaced PNGs are not supported.
- Use the default browser UI where you can. Do not show other customisations.

## The helper

`npm run screenshots` runs on macOS only. It calls `sips` through `execFile`. There is no extra dependency.

For each PNG or JPG it:

1. Scales the picture so it fits inside 612 by 408 and keeps the aspect ratio. A smaller capture is scaled up. A larger one is scaled down.
2. Pads it to exactly 612 by 408 with a white background.
3. Writes the PNG next to the other screenshots.

`sips --resampleHeightWidthMax` takes one length, the longest edge. That cannot fit every picture inside a 612 by 408 rectangle, so the helper works out the fitted height and width and calls `--resampleHeightWidth` with those two values. Both sides use the same scale, so the aspect ratio stays.

`--padColor` is honoured for JPEG and BMP when it comes after `--padToHeightWidth`. On sips 316, putting `--padColor` first skips the pad and leaves the picture at its scaled size. On a PNG, `sips` ignores `--padColor` and pads with transparency, so the helper does not pad a PNG.

The helper resamples into a BMP, then pads that BMP with `--padToHeightWidth 408 612` followed by `--padColor FFFFFF`. The padded file stays a BMP. A separate `sips -s format png` call writes the PNG. Combining the pad and the format change in one call made sips warn that the output suffix should be bmp, and that combination was not checked with this argument order. After the pad, the helper reads the pixel size. If it is not 612 by 408, the command stops with an error and does not report success.

Caveat: a capture that already has transparent pixels turns those pixels black in the BMP step, because BMP has no alpha. A normal Opera screenshot is opaque. On sips 316, padding a BMP with the size first and the colour second produced opaque white bars and left the picture itself unchanged. Run `npm run screenshots` on a Mac and open one PNG. Confirm the size is 612 by 408 and the bars are white.

On any other system the command prints a message and exits non-zero. It does not write a screenshot.
