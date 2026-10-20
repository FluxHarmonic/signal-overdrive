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

Coordinates are texels in a flat per-track world, y down. Optional
`world: {width: 5120, height: 5120}` defaults each missing dimension to 5120.
Each dimension must be an integer in 4096..8192 and a multiple of 32. Rectangular
worlds are supported; width and height are independent. There is no implicit
geometry scaling or recentering. Geometry is a
closed centripetal Catmull–Rom spline; the first control point is the start
line. `geometry.type` is `catmull-rom`, with `control: [[x,y], ...]` and
`halfWidth: 78..92`. The handling oval uses the `stadium` shorthand with
`center`, `straight`, `radius`, `points` and `halfWidth`. Constant widths
only; terrain, crests and variable widths require a format extension.

The world gate keeps every centreline sample at least half-width+200 from
each corresponding edge. The painter allocates one width×height RGBA canvas
(100 MiB at 5120², 256 MiB at 8192²), then emits a width/32 by height/32 tile map,
a deduplicated atlas, averages and an optional 1/8 preview. It never saves or
encodes a second full-world PNG. Run maximum-size generation as a bounded
Phantom job with enough headroom for Node and the small atlas/preview buffers;
the task's verification uses a 4 GiB process address-space limit. Generated
track metadata carries both dimensions into `mode7-set-world!` whenever the
selected track changes. Shader bounds test both axes independently; atlas
columns come from its average texture. The 4096 unique-tile limit is unchanged.
Phantom's full 8192² generation measured 386 MiB peak RSS, including its
256 MiB canvas; the 4128×5152 rectangular probe measured 195 MiB. Both emitted
tile maps with matching dimensions and passed generated-data roundtrips.

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
| `musicZones` | `[{id, kind, from, to, sections: [mark,...]}, ...]`; `drop`, `searchlights`, `firewall`, `drone` |
| `decoration` | `{puddles: 70}`; deterministic paint seed remains 7 |

Intervals have `0 <= from < to <= 1`. Split intervals that cross the line.
Permanent seeded layouts combine with static road ICE. Their lane gate checks
the full Cartesian product, including touching endpoints. Live layers use the
approved time-aware gate below. The product is capped at 4096; larger inputs fail.
Offline `--seed N` selects the layouts by mixed-radix index, in layer order;
seeds 0 through product−1 cover every combination. Permanent selections paint
the ICE and produce permanent collision zones. Live firewall/drone layouts are
exported in the schedule, without being baked into permanent ICE or art.

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
node scripts/track/combined-ice.mjs tracks/oval.json build/track/oval-ai.json \
  build/track/oval-combined.json
node scripts/track/preview.mjs tracks/oval.json build/track/song-contract.json \
  build/track build/track/oval-ai.json build/track/oval-combined.json
node --test scripts/track/gates.test.mjs scripts/track/combined-ice.test.mjs
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

Race duration must be **25–35 seconds at par**, inclusive. Length divided
by top speed is informational and never rejects a track. The oval's
`test` role exempts only timing, as specified by design §6.1. The actual
game AI must complete three laps for all six racers within 180 simulated
seconds. Radius is checked both historically (smoothed) and locally on
dense unsmoothed spline samples: at least 1.6 half-widths. World margin,
non-neighbour road clearance, tile budget and palette checks remain active.

The par benchmark is the best of three completed player-autopilot laps
(`min(lapTicks)/60`) from `runtime.mjs` and `ai.sgl`, using seed 0, default
tuning and actual game physics with all six racers. The racing-line AI
looks ahead `70 + .32*speed` texels, reduces throttle to .4 above heading
error .45 radians, brakes .6 above .7 radians at speeds over 260, and
drifts above .32 radians. Manual boost is off; authored pads and ICE remain
active. Actual corner speeds determine par; 522 texels/s is a planning
estimate, not a gate constant. Geometry-only reports and previews explicitly
leave par pending. Supply the AI report to the preview to show measured par.

Readability is frozen: each same-sign bend starts at |curvature| ≥1/5000;
an S splits at its direction change. From 1900 texels before that entrance,
the entrance centreline and a continuation 96 texels into the bend must
both be inside the normal top-speed camera frustum and before fog. This
does not require both road edges or a far-side apex. Crests and terrain
must add line-of-sight occlusion before they can be accepted. Do not tune
the curvature threshold to make a layout pass.

Each gate has a sabotage check: folded wall, local sharp corner hidden by
smoothing, crossing roads, out-of-world road, 20s/40s par laps, hairpin hidden
beyond a previous corner, complementary seeded ICE blocking the road,
over-budget atlas, non-palette pixels, mismatched song binding,
a stalled AI (`ai.sgl -- file.sgv stall`), and the
handling oval declared as a race (all racers finish, but par is too short). A passing
test suite proves those refusals work; track acceptance also needs the
track's own generated/AI reports to pass.
The preview's acceptance fields cover geometry, measured par and combined
ICE. Actual atlas and palette acceptance additionally requires the strict
painter's report; `verify.mjs` checks all stages together.

## Combined live ICE and layout changes

Static/seeded lane reports alone do not establish gameplay fairness. Run
the time-aware gate with the AI report's actual lap-crossing ticks:

```sh
node scripts/track/combined-ice.mjs tracks/oval.json build/track/oval-ai.json \
  build/track/oval-combined.json
```

The schedule lives in each `iceLayers[]` entry, beside `id` and `layouts`:

```json
{"id":"wall", "kind":"firewall", "fromLap":3, "phraseBars":4,
 "upBars":1, "downBars":1, "phaseBars":0,
 "layouts":[{"id":"left", "zones":[[0.4,0.435,-1,0.2]]}]}
```

Kinds are `firewall`, `drone` (the design's swarm), and `seeded-static`.
Live cadence is `(bar + phaseBars) mod (upBars + downBars) < upBars`.
Phrase layout index is `(seedDigit + floor((bar + phaseBars)/phraseBars))
mod layoutCount`; `phraseBars:0` fixes it. Seed digits use the same mixed-radix
order as generation. Static layers keep their selected layout throughout.
Live layers first rise on an eligible downbeat after a full telegraph bar
following `fromLap`'s observed crossing. Missing legacy firewall cadence is
zero-rest diagnostic data, not an approved implicit fix. External policy
overrides are rejected. Top-level `tracer` may set `enabled`, `fromLap` and
`periodBars`; footprint dimensions and safety limits are fixed.

The approved Neon Row bible §3 rules are enforced together:

- Every point and change keeps a reachable 27-texel lane and a full bar of
  telegraph. Hazards closer than 960 texels share a 27-texel corridor; this
  comparison uses complete occupied cross-sections and wraps over the line.
- Each physical straight or same-direction sweeper carrying ICE reserves
  its whole run plus 300 texels at each end. Overlapping stretches merge,
  including across the start line. Untouched run portions can host tracers.
  Static ICE owns its stretch throughout the race. A second owner needs the
  bible's explicit exception: universal combined proof for every seeded
  layout and tracer target. Otherwise the gate rejects the conflict.
- Tracers use a 920×68 strip centred 600 texels ahead of the target, after
  a full telegraph bar. The whole strip must fit one stretch free for its
  six-tick life plus a bar. Prior tracer reservations also count. If no legal
  target remains, it waits for the next eligible bar. Neighbour-unsafe targets
  are rejected by an exact continuous corridor guard, at every lateral target.
- Opposite-side swaps require a full down bar, including swarm side swaps.
  A safe same-side continuation does not force an extra rest.
- Firewall coverage is at most 60%, drone coverage at most 40%, and neither
  may overlap the checksum/repair lane. Rivals do not count as ICE closures.

`track-ice-schedule` holds generated quoted data. Runtime consumers
`track-live-ice-at` and `track-tracer-slot` read that data through
`(signal ice schedule)`, using simulation ticks, seed and lap-crossing history.
Crossing history has four entries (lap1 through finish), with `#f` for not yet
observed crossings; no future lap/finish oracle is needed. An unknown future
owner cannot establish a free tracer reservation, so the planner yields.
The gate uses complete actual crossing history from the AI/replay report.
Runtime placement results include stretch ID, reservation end, strip centre
and telegraph tick. `(signal ice runtime)` advances the same scheduler in the
race, publishes warnings before strikes, and retains life-plus-bar reservations.
`(signal ice placement)` supplies the shared local-curvature, checksum and
1900-texel visibility admission. Future crests/terrain need an occlusion test.
The combined CLI executes these actual Sigil modules; disagreement with its
independent JavaScript diagnostic oracle is a failure. It also checks all three
shared tier contracts, including tracer bars shifted by tier telegraph/cadence.

`(signal tiers)` owns LEARNER/COURIER/ELITE pace and ICE density as data.
Their rival pace is 0.92/0.97/1.02. Live-layer density retains every third,
second or first authored UP opportunity, counted separately for each layer
with its phase. Counting absolute song bars would erase odd-phase layers at
COURIER; the phase sabotage requires both firewall and swarm to survive every
tier. Density never activates an authored down bar or changes a footprint.
`race-new` takes `tier:`, `mode:` (`run` or `time-trial`) and `seed:` keywords;
flow passes these selections and must not scale rival pace itself. Time trial
removes rivals and ICE. Finale rivals Null and Void alternate eight-bar turns.
Null announces lane changes a beat ahead. Void's reserved, telegraphed wake
counts in the corridor guard, clears at handoff, and mutes music only on contact
while playback time advances. Rival bodies are excluded from the ICE gate.
Curved active/warning meshes and dedicated pair sprites are wired into the
scene; source/native/audio/draw tests remain separate from track acceptance.
The handling oval has no authored automatic live hazards.

Run `check-pair-wake` for the shared placement, runtime, race and canonical
oracle regressions. `check-density-cup` drives all three cup tracks at every
tier, reporting actual lap crossings, PAR and per-kind hazard/paired-rival
observations. `check-density-histories` then audits those crossing reports
with the canonical scheduler across seeds and shared tier profiles. Keep
each individual status: an overall timeout never establishes acceptance.

On Phantom, `check-native-direct` checks the real queued audio mute and
visible curved meshes for every ICE kind. Its harness selects native packages
from archives present in `build/release/native`, preserving dependency order.
Installed development dependencies without release archives are omitted; the
harness does not build or fetch their archives. `check-native-scene` uses the
existing standard native runner to capture complete shell/race scenes with
current assets, normal camera and HUD. It fast-forwards genuine simulation
ticks to choose frames; it does not measure frame times or audio pacing.
The swarm's scheduled-state capture may be offscreen when this driver's
pass misses its live cadence; the separate mesh proof establishes visible
swarm geometry. Missing or stale captures and frame/shader errors fail the
wrapper even if a native frame coroutine swallows an exception.
The default `scripts/dev sigil test` suite records three named skips for
these native-only files. Setting `SIGIL_TEST_HARNESS` requests execution:
the staged runner must exist, its private Xvfb display must match
`SIGNAL_ICE_PRIVATE_DISPLAY`, and `SIGIL_AUDIO_BACKEND` must be `null`.
Missing prerequisites under an explicit harness are failures, never skips.
The wrappers establish those settings and reject skipped execution.
`check-native-isolation` proves the native checks, a real queued-audio mute
sabotage, broken-harness refusal and the default full suite with named skips.
`check-native-review` copies a completed native bundle, assets, license and
Guix launcher into a private review tree, smokes that isolated copy and
creates a checksummed archive. It performs no publication or deployment.

The generated/probe data roundtrip includes the full schedule; cross-language
parity checks exercise the actual runtime adapters over seeds, cadence/phrase
boundaries, partial history, wrapped strips, targets and reservations. Separate
observed-event sabotage bypasses the planner to prove illegal tracers fail.

`test/fixtures/tracks/scheduled/` contains explicit-rest Quayside/Basin
candidates with unchanged geometry. Original snapshots remain diagnostic
evidence. `check-schedule` runs the policy/parity and actual timing audit;
`check-final` runs painting, full gate/parity checks, source suites and native
smokes. `check-combined` audits original unscheduled drafts and returns RED.
`check-followup` requires fresh current-pipeline artifacts and proves the
legacy refusal independently of exit status. `check-par` includes real
approximately20s/40s duration sabotages. `check-world` additionally exercises
rectangular/8192 generation; retired-loop geometry stays RED.
