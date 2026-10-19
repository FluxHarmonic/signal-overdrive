# Track authoring

Author data in `tracks/<id>.json`. Use `tracks/oval.json` as a small example;
the `test/fixtures/tracks/` files are intentionally preserved draft evidence.
The prototype loop is retired from the playable catalog and retained as
`test/fixtures/tracks/retired-loop.json`; it fails the current radius and
readability gates. The oval remains selectable as a handling test.
Run generation, tests and previews on Phantom or a runner. No browser or
running game is needed for the SVG map and song timeline.
See the generated [oval map and timeline](tracks/oval-preview.svg) and
[machine-readable report](tracks/oval-report.json), including actual AI landings.

## Format v1

Coordinates are texels in a flat 4096×4096 world, y down. Geometry is a
closed centripetal Catmull–Rom spline; the first control point is the start
line. `geometry.type` is `catmull-rom`, with `control: [[x,y], ...]` and
`halfWidth: 78..92`. The handling oval uses the `stadium` shorthand with
`center`, `straight`, `radius`, `points` and `halfWidth`. Constant widths
only; terrain, crests and variable widths require a format extension.

Required identity fields: `version: 1`, `id`, `title`, `district`, `role`
(`race` or `test`). Fractions below measure distance around the lap from
the line. Lateral coordinates are half-width units: −1 left, +1 right.

| Field | Data |
|---|---|
| `zones.boost` | `[[fraction, left, right], ...]`; each pad is 100 texels long |
| `zones.repair` | `[from, to, left, right]`; one strip |
| `zones.ice` | `[[from, to, left, right], ...]`; static ICE |
| `iceLayers` | `[{id, layouts: [{id, zones: [...]}, ...]}, ...]` |
| `sections` | `[{id, from, to, label}, ...]`; map annotations |
| `musicZones` | `[{id, kind, from, to, sections: [mark,...]}, ...]`; `drop`, `searchlights`, `firewall` |
| `decoration` | `{puddles: 70}`; deterministic paint seed remains 7 |

Intervals have `0 <= from < to <= 1`. Split intervals that cross the line.
Every seeded layout combines with the static ICE and one layout from each
other layer. The free-lane gate checks the full Cartesian product, including
touching endpoints. The product is capped at 4096; larger inputs fail.
Offline `--seed N` selects the layouts by mixed-radix index, in layer order;
seeds 0 through product−1 cover every combination. The same selection paints
the ICE and produces the runtime collision zones. Runtime reseeding and
live firewalls/tracers are separate gameplay features.

`song` binds `{id, cues: "music/<song-id>/cues.sgl", bpm, sections}`. The
section targets are the existing conductor contract, in this order:

```json
[
  {"mark":"lap1", "lap":1, "at":0},
  {"mark":"lap2", "lap":2, "at":0},
  {"mark":"hold", "lap":2, "at":0.5},
  {"mark":"fill", "targetLap":3, "targetAt":0, "leadBars":2},
  {"mark":"traced", "lap":3, "at":0},
  {"mark":"uplink", "lap":4, "at":0}
]
```

Cue sheets own section lengths, loops and automatic exits. The exporter
checks them against the compiled song. Compile the intended song first
with `scripts/compile-score`; a mismatched binding fails the preview.
The SVG distinguishes ideal constant-top-speed bar predictions from the
actual Sigil autopilot/conductor landings in the AI report.

## Inspect and generate on Phantom

From the repository root, using the pinned compiler:

```sh
mkdir -p build/track
~/.sigil/versions/0.22.11/sigil -L src eval -f scripts/track/song-contract.sgl \
  -- music/carrier/cues.sgl > build/track/song-contract.json
node scripts/track/report.mjs build/track/gates.json tracks/oval.json
node scripts/art/gen-track.mjs --file tracks/oval.json --preview --seed 0
node scripts/track/runtime.mjs tracks/oval.json build/track/oval.sgv 0
~/.sigil/versions/0.22.11/sigil -L src eval -f scripts/track/ai.sgl \
  -- build/track/oval.sgv > build/track/oval-ai.json
node scripts/track/preview.mjs tracks/oval.json build/track/song-contract.json \
  build/track build/track/oval-ai.json
node --test scripts/track/gates.test.mjs
```

Every command that finds a failing gate exits nonzero. Reports retain
first witnesses; red SVG markers identify failing bend entrances by sample.
The painter refuses geometry/ICE failures before writing runtime assets and
checks the actual deduplicated atlas against 4096 tiles. For isolated draft
art inspection only, use `--draft --output /tmp/my-track-draft`; draft mode
cannot overwrite repository assets. Registering a new playable track still
requires its generated module in `(signal track)` and the shared track list;
JSON discovery by the authoring tools does not register gameplay menus.

## Acceptance gates

Race length/top and the AI's par lap must both be 25–35 seconds. The oval's
`test` role exempts only timing, as specified by design §6.1. The actual
game AI must complete three laps for all six racers within 180 simulated
seconds. Radius is checked both historically (smoothed) and locally on
dense unsmoothed spline samples: at least 1.6 half-widths. World margin,
non-neighbour road clearance, tile budget and palette checks remain active.

Readability is frozen: each same-sign bend starts at |curvature| ≥1/5000;
an S splits at its direction change. From 1900 texels before that entrance,
the entrance centreline and a continuation 96 texels into the bend must
both be inside the normal top-speed camera frustum and before fog. This
does not require both road edges or a far-side apex. Crests and terrain
must add line-of-sight occlusion before they can be accepted. Do not tune
the curvature threshold to make a layout pass.

Each gate has a sabotage check: folded wall, local sharp corner hidden by
smoothing, crossing roads, out-of-world road, overlong lap, hairpin hidden
beyond a previous corner, complementary seeded ICE blocking the road,
over-budget atlas, non-palette pixels, mismatched song binding,
a stalled AI (`ai.sgl -- file.sgv stall`), and the
handling oval declared as a race (all racers finish, but par is too short). A passing
test suite proves those refusals work; track acceptance also needs the
track's own generated/AI reports to pass.
