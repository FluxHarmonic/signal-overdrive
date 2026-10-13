# Conductor drift gate

**Known RED (Leader 14:58, 2026-10-13).** This is a separate opt-in
diagnostic target; it is not part of default source tests or effects gates.
Its thresholds and nonzero exit on a failed normal capture remain intact.
The conductor is being prepared for integration with this failure recorded;
a fresh worker takes the drift investigation. No captured sabotage PASS
has been established.

`sh scripts/drift/test-candidate RUNDIR` runs the default project Sigil
tests through the pinned CLI's linked native-dependency harness, with
one CPU/nice 15, 4 GiB and a 30-minute build/test bound. This is required
for the DSP/ring checks; plain source evaluation has no `dsp-init` binding.
It writes RESULT and the test log/report, with null audio and no display.
The CLI's default dev/bytecode configuration retains linked native C
bindings while avoiding native compilation of the runner/build tool DSL.

| Actual normal capture | p95 | Worst | Matching coverage | Sounding underruns | Resyncs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Checkpoint 33, best worst-error result with zero underruns | 55.86 ms | 83.83 ms | 62.45% | 0 | 14 |
| Checkpoint 37, latest integrated effects runtime | 49.01 ms | 111.40 ms | 59.43% | 0 | 18 |

Evidence is in `build/conductor-checkpoint33-scheduling/` and
`build/conductor-checkpoint37-effects-normal/`: raw PCM, intended simulation
log, byte clocks, routing metadata, collection/scheduling samples and verdicts.
Latest live music-frame cost is p50 4.2 ms, p95 10.6 ms, worst 126.4 ms;
the 2 ms target is not met. The 250 ms default ring completed the latest
native headless full race without sounding underruns. A short ring under
4x throttle has not been established and is not shipped.

The capture runs an actual native autopilot race on a private Xvfb and
the existing worker-null sink. It forces PulseAudio and verifies the
game's own stream routing. It never starts a host or plays on speakers.
Local processes default to one allowed CPU and nice 15; each arm has a ten-minute
limit. Cached Xvfb and xdotool are required; the driver does not fetch them.
`CONDUCTOR_CPU_LIST=0,1` can select at most two allowed CPUs, and
`CONDUCTOR_GL_THREADS=2` can select two llvmpipe threads for a bounded
software-rendering capture. Both settings are recorded in run metadata.
`CONDUCTOR_HEADLESS=1` selects the actual native race without a window or
drawing. It shares simulation, input cleanup, audible pacing, music,
engine and cues with the graphical shell; intervals come from the real
monotonic clock. This isolates drawing contention and is recorded in
metadata. Keep graphical capture evidence when comparing the two modes.
`CONDUCTOR_GC_PROFILE=1` records the pinned runtime's collection events in
separate game/reference JSONL files to diagnose long live-frame pauses.
`scheduling.jsonl` samples only the owned game's kernel main-thread CPU
and run-queue wait counters once per second. The final analysis reports
their elapsed totals separately; collector event durations include both
execution and scheduling delay. This sampling changes no runtime policy.
`node scripts/drift/replay-capture.mjs SOURCE NEW_RUNDIR` re-renders only
the intended-log reference for saved real PCM at its logged device rate.
It requires a fresh directory, copies the capture/clock/log unchanged,
records the original metadata and reference binary hash, and has a
two-minute limit. It never opens audio or a window or edits SOURCE.

`node scripts/drift/focus.mjs RUNDIR` tests native focus loss separately,
muted. It copies the binary, opens a private Xvfb, unmaps/remaps only its
own window and checks frozen/resumed ticks from dated clock samples.
It has a one-minute limit and writes RESULT plus binary-hash metadata.
Set `CONDUCTOR_GDB=1` to run the same muted check under a cached GDB and
preserve a backtrace in `game.log`. A crash still fails the check.

`node scripts/drift/benchmark.mjs RUNDIR PLAN FRAMES` measures offline
rendering throughput with the same inserts and a two-minute limit. It
includes startup and PCM writes; it is a diagnostic, not live frame cost.
`CONDUCTOR_TIME=/cached/path/to/GNU/time` additionally records child user
and system CPU time, separating rendering work from scheduler delays.

The analyzer correlates 3 kHz amplitude envelopes, with 1.5-second windows
at each beat across the full race. It dates each reference window from the
simulation's clock trace, requires at least 95% matching coverage and
judges absolute errors: p95 at most 30 ms and worst at most 60 ms.
After a wide acquisition, it follows the previous correlated lag within
250 ms, as INTERCEPT does, to avoid aliases from repeated beats. Absolute
errors are still measured against the simulation clock, including offsets.
The capture clock dates sample zero from its earliest byte-count bound;
reported errors include the capture's own startup/buffering latency.

The reference reads only the simulation's intended landing records. It
uses the same Motif pull/inserts path as the game and verifies every
landing at its exact intended bar. Player diagnostics are not reference
input. Raw reference PCM is stereo float32 at the actual native device
rate reported in the trace (44.1 kHz for the pinned backend), recorded in
metadata. Capture PCM is stereo s16 at 48 kHz. The analyzer constructs
3 kHz envelopes at each file's own rate; voices/noise/filters now use the
same source clock as the game. No Python is used.

Prepared tools and tests:

```sh
nice -n 15 node scripts/drift/analyze.test.mjs
nice -n 15 node scripts/drift/integration.test.mjs
```

`reference.test.sgl` validates the intended-log contract and replayed
positions (`scripts/test-reference`). The implementation is the shared
`src/signal/music/reference.sgl` module. The native command exits before
shell boot and checks that audio stays uninitialized. Do not claim an
actual-game gate from the synthetic checks.

`scripts/drift/build-candidate RUNDIR` builds a bounded native release and
checks the offline command against a 7.5-second grid→lap1 render. The
build has a 30-minute timeout and the smoke check a two-minute timeout.
Poll RUNDIR/RESULT; it also records the source commit and logs.
`scripts/drift/build-candidate RUNDIR smoke` checks an existing release
without rebuilding it.

After integrating effects, `sh scripts/drift/build-web-candidate RUNDIR`
builds the web target with the same local CPU/nice/memory/time bounds.
Its PASS confirms the bundle and source stamp; browser gates are separate.
Run the existing `scripts/gate-p15 build/web` under the same local bounds
and preserve its captures/log. `effects-steps.json` drives the existing
`scripts/fx-check.mjs` against `start&autopilot&mute&track=loop&laps=9`:
it compares effects off with all effects held at peak, records isolation,
renderer, probe and frame intervals, and exercises all three fires.
These checks use temporary loopback servers only. Public hosting still
requires the task's HARD STOP approval. A busy-host FPS result alone
does not establish the effects' P32 budget or the audio drift gate.

For the separate full web race/music check, use `web-race-steps.json`
with the same effects harness, `--gpu`, and query
`start&autopilot&musiclog&track=loop`. It requires isolation, fresh
probes with engine and music on, the intended results landing, and a
finished race. It uses muted headless Chrome on worker-null and a
temporary loopback server; no PCM correlation or drift verdict runs.

After that candidate passes, run one arm at a time from the repository root:

```sh
node scripts/drift/capture.mjs /tmp/conductor-normal normal
node scripts/drift/capture.mjs /tmp/conductor-depth depth
node scripts/drift/capture.mjs /tmp/conductor-immediate immediate
node scripts/drift/capture.mjs /tmp/conductor-skew skew
```

Each run writes `RESULT`, `analysis.json`, captured/reference PCM, the
intended log, game/capture logs and routing/build metadata. Normal must
be GREEN; every sabotage arm must be RED. Capture setup failures count
as neither. The tools need local Pulse/Guix access; use the task's bounded
helper/escalation policy. Commit durable tooling and preserve measured
results outside temporary storage when the gate is complete.
