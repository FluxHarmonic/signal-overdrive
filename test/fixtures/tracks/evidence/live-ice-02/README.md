# Live ICE 0.2 evidence

`receipt.json` records actual Phantom results for production source
`f8c3bdb0eae00f518e3d6675129ac73662c46de9`, based on integration `fa18678`.
It is historical evidence for those exact inputs, not an evergreen fixture
or a substitute for running gates after a source change.

The receipt contains all four registered tracks' final geometry gates,
including physical bend-entry coordinates and TRUE-radius witnesses, plus
nine actual three-lap/coda runs: Breakwater, Quayside and Basin at LEARNER,
COURIER and ELITE. Every individual driving and canonical process exited0.
Canonical acceptance uses the game's Sigil scheduler/placement modules;
each actual crossing history also exercises every shared tier profile and
all enumerated seed/layout/tracer targets. Minimum combined corridors are
52.8,54 and33.6texels respectively, above the27-texel requirement.

`sourceSHA256` records the files actually executed. `sourceVerification`
checks them against an archive of the exact production git commit.
Executable source matches byte for byte. The two track JSON files listed
under `jsonFormattingOnly` differ only in preserved control-array
whitespace; recursive JSON values match exactly. Both digests are retained.
The first strict byte check returned RED before this distinction was
explicitly verified; no input mismatch was ignored or overwritten.

Generate the receipt on Phantom with `scripts/track/receipt.mjs`, passing
the exact commit, completed driving directory, completed canonical gate
directory, current geometry report, output path and archived source root.
The collector rejects failed/incomplete processes, mismatched crossings,
worlds or tiers, missing coda/PAR proof and executable/track-value drift.
Original job provenance is retained in the JSON. The task Session Log
`tasks/signal-02-track-tooling` contains the initial REDs and corrections.

Native evidence is separate: cp40 proved queued music mute and visible
curved meshes for every hazard kind; cp54 captured eight fresh full-game
frames with real shell/scheduler/assets, normal camera, HUD and named pair.
The scene's swarm scheduled-state may be offscreen; its visible geometry
is established by cp40. Fast simulated ticks select scene frames and do
not measure rendering performance or audio pacing.

cp53 built the corrected native bundle and passed a private graphical
smoke; cp55 also smoked an isolated copy without source-tree asset fallback.
The private review archive's SHA256 is
`4cc190766d0d43f757d31209dbe73918eb42182ff43b01d064d0967620dbdec2`;
its executable's SHA256 is
`61f42f406633c5b2174bf422fe40d7a8f9a6e51c486cf1f26e24014bb02f0d21`.
Web compilation was still running when this receipt was collected; this
receipt makes no web-build or total-release acceptance claim.

Limitations remain explicit: the actual Quayside/Basin seed0 AI paths
admit no tracer, and Basin ELITE seed0 admits no Void wake. Safety admission
is never bypassed to produce hazard coverage. Future terrain or crests
require an additional line-of-sight occlusion gate. The retired prototype
loop's older RED evidence remains in its original historical directory.
