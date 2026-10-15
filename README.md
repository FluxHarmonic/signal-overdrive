# Signal Overdrive

A Mode 7 racer in the spirit of F-Zero, set in the world of
[Crash The Stack](https://crashthestack.com/) and written in
[Sigil](https://usesigil.org).

You're Zero, a data courier. Gibson owns every wire in the city, so the
collective hides its messages inside songs, and couriers like you carry
them by hand to pirate uplinks, where they go out over the air. Your cargo
is the song, and its integrity is your energy meter. Boosting spends it,
scraping a wall costs it, and the checksum lane wins it back. Deliver it
clean and the whole city hears your song!

**Play:** [signaloverdrive.net](https://signaloverdrive.net/), free in
your browser. The first build, 0.1, is coming soon: one track and one
song, *Carrier*, wired through the whole race.

## How to play

Each race is three laps against five rivals. They follow the racing line,
bump you, and move across to block you, so you'll have to work for every
place.

- **Integrity is everything.** The meter at the top is your cargo. Walls
  cost you, and boosting spends it. If it hits zero, the cargo is corrupt
  and the run is over.
- **The checksum lane** is the repair strip on the track. Drive through it
  and your integrity refills.
- **Boost** comes online on lap 2. It's fast, but every boost costs
  integrity, so pick your moments. Boost pads on the track give you a
  burst for free.
- **ICE patches** are the orange and red static on the road. Cross one and
  your steering scrambles for a second or so.
- **Drift** through the tight corners: hold the drift button and the
  machine slides instead of gripping.

The race follows the song's shape. Lap 1 is the verse, and your boost
comes online with the chorus on lap 2. The final lap is the drop, and
that's when Gibson finally traces you. You only hear the song's melody
whole when you cross the uplink. From your second lap on, your best lap
races alongside you as a ghost.

If your system asks for reduced motion, the game respects it: every
effect keeps its meaning in color and in the HUD, but nothing tears,
ripples or flickers. You can also turn it on with `?motion=reduce` in the
address.

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Steer | Left/Right or A/D | Left stick or d-pad |
| Accelerate | Up or W | A or right trigger |
| Brake | Down or S | B or left trigger |
| Boost (from lap 2) | Space | X |
| Drift (hold) | Shift or C | LB or RB |
| Start | Enter or Space | Start or A |
| Restart | R | Back |

**On a phone** the machine accelerates by itself, and you pick one of three
touch schemes with the button at the top left (it shows the current scheme's name):

- **zones** (the default): a thumb on the left half of the screen steers
  left, on the right half steers right, both thumbs brake, and the BOOST
  button boosts.
- **drag**: one finger anywhere steers by how far it slides sideways from
  where it landed. A second finger boosts as it lands and drifts while held.
- **stick**: a floating stick under your left thumb steers (pull down to
  brake). A thumb landing on the right half boosts, and drifts while held.

## How it was made

I designed Signal Overdrive and I direct every part of how it's made. AI
agents write the code, the music and the pixel art from my direction, and
I play every build, listen to every sound, and decide what stays. No image
generator was used: the machines, the track and the city are drawn by
scripts an agent wrote. If the use of AI is a dealbreaker for you, I
understand! The source and its commit history are all here, so you can see
exactly how it was made.

## Building and running

You'll need the Sigil toolchain version the repo pins (the `sigil:` line in
`package.sgl`; `sigil cli use` picks it) and, for the native build, the C
libraries that `manifest.scm` lists. `scripts/dev` runs a command inside
that environment through Guix.

    scripts/dev sigil deps install                the dependencies, from sigil.lock
    scripts/dev sigil build                       the native dev build
    scripts/dev ./build/dev/bin/signal-overdrive  run it
    scripts/dev sigil build --config release      the native release build
    scripts/dev sigil build --config web          the browser build, in build/web

To play the browser build, serve it locally:

    node scripts/serve.mjs build/web 8080 --loopback

and open <http://127.0.0.1:8080/>. `serve.mjs` also sends the cross-origin
isolation headers that give the game its best audio path. Opening
`index.html` straight from disk won't work.

The tests are in `test/`. Run one file with
`scripts/dev sigil test --sgl test/test-handling.sgl` (and likewise for
`test-race`, `test-track`, `test-fx` and the rest).

### Where things are

- `src/signal/mode7/` is the Mode 7 camera and renderer: a fragment shader
  that projects the tiled track toward the horizon.
- `src/signal/handling.sgl` is one machine's handling, `track.sgl` the
  tracks, `race.sgl` the grid, laps, rivals and the finish, and
  `scene.sgl` the frame: the Mode 7 pass, the palette and dither pass,
  and the HUD.
- `src/signal/music/` and `music/` are the soundtrack. The songs are
  written for the [motif](https://codeberg.org/sigil/motif) synth engine,
  and `docs/CONDUCTOR.md` describes how the race and the song keep time.
- `scripts/art/` holds the generators for every image in `assets/signal/`
  (Node, no dependencies).

### Development tools

The game carries the tools I use to tune it. In the native build they're
always on. In the browser build, add `?dev` to the address to turn them on,
so a player can't trip them by accident.

- Tab opens the tuning overlay (Up/Down pick a knob, Left/Right change it,
  0 resets it). Every knob also takes a URL parameter of the same name,
  with or without `?dev`, so `?grip=8.5` sets the grip from the address.
  `signal-overdrive --knobs` prints the full table.
- `?fps` shows the frame rate, the frame's timings and the audio readout,
  with a graph of the last 180 frames, and works for anyone. F3 toggles
  it. While it's on, F4 prints the recent hitches to the console. F5
  pauses the native build.
- With `?dev`, the browser build also gets the effects panel (the EFFECTS
  button, or E): each effect's toggle and intensity, solo, and a button
  that fires each trigger. F2 and F6 to F10 do the same from the keyboard.
  `docs/effects.html` describes the effects.
- P switches the palette and / toggles the dither, in every build.
- Other parameters: `?track=loop` (a second test track, with a hairpin),
  `?start` (skip the title), `?card=0` (skip the card before it), `?mute`,
  `?autopilot`, and `?touch=zones|drag|stick`.

## Licenses

The code is GPL-3.0-or-later (`LICENSE`). The art, the music and the
content are CC-BY-4.0 (`assets/LICENSE`), credit David Wilson / Flux
Harmonic, except the reserved marks in `assets/RESERVED.md`: the name, the
logo and the Flux Harmonic mark. The third-party notices, including the
site's font, are in `NOTICE`.

## Links

- [signaloverdrive.net](https://signaloverdrive.net/), the game's site
- [github.com/FluxHarmonic/signal-overdrive](https://github.com/FluxHarmonic/signal-overdrive), the source
- [Flux Harmonic](https://fluxharmonic.com/), which makes it, along with
  [Crash The Stack](https://crashthestack.com/),
  [Harkfell](https://harkfell.com/) and
  [Phantom Burn](https://phantomburn.net/)
