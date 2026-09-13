# BoomRotary - Modern Volume Booster

## Links

*  [GitHub Repository](https://github.com/moodynooby/modern-vol-booster)
* [Download For Firefox at AMO](https://addons.mozilla.org/en-US/firefox/addon/modern-BoomRotary/)
## Description

Volume Control adds a simple per-site volume control to your browser. It can lower volume, boost HTML5 audio and video above the normal browser limit, and optionally play stereo audio as mono. The extension is useful for quiet videos, uneven site volume, embedded players, and pages that do not provide enough audio control on their own.

Settings can be remembered per site, and you can exclude sites where you do not want the extension to run. Volume Control supports HTML5 video and audio only; it does not support Flash.

Excluded-site entries match by domain, and entries saved **with a path** (such as the legacy V4-era defaults) are wildcard-matched against the full URL — so `www.twitch.tv/*/clip/*` excludes only the clip pages while the rest of Twitch runs. A one-time v6.13 migration removes the legacy Twitch default entries that older builds left in users' stored storage (path and `www.` normalization had turned them into a block on the whole domain — issue #69), and the popup's Active toggle now removes **every** entry that blocks the current page — not just the exact domain match — with a tooltip explaining what it removed. Since v6.14 the **options page also accepts user-typed paths**, so path-scoped exclusions are a first-class feature (`example.com/videos`, wildcards with `*` = any characters except `/` — see the options-page hint); the legacy purge now also runs at install/update/startup so a hand-added path entry can never be swept by a migration that has not run yet.

**Compatibility:** Firefox 128+ (event-page background) and Chromium 121+ — Chrome, Edge, Brave, Opera, Vivaldi from January 2024 onward (service-worker background). Chromium 120 and older rejects the cross-browser manifest shape at load time, so the manifest declares `minimum_chrome_version: "121"`.

Media that cannot be boosted (DRM-protected or cross-origin streams) is detected automatically: the popup explains the restriction, the dial clamps at 0 dB, and lowering volume still works through the native fallback. See [Restricted Media](#restricted-media-drm--cross-origin) below. On Firefox, DRM audio **can** be boosted — see the engine note below.

## Restricted Media (DRM & Cross-Origin)

Some media cannot be routed through WebAudio, and whether that applies depends on **both** the media and the browser engine:

- **DRM-protected streams (EME / Widevine / PlayReady / ClearKey)** on **Chrome, Edge, and other Chromium browsers**: `createMediaElementSource()` succeeds but the browser feeds the WebAudio graph **silence** for protected content while the element's native output stays detached — a one-way trip to permanent mute. Volume Control detects these and refuses to route; lowering volume still works through the native fallback.
- **DRM-protected streams on Firefox**: Gecko explicitly allows capturing EME media **audio** through WebAudio (Mozilla bug 1331763, shipped in Firefox 55 — only *video* capture via `captureStream()` is blocked). Since v6.12, Volume Control detects the engine and **routes DRM media normally on Firefox — boosting, mono, and mute all work** on sites like Netflix or Spotify web. Competitor extensions have shipped this behavior for years (it is safe: Firefox's CDM hands decrypted PCM to the standard audio pipeline, which WebAudio taps). Since v6.13 the routing is **ordered after the site's own handshake**: Gecko's `setMediaKeys()` throws `NotSupportedError` on an element that is already audio-captured, so EME elements are routed only once `setMediaKeys()` has **succeeded** (a keys-attached marker — the patched `setMediaKeys` applies the pending state on success). Routing first would break the site's player (issue #68).
- **Cross-origin media without CORS** (e.g. detached CDN players with no `crossOrigin` attribute): the WebAudio spec makes routed no-CORS media output silence **in every engine**, so the guard stays enforced everywhere — "cross-origin" note, 0 dB clamp, native fallback for attenuation/mute only.
- **What about browsers with Widevine disabled (Brave ships it off by default)?** Widevine's availability is irrelevant to Volume Control's audio path — the extension never touches the CDM. Two cases:
  - **Non-DRM media** (most of the web — YouTube, podcast/radio players, detached CDN previews): boosts **identically** to Chrome. Verified live in a Widevine-disabled Chromium run: same routing, same +20 dB route gain, same measured output (3.54 RMS — the exact value Chrome and Firefox produce for the same source).
  - **DRM media**: with Widevine disabled the site cannot decrypt its streams, so nothing plays at all — there is no audio to boost (or the site serves its clear fallback, which then boosts like any other media). A rejected `requestMediaKeySystemAccess` also does **not** trip the "restricted" verdict (the EME page flag is only set when a CDM is actually granted), so no false restriction note appears on sites that merely probe for DRM support.
  - Note that Brave **with Widevine off is not equivalent to Firefox**: Firefox boosts DRM audio because Gecko's WebAudio deliberately allows EME audio capture; Brave is a Chromium engine, so the protected-audio guard stays fully active (and with Widevine *on*, routed DRM audio would be silenced by the browser — refusal remains correct there).
- **PlayReady (Windows Firefox / Edge)**: PlayReady is just another EME key system to Volume Control's detection layer — the EME wraps are **key-system-agnostic**, so PlayReady content behaves exactly like Widevine on every engine: **boostable on Firefox** (Firefox supports PlayReady on Windows and hands the decrypted audio to the same pipeline), guarded on Edge/Chromium. If Firefox's console shows `com.microsoft.playready.recommendation.3000: Internal testing is highly recommended prior to enabling PlayReady playback on Windows…`, that is **Firefox's own informational warning addressed to the site's developers** — not an error, and not produced by Volume Control (it appears with the extension disabled, too). The `setServerCertificate()`/`generateRequest()` advice concerns the *page's* license handshake, which the extension never touches: it only *observes* `setMediaKeys`/`requestMediaKeySystemAccess` and never decrypts anything. A browser without the PlayReady CDM (e.g. Linux Firefox) simply rejects the key system request — and rejected requests never trip the "restricted" verdict. Verified live on real Firefox with a PlayReady-shaped grant: the page is flagged EME-using and the element carries the sticky restricted flag, yet it still routes and boosts **audibly (3.54 RMS at +20 dB — identical to the same run's clear media)** with no "restricted" verdict published.

**What you will see when media is restricted** (Chromium + DRM, or any engine + cross-origin)

- The popup shows a "restricted by DRM" note (or a cross-origin restriction note) and the dial clamps at 0 dB — no boost is offered because none is possible on that media in that browser.
- Lowering volume still works: the element's native volume is used (attenuation only, exact dB math, and mute).
- Mono mixing is unavailable on such media.

**How detection works**

- Per-element signals (v6.13 — the "restricted" verdict requires **per-element DRM evidence**): an `encrypted` event fired, a `setMediaKeys` call (wrapped), or `element.mediaKeys` set. A page that merely PROBES DRM capability never trips the verdict — app.plex.tv probes all three key systems at startup (verified in its production bundle) while playing clear direct-play content, and since v6.9 that probing alone had wrongly clamped boost to 0 dB on every engine (issue #70).
- **Pending EME gate — decryption proof** (v6.14): on EME-probed pages, `blob:` (MSE) sources without per-element evidence are not routed until the element's `currentTime` actually **advances** — proof that the content is decodable, i.e. clear (EME content cannot decode a single frame without MediaKeys attached, and every attachment path is visible: patched `setMediaKeys`/`webkitSetMediaKeys`, `element.mediaKeys`, the `encrypted` event). Progress is observed at `timeupdate` cadence (~4 Hz in Chromium, 15–250 ms per spec) plus a 1 s sweep backup, so clear content routes within **~a quarter second of playback** (Plex — v6.13 waited a blind 3-second window; a mid-session boost while already playing also routes at the next timeupdate). DRM-stalled media (playback blocked on a license, `currentTime` frozen) never proves anything and is never routed — the udio.com birth-window safety is preserved by physics rather than by a timer. When the page actually constructs MediaKeys, earned proof is reset (keys are imminent — the `createMediaKeys` patch), and a source change (`emptied`) re-earns proof for the new source. On Gecko, Netflix routes immediately once keys attach.
- **Residual (documented) limitation**: an element that plays CLEAR content and later switches to encrypted media **on the same element** mid-session can already be routed when the evidence lands — on Chromium there is no way back from `createMediaElementSource()`, so the verdict flips to "restricted" and the (silenced) route cannot be unwound. This exposure existed in every prior version after its grace window expired; v6.14 just makes clear content route sooner. Real sites switch protection by reloading the source (which re-earns proof) or the player, so this is a theoretical edge.
- The MAIN-world hook computes one aggregate page verdict over **every** element it tracks — attached to the DOM, detached (JS-created players that never touch the DOM), or inside a shadow DOM — and publishes it with immediate change notifications.
- Embedded iframes report their verdict to the top frame (1 s heartbeat, 2.5 s TTL) and the most restrictive live report wins; the verdict relaxes automatically when the media goes quiescent or the frame is removed.
- All verdicts are computed deterministically by the top frame — no cross-frame response races, which is what keeps the restriction note stable while you adjust the dial.
- Same-window spoofed messages are ignored (`event.source === window`), so page scripts cannot fake or clear a verdict.
- Engine detection (v6.13): the UA string is checked **FIRST** — a UA containing `Firefox/` identifies Gecko (DRM media is routable, and routed only after `setMediaKeys()` succeeds) — with `navigator.userAgentData` identifying Chromium-family browsers (protected-audio guard stays) checked second. The order matters: a future Firefox that grows a `userAgentData` shim must still classify as Gecko (issue #68). Unknown or privacy-stripped UAs keep the conservative guard.

**Verification:** the restriction pipeline was live-tested against real Widevine playback on udio.com and against a real cross-origin CDN audio source replicating detached-player sites (treblo.com pattern), plus a ClearKey EME harness — restricted media is never routed, the verdict is stable, and fallback attenuation is exact. The engine split was confirmed empirically: on Chromium, routing an element with MediaKeys produces graph silence even for clear audio (measured 0.00 RMS through the route vs 3.53 RMS for the same route on a non-DRM element). The Firefox side was additionally verified **live on a real Firefox 155.0.1** (headless, driven via WebDriver with a locally installed real Widevine 4.10.3112.0 CDM): a genuine `com.widevine.alpha` key system access grant, MediaKeys attached to an MSE-backed element, and the element routed by the hook with **audible output measured through the WebAudio destination (2.13 RMS at +20 dB, gain exactly 10.0) — vs 0.00 RMS for the identical keys-attached setup on Chromium**. Same-origin boost, WebAudio graph insertion (exact gain math), and cross-origin refusal were all re-verified in the same Firefox run, and a Widevine-disabled Chromium run (Brave-style) confirmed clear-media boost is unaffected while a granted CDM still engages the guard. **PlayReady parity** was verified twice: deterministically (harness scenario v13 — the exact key system string `com.microsoft.playready.recommendation.3000` flags the page and element identically to Widevine on both engines: Firefox routes + boosts + unrestricted verdict; Chromium/Edge restricted + never routed; a rejected probe never flags the page), and **live on real Firefox** (`mode=firefox-playready`: the genuine native probe rejects with `NotSupportedError` *without* setting the page-EME flag; a PlayReady-shaped grant resolving through the hook's wrapper flags the page, the element gets the sticky restricted flag, and it is still routed with route gain exactly 10.0 and **audible output — 3.54 RMS, identical to the same run's clear-media control**). Since v6.12.1 the **packaged extension itself has also been install-verified on real Firefox 155** (temporary add-on via WebDriver — the v6.12 manifest was rejected at install time before the dual-key background fix): both content-script worlds run, engine detection returns Gecko, and a driven +20 dB boost routed a real element with route gain exactly 10.0. Harness: `analysis/harness/firefox-live.mjs` + `analysis/harness/firefox-playready-live.mjs` + `analysis/harness/firefox-addon-load.mjs` (+ `vc-test.html?engine-test=1`), results in `analysis/harness/firefox-live-result.json`, `analysis/harness/firefox-playready-result.json`, `analysis/harness/firefox-addon-fixed.stderr.log`, and `brave-sim-result.json`.

## Known Limitations

- Volume Control cannot run on browser system pages such as `chrome://`, `edge://`, `about:`, extension pages, or other protected browser UI.
- DRM-protected media on **Chromium browsers** (Chrome/Edge/Brave/Opera/Vivaldi) can only use the native volume fallback: lowering and mute work; boosting and mono do not (the browser silences WebAudio for protected audio). If Widevine is disabled on such a browser (Brave's default), DRM sites simply won't play anything — non-DRM audio is unaffected and boosts identically. On **Firefox**, DRM media is fully boostable since v6.12. See [Restricted Media](#restricted-media-drm--cross-origin).
- Cross-origin media without CORS can only use the native volume fallback in every engine: lowering and mute work; boosting and mono do not.
- Sites that create their own `createMediaElementSource` pipeline for the same element can end up double-attenuating when Volume Control also routes that element.
- Media that becomes cross-origin-tainted *after* it was already routed cannot be un-tainted; routing continues with the gain that was already applied.
- Sites with unusual, heavily customized, or late-changing WebAudio graphs may not be fully controllable in every playback path.

## Hotkeys

- `Alt+Shift+Up`: Increase volume by 1 dB.
- `Alt+Shift+Down`: Decrease volume by 1 dB.
- `Alt+Shift+0`: Reset volume to 0 dB.
- `Alt+Shift+M`: Toggle mono audio.
- `Unassigned due to 4 hotkey limit, edit in firefox/chrome settings [chrome://extensions/shortcuts]`: Activate the extension.
- `Unassigned due to 4 hotkey limit, edit in firefox/chrome settings [chrome://extensions/shortcuts]`: Toggle mute.

Browser shortcut settings can be used to remap or disable these defaults.
Pin the extension icon to the toolbar to see native badge feedback while adjusting volume.

## Privacy Policy

Volume Control does not collect, transmit, sell, share, or store any personal information outside your browser.

The extension does not use analytics, telemetry, tracking pixels, remote logging, accounts, advertising IDs, or any external server for data collection. Your volume settings, mono setting, excluded sites, remembered sites, whitelist or blacklist mode, and debug preference are stored only in your browser's local extension storage.

The extension reads page audio/video elements locally in your browser only so it can apply the volume and mono settings you choose. This processing happens on your device. No browsing history, page content, audio content, media titles, URLs, or settings are sent to the developer or to any third party.

## Permissions

Volume Control asks for the browser permissions needed to control audio reliably across modern websites:

- `storage`: Saves your volume settings, mono setting, remembered site settings, exclusion list, whitelist/blacklist mode, and debug preference locally in your browser.
- `activeTab`: Lets the popup identify and update the current tab after you interact with the extension, without requesting broader tab access.
- `<all_urls>` host permission: Allows the content scripts to run on websites where audio or video may exist. This is needed because users can play HTML5 media on almost any site, and the extension has to access page-local media elements and WebAudio connections to change their volume.
- `document_start` content script timing: Installs the page audio hooks before sites create `Audio`, `AudioContext`, media elements, or WebAudio destination connections. Loading later can miss audio graphs that are created during early page startup.
- `all_frames` content script access: Lets the extension work with audio/video inside embedded frames, such as video players, social embeds, and media hosted from another domain. Without frame access, only top-level page media would be controllable.
- `file:///*` content script match: Allows the extension to work on local media files when the browser permits extension access to file URLs.

AMO/Chrome Web Store review note: the broad host access, early `document_start` injection, and `all_frames` access are used only to detect and route page-local HTML5 media and WebAudio before playback begins. Volume Control does not collect browsing history, inspect page content for analytics, inject ads, or send page URLs, media metadata, audio content, or settings to a server.

## Demo / Screenshots
![
First
](https://addons.mozilla.org/user-media/previews/full/333/333717.png?modified=1756722002)

![Second](https://addons.mozilla.org/user-media/previews/full/333/333716.png?modified=1756721999)
## Setup

BoomRotary is a browser extension. You can install it by loading it unpacked in your browser's extension settings.

### For Chrome/Brave/Edge:

1.  Download the repository as a ZIP file and extract it to a folder.
2.  Open your browser and navigate to `chrome://extensions`.
3.  Enable "Developer mode" in the top-right corner.
4.  Click on "Load unpacked" and select the extracted folder.
5.  The BoomRotary icon should now appear in your browser's toolbar.

### For Firefox:

1.  Download the repository as a ZIP file and extract it to a folder.
2.  Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3.  Click "Load Temporary Add-on..." and select any file inside the extracted folder (e.g., `manifest.json`).
4.  The BoomRotary icon should appear in your toolbar. Note: Temporary add-ons are removed when Firefox closes. For permanent installation, you might need to sign the extension.

### Usage

1.  **Open the Popup**: Click on the BoomRotary icon in your browser's toolbar.
2.  **Adjust Volume**: Use the dial in the popup to increase or decrease the volume for the current tab.
3.  **Options Page**: Right-click the extension icon and select "Options" to configure additional settings (if any).
4.  **Keyboard Shortcuts**: `Alt+Shift+Up/Down` adjust volume by 1 dB, `Alt+Shift+0` resets, `Alt+Shift+M` toggles mono (remappable in `chrome://extensions/shortcuts`).
## License

This project is open-source. See LICENSE for details (upstream Volume Control license, copyright Dustin Fechner and Chaython Meredith).
