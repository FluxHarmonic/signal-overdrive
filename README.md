# Signal Overdrive (feel prototype)

An F-Zero style racer in the Crash The Stack world, built to answer one
question: does it feel good enough to become a game? You're Zero, a data
courier. Your cargo's integrity is the energy meter: boosting spends it,
walls cost it, the checksum lane restores it, and at zero the cargo is
corrupt and the run is over.

The track is a Mode 7 ground plane (a fragment shader projecting a tiled
track toward the horizon), the machines are sprites, and every frame goes
through the Flux Harmonic palette and Bayer dither pass.

## Play it

- https://10.11.0.2:8855/ (self-signed certificate) or http://10.11.0.2:8856/ on wg0
- Native: `scripts/dev sigil build`, then `scripts/dev ./build/dev/bin/mode7-racer` from this directory

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
| Tuning overlay | Tab | |
| Palette, dither | P, / | |

**On a phone** the machine accelerates by itself. Three schemes, picked with
the SCHEME button (top left) or `?touch=zones|drag|stick`:

- **zones** (the default): a thumb on the left half steers left, on the right
  half steers right; both thumbs brake; the BOOST button boosts.
- **drag**: one finger anywhere steers by how far it has slid sideways from
  where it landed (60 px is full lock); a second finger boosts as it lands
  and drifts while held.
- **stick**: a floating stick under the left thumb (sideways steers, pull
  down to brake); a thumb landing on the right half boosts, and drifts
  while held.

## Tuning

Tab opens the overlay: Up/Down pick a knob, Left/Right change it (hold to
repeat), 0 resets it. The overlay's last line is the query string for the
current values, and every knob takes a URL parameter of the same name, so
"grip 8.5 felt right" is `?grip=8.5`. Natively, the same as
`--grip=8.5`. Knobs that change the race (laps, rivals, rival pace) restart
it on the grid.

Other parameters: `?touch=zones|drag|stick`, `?autopilot` (the player drives
the racing line), `?start` (skip the title).

KNOBS-TABLE

## How it's built

- `src/racer/mode7/` the Mode 7 camera and renderer (nothing racing-specific;
  the seed of a later substratic-mode7 package)
- `src/racer/handling.sgl` one machine's handling, pure, with tests
- `src/racer/track.sgl` where a point is on the loop; `track/loop-data.sgl` is generated
- `src/racer/race.sgl` the grid, laps, rivals, the finish and corrupt cargo
- `src/racer/scene.sgl` the frame: the Mode 7 pass, the dither pass, the HUD
- `scripts/art/` the generators for every image in `assets/racer/` (node, no dependencies)

Tests: `scripts/dev sigil test --sgl test/test-handling.sgl` (and
`test-track`, `test-camera`, `test-race`).
