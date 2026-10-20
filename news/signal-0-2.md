---
title: Signal Overdrive 0.2
date: 2026-10-20
version: 0.2.0
summary: The Docklands are open: three new tracks, three new songs, a full cup to win on three tiers, live ICE, and rain on the harbor.
---

Signal Overdrive 0.2 is out, and it's the first version that feels like a whole game! There's a district to race through, a cup to win, rivals who are out to get you, and a reason to come back and do it all again on a harder tier.

If you haven't played yet: Signal Overdrive is a Mode 7 racer set in the world of [Crash The Stack](https://crashthestack.com/). You're Zero, a data courier carrying songs through a city where Gibson owns every wire. Your cargo's integrity is your energy meter, and the song you're carrying is what the whole city hears when you reach the uplink.

## The Docklands Cup

The first district of the city is the Docklands, and its cup is three deliveries in a row:

- **Breakwater**, along the seawall, with *Slipstream*: the brightest version of the Carrier theme, with two leads chasing each other a third apart over motorik drums.
- **Quayside**, with *Undertow*: a glassy lead whose reflection answers it a beat later, an octave down, over breakbeats and a swaying bass.
- **Turning Basin**, with *Night Shift*: the fullest statement of the theme, with an overdriven lead that bends up like a guitar, four on the floor, and a galloping bass.

All three songs are variations on *Carrier*, the race song from 0.1, so the district has one musical identity with three moods. Each one is still synthesized live while you play by [Motif](https://codeberg.org/sigil/motif).

You score points for your place (10, 7, 5, 3, 2, 1) plus a broadcast bonus for how clean your cargo is at the line: +3 for a CLEAN broadcast (80% integrity or more) and +1 for NOISY. Lose all your integrity and the delivery is corrupt, which scores nothing. Finish the cup in the top three and you reach the uplink. Then Gibson has a word for you, and he's never impressed.

## Three tiers

You pick a tier before each cup:

- **LEARNER** has slower rivals, lighter ICE, softer hits, and as many retransmits (restarts) as you need.
- **COURIER** is the city as designed, with three retransmits a cup.
- **ELITE** has rivals faster than you'd like, full ICE from the first delivery, and no retransmits. A corrupt delivery ends the cup.

COURIER opens when you clear the cup on LEARNER, and ELITE opens when you clear it on COURIER. Your progress and best times are saved in your browser.

## ICE comes alive

In 0.1, ICE was static on the road. Now Gibson's defenses fight back, and they move to the music. Firewalls rise and fall on the song's bars and swap sides of the road every phrase. The road glows amber before a firewall goes up, so if you listen to the song, you'll know what's coming. On Breakwater, the seawall has drones too, and from lap 3 Gibson starts throwing tracers: targeted strikes locked to your lane, announced on the downbeat.

There's always a free lane, and ICE is never placed on a corner. Hitting it doesn't stop you dead: it costs you integrity and scrambles your steering for a moment, and the song drops out for an instant so you *feel* it.

## Null and Void

On Turning Basin, the last delivery of the cup, Gibson sends his own couriers. Null works on you: it camps the checksum lane and blocks your line, and the flare on its machine tells you which way it's about to swerve. Void works on the road: it lays down a strip of dead air behind it that drains your integrity and mutes the song while you're in it. They take turns attacking every eight bars, so you're never fighting both at once.

## Time trial

If you'd rather just drive, TIME TRIAL gives you any open track with no rivals and no ICE. Your best lap races you as a see-through ghost, and R retries instantly. Your best race and lap times are saved for every track and tier.

## Rain on the harbor

The Docklands has its own look: harbor blues and fog, water that mirrors the skyline, and neon light that streaks across the wet ground toward you. It rains, too, and the rain swells into a downpour in the second half of lap 2, right where the song builds. The rain never covers the road ahead, so you can always see your racing line.

If your system asks for reduced motion, the rain and the rippling water go away, but the wet reflections stay.

## Install it

You can now install Signal Overdrive as an app from [signaloverdrive.net/drive](https://signaloverdrive.net/drive/) and play it offline. When a new version is out, it downloads in the background and an INSTALL UPDATE item shows up in the main menu. It never updates itself in the middle of your session, and your progress is kept.

## A few changes from 0.1

- The menus work with the keyboard, a gamepad, or a tap. Enter or A selects, and Esc or B goes back.
- Esc, Backspace or the pad's Start button pauses the race, and there's a pause button on screen. Restarting a cup race now lives in the pause menu, and it costs a retransmit.
- R retries instantly in TIME TRIAL, and does nothing in a cup race.
- Ghosts are now part of TIME TRIAL rather than every race.
- The race now waits for your audio to start, so the song always kicks in right on GO.

Play it now at [signaloverdrive.net/drive](https://signaloverdrive.net/drive/). It's free, and the source is on [GitHub](https://github.com/FluxHarmonic/signal-overdrive).

## What's next

Next up is Neon Row, the second district, with its own tracks and songs. I'm also working on a daily route, ghosts you can share as a link, and a better introduction for new couriers, so you'll know who's talking to you over the wire before Gibson does.

Drive safe!
