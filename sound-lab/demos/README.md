# demos

Rendered outputs from `scripts/atmos_demo.py`. Everything here is
regeneratable — commit these wavs only so a reviewer can play them without
setting up Python.

## Files

Mono (single-microphone capture at the seat):

- `seat-sweet-spot.wav` — synthetic 5.1.4 + LFE + overhead-object scene at
  the middle-of-hall seat.
- `seat-back-corner.wav` — same scene at a rear-right seat close to two walls.

Binaural (per-ear stereo, spherical-head model):

- `seat-sweet-spot-binaural.wav`
- `seat-back-corner-binaural.wav`

Reference:

- `reference-dry-sum.wav` — the raw stem sum. No room, no distance. Not a
  "correct" mix; just a baseline to isolate what the room simulator is
  adding vs. what the source material already sounds like.

Cross-seat outputs share a normalisation factor **within their format**
(mono files scale together, binaural files scale together), so seat-to-seat
level comparison is honest inside each format. Mono vs. binaural aren't
level-matched to each other — different peak statistics.

## What to listen for

Play the binaural files on **headphones**. Speakers destroy the per-ear
cues instantly.

- **Panning.** The dialogue channel is directly in front (should sit
  centred). Bed-FL/FR should spread wide. LFE is in the front-left corner
  and should feel slightly to the left. The helicopter is overhead — with
  a spherical head model it stays centred (no pinna cues for elevation),
  which is one of the limitations noted below.
- **Level & timbre between seats.** The back-corner mono render is
  ~2 dB louder than the sweet-spot one (SR speaker proximity + corner
  loading in the shoebox model) with a heavier reverb tail.
- **LFE thump at ~2.0 s.** The 40 Hz kick arrives sooner at the sweet-spot
  seat and slightly later at the back-corner seat. Whether it "hits" is
  where headphones win — a captured mono/binaural signal can't reproduce
  chest-cavity coupling.

## Limitations of the current model

- **Spherical head only.** Two cues are modelled — ITD (interaural time
  difference, via Woodworth) and IID (interaural intensity, as a broadband
  head-shadow gain). Missing: pinna filtering, which is what disambiguates
  elevation and front/back. Sources directly overhead and directly behind
  will sound the same as sources in front. Real measured HRTFs (SOFA
  format) plug into the same `HeadModel` interface later.
- **Static sources.** A real Atmos object moves. Motion needs block-wise
  IR switching with crossfades.
- **Uniform-absorption shoebox.** No frequency-dependent materials, no
  seating rows, no scattering.
