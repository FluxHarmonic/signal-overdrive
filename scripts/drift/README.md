# Conductor drift gate

The capture runs an actual native autopilot race on a private Xvfb and
the existing worker-null sink. It forces PulseAudio and verifies the
game's own stream routing. It never starts a host or plays on speakers.
Local processes use one allowed CPU and nice 15; each arm has a ten-minute
limit. Cached Xvfb and xdotool are required; the driver does not fetch them.

`node scripts/drift/focus.mjs RUNDIR` tests native focus loss separately,
muted. It copies the binary, opens a private Xvfb, unmaps/remaps only its
own window and checks frozen/resumed ticks from dated clock samples.
It has a one-minute limit and writes RESULT plus binary-hash metadata.
Set `CONDUCTOR_GDB=1` to run the same muted check under a cached GDB and
preserve a backtrace in `game.log`. A crash still fails the check.

`node scripts/drift/benchmark.mjs RUNDIR PLAN FRAMES` measures offline
rendering throughput with the same inserts and a two-minute limit. It
includes startup and PCM writes; it is a diagnostic, not live frame cost.

The analyzer correlates 3 kHz amplitude envelopes, with 1.5-second windows
at each beat across the full race. It dates each reference window from the
simulation's clock trace, requires at least 95% matching coverage and
judges absolute errors: p95 at most 30 ms and worst at most 60 ms.
The capture clock dates sample zero from its earliest byte-count bound;
reported errors include the capture's own startup/buffering latency.

The reference reads only the simulation's intended landing records. It
uses the same Motif pull/inserts path as the game and verifies every
landing at its exact intended bar. Player diagnostics are not reference
input. Raw reference PCM is stereo float32 at 48 kHz; capture PCM is
stereo s16 at 48 kHz. No Python is used.

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
