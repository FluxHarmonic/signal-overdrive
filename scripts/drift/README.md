# Conductor drift gate

The gate for 0.1 step 1: the conductor's beat must be heard where the
simulation puts it. An actual native autopilot race is captured from a
private null sink and cross-correlated against a reference rendered
offline from the simulation's own intended jump log.

**Pass:** the beat within 30 ms at p95 and within 60 ms at worst, over at
least 95% of the race's 1.5-second windows (each must correlate at 0.5 or
better). **Three sabotage arms** must each go RED for their own defect.

```sh
node scripts/drift/gate.mjs RUNROOT        # the whole gate, one capture at a time
node scripts/drift/capture.mjs RUNDIR ARM  # one capture; ARM is normal, depth, immediate or skew
node scripts/drift/rejudge.mjs RUNDIR      # re-judge a saved capture with the current analyzer
```

## What is captured: the music alone

The gate judges a **music-only capture**: the game runs with `sfx=0`, which
silences the engine (gain 0) and drops the one-shots while the synth keeps
rendering, so the frame's work and allocation are unchanged. The conductor
clocks only the music; the engine and cues run on their own output paths
and only mask the correlation. Measured on one build, same race timing:

| capture | median correlation | coverage | p95 | worst |
|---|---:|---:|---:|---:|
| full mix (engine, one-shots, music) | 0.73 | 94.3% | 17.2 ms | 27.1 ms |
| music only (`sfx=0`) | 0.93 | 99.6% | 12.7 ms | 21.9 ms |

The full mix stays as a **reported companion** (`CONDUCTOR_MIX=full`, and
`gate.mjs` runs it): its timing numbers and coverage are a REPORT, never a
verdict, so a regression that only shows in the mix stays visible. A
product failure in the full mix (sounding music underruns, a crash, a race
that misses sections) does fail the gate: underruns are the game's, and
the full mix is the workload players run.

## How a capture is judged

1. **Acquisition** correlates one 8-second window from song 2 s, across
   the grid's count-in into lap1. The count-in's bars are identical and
   correlate at 0.99 to 1.00 one bar apart, so a short window there can
   lock a whole bar off; the section change inside the long window makes
   the alignment unique.
2. **Tracking**: each later 1.5-second window (one per beat) searches 120 ms
   around the last matched lag. Between windows the true lag moves at most
   about 90 ms (a resync's 60 ms threshold plus half a row). Among peaks
   within 0.05 of the best, the one nearest the tracked lag wins, so the
   drums' beat and half-beat aliases cannot pull it away.
3. **Re-verification**: tracking alone cannot see a jump of whole beats
   (a section landing a beat or a bar off mid-race, a resync landing off),
   because a window a beat or a bar off still correlates above 0.5 and the
   true lag is outside the search. Every 8 windows an 8-second window,
   searched 2 s either side, re-checks the lag, and tracking re-locks when a
   lag more than 60 ms away scores at least 0.7 and beats the best score
   within 60 ms of the tracked lag by at least 0.15. In a beat-periodic
   stretch (the hold's riser) the true lag and its beat aliases score
   within 0.05 of each other at any envelope resolution, so no re-lock
   happens there; a shift is caught once the music is distinctive again.
   Shifting a real capture by +-1 beat, 2 beats or a bar after 25 s or 60 s
   turns it RED (it was GREEN before this check).
4. **Absolute error** for each window is the simulation's wall time for
   that song position minus when the capture heard it, dated from the
   capture's own byte clock. A steady +11 ms is expected: the audible clock
   advances only when the device callback consumes a 1024-frame period
   (23.2 ms at 44.1 kHz), so it lags playback by half a period on average.

Each capture is then classified by cause:

- **Sounding music underruns since music started** (the game's own
  counter, which keeps closed streams' counts, so the title is included):
  product RED.
- A crash, a hang, a game stream that disappears, a failed reference render
  or a race that misses sections: product FAIL, never re-run.
- **Device dropouts**: exact digital silence where the aligned reference
  sounds, not starting 100-700 ms after a resync frame (when the resync is
  heard: a resync cuts every note, and a held part stays silent until its
  next note; those are reported as `resync_silences`). One over 50 ms, or more than 250 ms in total, means
  the capture did not play in real time: **SETUP-FAILED**, re-run. Shorter
  ones are reported only: a 256-frame PipeWire quantum (5.3 ms) of silence
  appears even for a plain `pacat` tone into the null sink on a loaded host.
- Otherwise the thresholds decide.

## Sabotage arms

Each must be RED and show its own defect's signature in `analysis.json`:

| arm | planted defect | signature |
|---|---|---|
| `depth` | the audible clock does not subtract the queued sink depth; resyncs are disabled in this arm only (they project with the real depth and would hide it) | median error between -350 and -150 ms (the simulation a ring ahead of the ear) |
| `immediate` | section jumps handed to the player at once instead of in bar N-1 | at least half the windows after lap1 off by a bar (1714 ms) less 100 ms or more, either way (measured: one bar, 1.5 and 2.5 bars, and a two-bar alias at -1681 ms) |
| `skew` | the nudge disabled and a 1% clock skew planted | the error falls at least 5 ms a second between resyncs (1% is 10) |

## Running a capture

- `CONDUCTOR_SINK=drift-null`: a **private null sink**. `worker-null` is
  shared by sessions, and another client playing into the capture sink
  would be mixed into the measurement. A capture refuses to start, or
  aborts, if any other client plays into its sink. The game's stream is
  recognized by process ancestry from the launched game, not by its
  executable (another copy of the same binary is foreign). Create it with
  `pactl load-module module-null-sink sink_name=drift-null` (no loopback;
  never make it the default) and unload it when done.
- Routing: the harness sets `PULSE_SINK` before the game starts, polls every
  10 ms until the game's stream appears and then every second, appends each
  observation to `routing.jsonl`, and kills the game at once if its stream
  is on any other sink. A corked stream reported with PA_INVALID_INDEX
  (4294967295) is not linked anywhere yet and plays nowhere: the harness
  waits up to 2 s for the link, then gives up (SETUP-FAILED).
- `CONDUCTOR_CPU_LIST=5,6 CONDUCTOR_NICE=0` lets the game run like a
  player's: the default (one CPU at nice 15) pins the audio callback thread
  to the main thread's CPU, and on a busy host the device output drops out.
  `CONDUCTOR_CPU_LIST=any` leaves placement to the scheduler.
- `CONDUCTOR_HEADLESS=1` runs the actual race without a window or drawing
  (simulation, pacing, music, engine and cues unchanged).
- `CONDUCTOR_GC_PROFILE=1` records each collection to `game-gc.jsonl`.
- `scheduling.jsonl` samples the game's main-thread CPU and run-queue wait
  once a second.

Each run writes `RESULT`, `analysis.json` (with `verdict`, `signature`,
`device_dropouts`, `music_underruns_in_race`), the captured and reference
PCM, the intended log, the game and capture logs, and routing and build
metadata.

## The native race check

`node scripts/drift/native-race.mjs RUNDIR` runs one full graphical
autopilot race on a private Xvfb with software GL and the game routed to
the capture sink. PASS needs every section, music throughout, zero
sounding music underruns and a clean Escape exit; it records where each
underrun increment happened.

## Web checks

These need a web build and a browser, not a capture:

```sh
sh scripts/drift/build-web-candidate RUNDIR      # bounded web build; PASS checks the bundle and stamp
P15_OUT=RUNDIR/p15 scripts/gate-p15 build/web     # interference never covers the road (GREEN/RED/SETUP-FAILED)
node scripts/fx-check.mjs build/web scripts/drift/effects-steps.json \
  --query "start&autopilot&mute&track=loop&laps=9" --gpu --out RUNDIR/fx
node scripts/fx-check.mjs build/web scripts/drift/web-race-steps.json \
  --query "start&autopilot&musiclog&track=loop" --gpu --out RUNDIR/web-race
```

`effects-steps.json` compares effects off with every effect held at peak and
fires all three triggers, recording isolation, renderer, probes and frame
intervals. `web-race-steps.json` needs COOP/COEP isolation, fresh probes
with engine and music on, the intended results landing and a finished race.
Both run muted headless Chrome (`--mute-audio`, `PULSE_SINK=worker-null`)
against a temporary loopback server; neither correlates audio. Public
hosting is never part of these checks.

## Other tools

`sh scripts/drift/build-candidate RUNDIR` builds a bounded native release
(one CPU, nice 15, 30-minute limit) and checks the offline reference
command and a muted headless race. `replay-capture.mjs` re-renders a saved
capture's reference; `focus.mjs` checks native focus loss; `benchmark.mjs`
measures offline render throughput. `analyze.test.mjs` and
`integration.test.mjs` test the analyzer on synthetic PCM, including a
count-in whose clean alias a bar away outscores the noisy true lag
(`ANALYZER=path` runs the fixtures against another analyzer).

`sh scripts/drift/test-candidate RUNDIR` runs the default project tests with
the native dependency harness the DSP checks need.
