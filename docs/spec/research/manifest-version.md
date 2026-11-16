# Manifest version

These notes record why this extension uses Manifest V2.

## Manifest

The extension uses Manifest V2 because that is the format Opera’s extension reference still specifies, and Opera 139.0 has now loaded and run it successfully in an isolated development profile.

Opera’s manifest document says that, as of Opera 15, developers should set `manifest_version` to `2`. `name` and `version` are required. A toolbar popup is declared with `browser_action.default_popup`. The supported-API list records no Opera-specific differences for `browserAction` or `Runtime`. `runtime.getManifest` is one of the runtime methods Opera documents for extension contexts. A background page is for coordinating browser UI such as badges and click handlers. The popup example does not require one, so this package has no background script and no service worker.

Opera 139 Stable, released 27 October 2026, updates Chromium to 155.0.8059.85. `minimum_opera_version` is `139.0`. Opera’s product posts say Manifest V2 extensions still load on Opera after Chrome’s Manifest V2 cutoff. A 4 November 2026 Opera article also shows a Manifest V3 package (`manifest_version` 3, `action`, and `background.service_worker`) for a different extension. That article is evidence that Opera publishes Manifest V3 examples. It is not a load test of this package on the installed Opera 139.0, so the skeleton stays on the reference Manifest V2 popup.

The local result confirms Manifest V2 for this skeleton. It does not establish compatibility for Manifest V3 or APIs that are not used here.

### Sources

- Manifest fields and `manifest_version` 2: <https://help.opera.com/en/extensions/manifest/>
- Toolbar popup via `browser_action`: <https://help.opera.com/en/extensions/browser-actions/>
- Supported extension APIs (`browserAction` and `Runtime` list no differences): <https://help.opera.com/en/extensions/apis/>
- `runtime.getManifest` in extension contexts: <https://help.opera.com/en/extensions/content-scripts/>
- Background pages versus popups: <https://help.opera.com/en/extensions/architecture-overview/>
- Unpacked loading: <https://help.opera.com/en/extensions/basics/>
- Manifest V2 still supported on Opera, 10 September 2025: <https://blogs.opera.com/news/2025/09/mv2-extensions-opera/>
- Manifest V2 commitment, 17 October 2024: <https://blogs.opera.com/news/2024/10/opera-support-manifest-v2-ad-blocking/>
- Opera 139 Stable and Chromium 155.0.8059.85, 27 October 2026: <https://blogs.opera.com/desktop/2026/10/opera-139-stable/>
- Manifest V3 example in an Opera article, 4 November 2026: <https://next.opera.com/blog/web-ai-build-extension/>
