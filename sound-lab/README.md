# sound-lab

Offline prototype for two ideas:

1. **Room/playback simulator** — take positioned audio stems (bed + objects),
   convolve each with a per-source room impulse response, and produce the
   audio a listener would hear at a given seat.
2. **Playback corrector** (later) — compare the at-seat result to a headphone
   reference and derive a correction filter that puts back what the room ate:
   sub-bass rolloff, transient smearing, near-field intimacy.

The v0 in this directory is only step 1, plus the room-IR generator it needs.
Everything is offline (files in, files out) so the DSP stays pure and
unit-testable without ears.

## Layout

```
src/soundlab/
  room.py      shoebox room IR via image-source method
  render.py    positioned stems × IRs → at-seat audio (pure)
  io.py        wav read/write
  cli.py       thin I/O wrapper over the pure core
tests/         pytest specs — no audio hardware required
```

## Design notes

- **Sources have 3D positions, no virtual speaker array yet.** An Atmos-style
  renderer would map objects → speaker feeds → room. We skip the middle
  step: each stem is treated as a point source at a 3D position, and the room
  IR goes source→listener directly. Adding a speaker-array intermediate is a
  later step once the room model is trusted.
- **I/O at the edges.** `render.render_at_seat()` and `room.shoebox_ir()`
  take arrays and return arrays — no file paths, no side effects. The CLI is
  the only place that touches disk.
- **Synthetic IRs first, measured IRs later.** Image-source is fast and
  parameterised (room dims, absorption). Measured IRs from real rooms plug
  into the same convolution path with no code changes.

## Demo

```bash
pip install -e '.[dev]'
python scripts/atmos_demo.py --out-dir demos
```

Produces `demos/seat-sweet-spot.wav` and `demos/seat-back-corner.wav` —
the same synthetic 5.1.4 + LFE + overhead-object scene rendered at two
seats in a 12×8×4 m room, plus a dry stem-sum reference. See
`demos/README.md` for what to listen for and the known limitations
(mono-per-seat, static sources).

## Usage

```bash
pip install -e '.[dev]'
pytest
python -m soundlab.cli render \
    --stem front-left:stems/fl.wav:1.5,0.5,1.6 \
    --stem front-right:stems/fr.wav:-1.5,0.5,1.6 \
    --room 6,4,3 \
    --seat 0,3,1.2 \
    --absorption 0.3 \
    --out at-seat.wav
```

Each `--stem` is `label:path:x,y,z` where `x,y,z` is the source position in
metres. `--room` and `--seat` are also metres.
