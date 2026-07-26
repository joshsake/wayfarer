# demos

Rendered outputs from `scripts/atmos_demo.py`. Everything here is
regeneratable — commit these wavs only so a reviewer can play them without
setting up Python.

## Files

- `seat-sweet-spot.wav` — same synthetic 5.1.4 + LFE + overhead-object scene,
  rendered at the middle-of-the-hall seat.
- `seat-back-corner.wav` — same scene, rendered at a rear-right seat close to
  two walls and to the SR speaker.
- `reference-dry-sum.wav` — the raw stem sum, no room, no distance
  attenuation. Not a "correct" mix — just a baseline that isolates what the
  room simulator is adding vs. what the source material already sounds like.

Cross-seat outputs share a single peak-normalisation factor, so relative
loudness between them is preserved. The dry reference is normalised on its own.

## What to listen for

- **Level & timbre difference between seats.** The back-corner render is
  louder overall (corner-loaded, close to the SR speaker) and has a heavier
  room signature — shorter direct-to-reverb ratio.
- **LFE thump at ~2.0 s.** The 40 Hz kick arrives sooner at the sweet-spot
  seat (LFE is in the front corner, roughly equidistant) and later at the
  back-corner seat. Whether it "hits" is where headphones win — a single-mic
  capture can't reproduce chest-cavity coupling.
- **Overhead object.** The helicopter is at ceiling-centre; from the sweet
  spot it's roughly symmetric, from the back corner it's off-axis and
  arrives via a different reflection pattern.

## Limitations of this demo

- Renders are **mono per seat** — a single microphone capture, not binaural.
  That means the "spatial" part of the experience is absent by construction.
  Adding HRTFs to produce a stereo per-ear render is the next step and is
  what would make the A/B start to sound like the theatre-vs-headphones gap.
- Sources are **static**. A real Atmos object moves; a moving-source
  renderer would compute the IR block-by-block along the trajectory.
- Room model is uniform-absorption shoebox — no frequency-dependent
  materials, no seating rows, no scattering.
