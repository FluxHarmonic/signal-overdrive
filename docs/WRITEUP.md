# Signal Overdrive: the feel prototype, an honest read

The question was whether this feels good enough to become a game. David is the one who can answer it; I never held a pad on it. Everything below comes from tests, measurements, headless runs, screenshots, and the autopilot driving the racing line. Where I'm guessing, I say so.

## The handling

What it is: an arcade model on a fixed 1/60 s tick, all in one pure module (`src/racer/handling.sgl`) with 33 tests (67 across the five test files). Every behaviour the brief named is sabotage-checked: break it in the code and a test goes red. 18 plants in all, across handling, the race and the sound; all red on the final code.

- The throttle eases into top speed (560 texels/s, about 504 km/h), and the cap is on total speed, so a slide counts against it.
- Steering ramps in over about 0.13 s and returns in about 0.08 s, so a key steers like a stick. It turns slower at top speed (62% of full rate).
- Grip pulls the slide out at 7/s. Drift cuts grip to 30% and turns 1.4× faster. A share of the slide's *energy* returns as forward speed, so a clean turn keeps most of its speed and no turn can add any.
- Walls bounce at 0.55, scrub speed along the wall, and cost integrity in proportion to the impact.
- Boosts cost 12 integrity and last 1.3 s; pads boost for free.

What I'd watch for when David drives it:

- **Is the drift worth using?** On the oval, nothing needs it: the bends' 740 radius is wider than the 361-texel turning circle at top speed. On the loop, the hairpin needs either braking or a drift (the drift circle is about 258). That's the right shape, but the drift has no reward beyond the turn itself. F-Zero's doesn't either; most newer racers pay you for it.
- **Walls are forgiving in speed and harsh in integrity.** A 300 texel/s impact costs 13.5 of 100. David scraped walls often on the first, narrower track, so I widened both tracks rather than soften the walls. `wall-damage` and `bounce` are the knobs to try first if it still feels punishing.
- **A stopped machine spins in place** at full steering rate (found by the review). Real racers fade steering out near zero speed. One line to change if it bothers him.
- **First-draft numbers.** The machine's size against the track (18 texels against 184 on the oval) and the camera (height 40, distance 92, pitch 0.16, FOV 1.15 widening with speed) are reasonable first values, not tuned ones. Every one is a knob, with the overlay's query string to send back.

## The art at this size

Machine bodies are 64 px wide on a 480x270 frame, about four times Crash's or Harkfell's sprites. What I learned:

- **Silhouette beats detail.** My first machine read as three pillars from behind: its long side pods' top faces rose up the sprite. A wide flat wedge read at once. Rivals got one model per colour (needle, brick, delta), and they stay distinct at 30 px; recoloured copies of one model didn't.
- **Rendering from a model is the right tool at this size.** A low-poly model rendered straight at sprite size, flat-shaded into palette ramps with the Bayer dither (`scripts/art/gen-machines.mjs`), gives 16 consistent directions, lean frames and thruster flicker from one description. It takes a second to re-run, so iterating on a shape is cheap. Hand-pixelling 48 rival frames per colour would not be.
- **Mode 7 at a quarter metre per texel is chunky up close,** about 4 px per texel just in front of you. That is the SNES look. Dithering every band edge against the Bayer threshold keeps curves from stair-stepping without leaving the palette. Thin features vanish in the distance, because a far pixel covers several texels and averages them away. Anything that must read at the horizon (the barriers) has to be wide.
- **The dither pass itself was the heaviest work in the frame:** 51 palette comparisons per pixel. A lookup texture made it one fetch, at an approximation cost of about 2.8% of pixels differing from the exact pass, all between near-identical colours. The exact pass stays behind `lut=0`.
- **Weakest pieces:**
  - The far skyline layer is barely distinct from the sky.
  - The off-track floor reads as void near the horizon.
  - The sparks are small.
  - The tile atlases are big: 1,383 and 2,655 unique 32x32 tiles, because every edge tile is unique.

  A real build wants track pieces authored as reusable tiles, or a curve-aware edge set, not every texel painted from the spline.

## The touch controls

All three schemes work in a headless phone viewport (844x390, touch emulation): 14 assertions, each judged by what the game's machine did, and a sabotage arm that swaps left and right and goes red.

- **zones** (thumbs left and right; both brake; a BOOST button) is digital: full lock or nothing. With the steering ramp that's tolerable. I expect it to feel coarse on the loop's long bends.
- **drag** (one finger steers by how far it has slid) is the only analogue scheme that needs a single thumb. My guess for the best: it's the one I'd try first on a phone.
- **stick** (a floating stick on the left, the right thumb boosts and drifts) is analogue too. Every right-thumb landing also boosts, so drifting costs a boost; that's probably wrong.

What I couldn't judge without a real phone: thumb comfort, whether 60 px of drag is the right full lock, where the BOOST button should sit in landscape, iOS Safari's multi-touch and gesture quirks, the frame rate on a phone GPU, and how much latency the touch path adds.

## The sound, and why it hitched

David heard hitching in pass 3. Measured headless (`scripts/audio-check.mjs`, Chrome on SwiftShader, sound on but muted), 15 s of the race:

| | underrun frames at 1x | at 4x CPU throttle |
|---|---|---|
| pass 3: 60 ms queue, one-shots in the stream, not isolated (`worklet-msg`) | 77,531 to 109,889 | 332,057 to 463,363 |
| 250 ms queue, one-shots as cues, not isolated | 0 | 7,907 to 150,184 |
| 250 ms queue, cues, isolated (`worklet-sab`) | 0 | 0 to 11,558 |

The ranges are across runs on a busy machine (load 13 to 19). At 48 kHz, 100,000 frames is about 2 s of silence in 15.

The cause was the queue: the synth renders on the main thread, and 60 ms of queued sound ran out in any frame longer than that. Under SwiftShader, frames ran 33 to 100 ms, with stalls up to 1.8 s.

The fix has three parts:
- The engine stream keeps 250 ms (`?audiodepth=` to try others).
- The one-shots are cues, mixed in the AudioWorklet (web) or the device callback (native), so they're immediate however deep the stream is.
- The host sends COOP/COEP, so the page is cross-origin isolated and the bridge runs its stream with shared memory (`worklet-sab`).

The synth also got cheaper, from 13.1 to 3.6 ms a frame in the bytecode build: its state now lives in loop variables, not a vector read and written every sample. In the web build it costs about 5 µs a sample, about 1.8 ms a frame at 60 fps.

Collections are not the cause: in the web build's hitch log, 148 of 155 hitches had none. The 7 that had one spent about 18 ms each in it, which a 250 ms queue rides out.

**The longer-term option: render off the main thread.** The engine could run inside the AudioWorklet itself (web) or the device callback (native). Then no main-thread stall could ever starve it, and the queue could be short again, which matters for music that reacts to play.
- The cost on the web is the synth in JavaScript or a second small wasm module in the worklet, with its parameters (speed, throttle, boost) posted from the game. That's a few hundred lines and a second build target, and the synth would no longer share code with the game's Sigil.
- Natively it means a callback into Sigil from the audio thread, which Sigil's runtime does not offer today.
- Phantom Burn's reactive music has the same shape. Doing this once, in sigil-wasm-audio as a "parameter-driven generator" node, would serve both games.

## What I'd change before a real build

1. **Measure the frame rate on David's machines first.** "Turning snaps to angles" measured as the frame rate: headless Chrome ran 8.8 fps, and each frame ran several ticks. It's 17 to 20 fps there now and 87 natively on llvmpipe. On a real GPU it should be far higher, but F3 is there to confirm, on the desktop and on the phone.
2. **Ask Substratic to allow sigil-graphics 0.14.** Its `<0.14` cap holds this at 0.13's 1 KiB uniform blocks. Nothing here hit that limit, but a richer post pass will.
3. **Lift `(racer mode7 camera)` and `(racer mode7 render)` into substratic-mode7** when a second game wants them. They already know nothing about racing.
4. **A track format,** so a track isn't control points in a JS file, and reusable edge tiles to keep the atlas small.
5. **Per-machine stats** (the brick heavier in bumps, the needle faster on straights) and mass in collisions; rivals with more personality than "follow the line and block".
6. **A ghost that persists** across sessions and is shareable. Today it's positions in memory, which is right while rivals can bump you.
7. **Real sound.** The synthesized engine is a placeholder that proves the shape: pitch with speed, a whoosh, a scrape. Rival engines with distance, music through motif, and the UI sounds would come next.
8. **The touch defaults,** chosen on a real phone: probably drag, with boost on a dedicated button and drift on its own gesture.
9. **The integrity hook.** It reads now: the meter drains in white, pop-ups say why, walls tear the screen, and corrupt cargo glitches and reddens. Whether "your cargo is your energy" is the game's core is the bigger question, and it wants more ways to spend and protect it: ICE that targets the cargo, routes that trade repair for risk.
