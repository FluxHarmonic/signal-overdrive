---
title: Signal Overdrive 0.1
date: 2026-10-17
version: 0.1.0
summary: The first build of Signal Overdrive is here: a Mode 7 racer where your cargo is a song, free to play in your browser.
---

Signal Overdrive is here! This is the first build you can play: one track and one song, wired through the whole race.

Signal Overdrive is a Mode 7 racer in the spirit of F-Zero, set in the world of [Crash The Stack](https://crashthestack.com/). You're Zero, a data courier. Gibson owns every wire in the city, so the collective hides its messages inside songs, and couriers like you carry them by hand to pirate uplinks, where they go out over the air and can't be taken back.

Your cargo is the song, and its integrity is your energy meter. Boosting spends it, scraping a wall costs it, and the checksum lane wins it back. If it hits zero, the cargo is corrupt and the run is over. Deliver it clean and the whole city hears your song!

## The race follows the song

Every race is three laps against five rivals: Vex, Null, Kestrel, Spool and Halcyon. They follow the racing line, bump you and move across to block you, so you'll have to work for every place.

The laps follow the song's shape. Lap 1 is the verse, and your boost comes online with the chorus on lap 2. The final lap is the drop, and that's when Gibson finally traces you: TRACED flashes over the skyline and his tower turns violet. The song's melody is missing its last note the whole way round, and you only hear it whole when you cross the uplink. You never have to time anything to the music, though. You just drive.

## The music

The race song is *Carrier*: darksynth at 140 BPM, with a gritty FM bass that never stops moving and a hollow lead calling out over it. The title screen plays the main theme, *Redline*, and a quieter version of it plays while the game is paused.

The song also takes damage when your cargo does. As your integrity drops, the lead drifts out of tune and starts losing notes, the drums crush down, and static creeps in. The bass holds on longest, so there's always a pulse. Hit a wall hard and the song dips; drive over ICE and it cuts out for a moment. Get into the checksum lane and it snaps back clean, right on the beat.

All of it is synthesized live while you play, by [Motif](https://codeberg.org/sigil/motif), the music engine I'm building in Sigil.

## How to play

| | Keyboard | Gamepad |
|---|---|---|
| Steer | Left/Right or A/D | Left stick or d-pad |
| Accelerate | Up or W | A or right trigger |
| Brake | Down or S | B or left trigger |
| Boost (from lap 2) | Space | X |
| Drift (hold) | Shift or C | LB or RB |
| Restart | R | Back |

A few things worth knowing before your first race:

- **The checksum lane** is the repair strip on the track. Drive through it and your integrity refills.
- **Boost pads** give you a burst for free, so you don't have to spend integrity to go fast.
- **ICE patches** are the orange and red static on the road. Cross one and your steering flips for a second or so.
- **Drift** through the tight corners: hold the drift button and the machine slides instead of gripping.

From your second lap on, your best lap races alongside you as a ghost, and the game remembers your best lap time.

**On a phone,** the machine accelerates by itself, and you can pick one of three touch schemes with the button at the top left: zones (the default), drag, or a floating stick.

If your system asks for reduced motion, the game respects it: every effect keeps its meaning in color and in the HUD, but nothing tears, ripples or flickers.

You can play it right now at [signaloverdrive.net/drive](https://signaloverdrive.net/drive/). It's free, and the source is on [GitHub](https://github.com/FluxHarmonic/signal-overdrive) if you'd like to see how it's made.

## What's next

Next, I'm building out the first district of the city: three tracks, each with its own variation on the district's theme, plus ghosts you can share as a link and a daily route. I also want the city's lights to follow the song's beat more closely. Further out, I want to bring racing between browsers to Signal Overdrive, so you can race your friends!

Drive safe!
