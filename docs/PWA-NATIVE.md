# PWA and native release work

The PWA uses the product's existing SemVer release and the existing git/dirty
build stamp for diagnostics. Cache identity also includes a digest of the entire
runtime inventory. Slate's CalVer is a product-specific decision, not grounds to
rename Signal's releases. A single prepare step creates the icons, worker and
inventory, both after web linking and after staging moves wasm to `/w/<hash>/`.
The cache refuses resource bytes that do not match that inventory.
The shell downloads from its canonical directory URL: Pages redirects
`index.html` to that URL. Its cache key remains stable for offline navigation.

Recommend `standalone`: Android and desktop get an app window, while the game's
existing fullscreen gesture remains available. Landscape is preferred. The
180px iOS touch icon and 192/512px ordinary and maskable icons reuse the existing
Signal mark, with its original palette on `#0D0A1A`. Maskable artwork fits the
central safe circle. These are generated from repository art, without new art.

Updates follow Crash's explicit main-menu choice. Harkfell supplies the worker
and deterministic first-install reference. Registration waits until boot texture
loads and two frames finish; `updateViaCache: none` bypasses stale HTTP caches.
An installed candidate stays separate from the selected build. Browsers may
activate workers automatically when the last tab closes, so a durable selected
cache pointer preserves A until the player chooses B, including on next launch.
Every open game must acknowledge a frozen main menu before selection changes.
A racing or suspended/unresponsive tab blocks the swap. A paused race is unsafe.
Activation removes obsolete caches, scoped to this game directory. Update code
does not write or clear localStorage.

The race-flow mode menu shows INSTALL UPDATE after RUN and TIME TRIAL only when
the worker reports a ready build. Its existing keyboard, gamepad and touch row
selection emits an update command. `(signal shell updates)` carries the waiting
flag, menu permission and once-only choice through Crash's `update/waiting`,
`update/chosen?` dispatch bridge. The shell revokes permission in the same frame
that leaves this menu; native sessions never acquire the web item.

Public, online, visibility and periodic update checks share one promise until
the browser's current installation finishes and its metadata is inspected.
`registration.update()` alone resolves before installation finishes; another
caller joins that install instead of starting a competing update job. This
also joins a worker already installing after registration. Download completion
still requires the player's explicit menu choice before activation.
A worker made redundant during installation receives one retry after a second,
within the same shared check. A second interruption ends the check; corrupt
resources still fail verification and never become a ready menu item.
An automatic registration install that fails before any explicit check uses
the same recovery path, preserving first-install silence.

Chrome verification must run on Phantom, never the laptop. The deterministic
controls are `node --test test/test-pwa.mjs`; `node scripts/check-pwa-controls.mjs`
proves the gates reject eight planted defects. Preparation fixtures are
`node --test test/test-pwa-build.mjs`. The real same-profile gate is
`node scripts/verify-pwa.mjs build/site`; repeat with `--restart`, and require
nonzero exit from `--sabotage no-worker` and `--sabotage frozen-worker`.
For a failed update, add `--diagnostics` to capture service-worker console,
exceptions, target lifecycle and install errors through CDP. Worker attachment
can change timing, so also run acceptance without this option. Failures include
worker-script request revisions, server errors, registration transitions and
cache names. `--diagnostics --sabotage mixed-deployment` corrupts only B's wasm
response and must report the worker's actual integrity rejection and exit nonzero.
Every baseline and restart run also calls the public check twice without
awaiting the first call, requires a shared completion promise, and verifies B
is installed before either call completes.
Required real-browser observations:

1. Install A in a fresh profile. Assert real controller, cache inventory,
   installability, rendered frames, no update notification and no menu item.
2. Disable the HTTP cache, deny server responses and emulate offline. Reload
   the same profile; render and drive; fetch every inventory resource offline,
   including staged wasm and audio. Require isolation and no console errors.
3. Restore the network and replace the directory served at the same origin
   with coherent B bytes. Keep A's profile, storage and controller. Explicit
   update check must download B and expose only the main-menu item. Drive a
   race while B waits; no item or reload. A paused race also remains A.
4. Select INSTALL UPDATE using real keyboard/touch menu input. Require B's
   controller-reported selected version, B's page marker, rendering, unchanged
   full progress storage, and removal of A's cache. Repeat after closing every
   tab before selection: reopening must still run A and offer B.
5. Sabotage controls: remove `sw.js` (offline/controller gate must fail), freeze
   A's worker while serving B (update gate must fail), and serve no newer version
   (menu item must stay absent). The deterministic controls separately verify
   that a second racing window vetoes the swap; no real two-window browser
   result is claimed by this harness.

Trusted HTTPS is necessary for phone service workers and installability.
Loopback HTTP is suitable for headless Chrome. Plain HTTP at a VPN IP is not a
secure context. Bypassing a self-signed page's certificate warning does not make
the worker script trusted: that host can preview gameplay, but is not evidence
of install/offline/update success on a phone. Use an explicitly trusted device
certificate or the production domain after release authorization. Preview ports
must be assigned by the leader. No production publish is part of preparation.

## Linux

Build and validate on Phantom first. Preserve the release binary, `assets/`,
LICENSE, NOTICE and asset license/RESERVED files together. The launcher must
change into its own directory before executing the binary; the game's art paths
are relative. Record build SHA, archive SHA256 and readelf dependency report.
Do not call an artifact delivered until it is copied to the laptop and its
exact extracted launcher path is recorded in the task log. Only David runs it
on the laptop.

The first artifact uses `scripts/package-linux` and `packaging/linux-pack.scm`
to produce a relocatable `guix pack -RR` on Phantom. It includes Mesa,
Wayland/X11 and PulseAudio, the original ELF loader's measured dependency
closure, and a directory-changing launcher. The resolver searches that pack's
`$GUIX_ENVIRONMENT/lib`. No Guix install, package download or on-laptop build is
needed when David launches it. This deliberately favours a complete first
artifact over a small download. Verify the extracted archive's OpenGL and
audio under a headless display on Phantom before copying, including menu and
race startup. A manifest evaluation is not a runtime smoke result.

After an authorized build window, on Phantom with a clean source commit:

```sh
scripts/dev sigil deps install
env -u DISPLAY -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
  scripts/dev sigil build --config release
git diff --exit-code
git rev-parse HEAD > build/release/BUILD-SHA
scripts/package-linux build/release build/native-dist
```

Run the build receipt commands only after the preceding build succeeds.
Packaging refuses source changes, mismatched receipts and dependency redirects.
The artifact is `signal-overdrive-linux-<sha12>.tar.gz`, with its checksum and
build/ELF/channel evidence. After extraction David's one command is:

```sh
./signal-overdrive-linux-<sha12>/bin/signal-overdrive
```

Replace `<sha12>` with the actual delivered artifact's stamp; record its exact
path, checksum and runtime acceptance in the task log after copying. Keep
`bin/` and `gnu/` together.

For smaller later downloads on ordinary distributions, investigate Substratic's
existing portable executable path: `make-portable` patches only
the packed copy's ELF interpreter, then `check-linux-binary` refuses store paths,
non-glibc link dependencies and a glibc floor above the promised baseline.
GLFW and miniaudio also dlopen display/audio libraries, so readelf alone does
not prove a playable download. Validate with a stock distro's graphics/audio
libraries and a real headless window. Substratic's `smoke-ubuntu` has a negative
control: the unpatched Guix executable must fail in the same userland.

The relocatable pack avoids a host glibc floor promise, at the cost of a larger
archive and namespace/PRoot runtime support. Neither strategy can bundle a
working host GPU driver for every machine. Use the Guix closure as one coherent
relocated runtime; do not hand-copy its glibc/Mesa into a normal library folder
ahead of the host's driver. Cross-distro support still depends on measured
graphics/audio smoke results; none are claimed yet.

## Later desktop targets

Windows: add a Zig Windows x86-64 release configuration, validate GLFW and
miniaudio's Windows backend and native extension, package exe/assets/licenses
with the same directory-changing launcher behaviour, then run input, save,
OpenGL and sound acceptance on a Windows runner. Cross-compilation alone is
insufficient. A signing certificate and installer are separate release choices.

macOS: use a macOS runner and SDK for the desktop backend, validate the OpenGL
context and audio path, produce app bundles with executable/assets/Info.plist
and icons, and test save paths and input on supported Intel/Apple Silicon
targets. Distribution beyond local development needs signing and notarization.
Do not build either platform as part of this Linux-first task.
