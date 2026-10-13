# CORRUPT: the condensed alphabet with the cargo's integrity failing. The
# letters in pale static white, their channels split (cyan to the left,
# magenta to the right), torn sideways in a few bands, with runs of ICE
# amber, static and dropouts where the data broke. On the title the
# signal holds for a bar, then glitches hard on the downbeat and snaps
# back clean.
alphabet narrow
line SIGNAL OVERDRIVE
gap 4
space 12
margin 24 8 24 8
ramp 0 #FAFCFF 2 #F0F0F0 20 #F0F0F0 26 #DBE0E6 39 #DBE0E6
outline #0D0A1A
effect split dx=1 colours=#4DF2D9,#FF59D9
effect tear bands=13:6:5,30:2:-3 reach=8
effect blocks cells=55:24:10:2:#FF9F1A,203:6:6:3:none,286:33:9:2:#8A8FA0,137:36:5:1:#FF9F1A colours=#FF9F1A,#8A8FA0,none count=4
effect pulse rows=2
title-y 44
bpm 140
bars 2
