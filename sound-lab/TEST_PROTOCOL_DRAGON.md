# Test protocol — Nakamichi Dragon soundbar

A step-by-step for validating the sound-lab prototype against a real
Nakamichi Dragon 11.4.6 Atmos system in your own room. Run it end-to-end
in a single session — measurements taken at different times drift because
temperature, humidity, and where furniture sits all change the room's
response.

Reserve **~2 hours** for a first pass. Subsequent runs get faster once
you've done it once.

---

## 0. What you'll learn

Three questions, in order:

1. **How close is the synthetic shoebox model to your actual room?**
   Compare our simulator's predicted IR against a measured IR at the
   same seat. RT60, direct-to-reverb ratio, spectral tilt.
2. **Does the corrector help vs. no correction?**
   Derive a per-ear FIR from measurement, apply offline, remeasure at
   the same seat, compare spectra.
3. **Does the corrector help vs. Dragon SSE?**
   Same measurement with Dragon's built-in Spatial Surround Equalisation
   on, off, and with our FIR on top. Is our correction doing anything
   the Dragon isn't already doing?

Any one of the three answers "no" is still useful data.

---

## 1. Prerequisites

**Hardware** (see [HARDWARE.md](HARDWARE.md) for context):
- Nakamichi Dragon soundbar, calibrated to its usual home position
- miniDSP UMIK-1 or UMIK-2 with its individual calibration file (.txt)
- Mic stand, adjustable to seated ear height (~1.1–1.2 m)
- Laptop that can output audio and record via USB
- HDMI or optical cable from laptop → Dragon eARC input
- Tape measure

**Software**:
- Room EQ Wizard (free, download from roomeqwizard.com)
- Nakamichi Dragon companion app (to toggle SSE, dial settings)
- This repo checked out, `pip install -e '.[dev]'` in `sound-lab/`

**Access**:
- 30 min uninterrupted quiet time — no HVAC starting mid-sweep, no one
  walking through the room

---

## 2. Setup checklist (do NOT skip)

- [ ] **Load the UMIK-1 calibration file in REW.** File → Preferences →
      Mic/Meter → Cal File. Without this, every measurement is off by
      whatever ± dB curve the specific mic has.
- [ ] **Set the whole chain to 48 kHz / 24-bit.** REW output, macOS/Windows
      audio prefs, Dragon input if it exposes it. Sample-rate mismatches
      silently resample, which smears the IR.
- [ ] **Route laptop audio into the Dragon**, not into internal speakers.
      Verify by playing anything and hearing it come from the soundbar.
- [ ] **Set Dragon input mode to a stereo-passthrough / "Direct" mode**
      that doesn't upmix. Sweeps are stereo tones; Atmos upmixing
      would spread them across height channels and pollute the IR.
- [ ] **Turn OFF Dragon SSE / auto-calibration / room correction / EQ.**
      For baseline runs you want raw room response. Note down which
      settings you disabled — the app screenshots are your record.
- [ ] **Measure the room.** Length × width × height in metres. Write them
      down. You'll punch them into the shoebox model later.
- [ ] **Note the Dragon's position** (distance from front wall,
      centre-line offset, height off the floor).

---

## 3. Seat plan

Pick **three** listening positions before you start. Standard choices:

| Label         | Rough position                                                     |
| ------------- | ------------------------------------------------------------------ |
| `sweet-spot`  | Centred left-right, at the Dragon's design listening distance      |
| `off-axis`    | Same distance, but ~1 m to one side (worst-case for phantom centre) |
| `back-couch`  | Farthest seat you'd actually use — measures room-dominated response |

Mark each position with tape on the floor. Ear height matters more than
you'd guess — put the mic where your ears actually are, not where you
think they should be.

---

## 4. Baseline sweep (Dragon SSE OFF)

Per seat, in REW:

1. Measure → Method: sweep, length 512K (~10 s at 48 kHz) or longer for
   better SNR
2. Output: stereo (Left + Right) — captures the full soundbar output
   summed at the mic. If you also want per-channel IRs, drive individual
   channels using test tones from the Dragon app or a Dolby test disc.
3. Level: -12 dBFS peak sweep, adjust Dragon volume so peak SPL at the
   mic is around 80–85 dB. Louder is not better — you want a clean
   capture, not an ear-splitting one.
4. Save as `dragon-off-<seat>.mdat` in REW; export the impulse response
   as `dragon-off-<seat>.wav` (mono, 48 kHz, float).

Repeat for each of the three seats. **Do not touch the Dragon settings
between seats** — move the mic, not the system.

**Sanity checks after each measurement**:
- IR peak should be within the first ~40 ms of the file
- RT60 (T20 or T30 in REW's decay graph) should be somewhere between
  0.2 s (dead room) and 1.5 s (very live) for a typical living room
- Waterfall plot should not show a huge notch or peak that dominates
  everything — that would indicate a bad mic position or a broken
  measurement

---

## 5. Compare to the synthetic model

Now open a shell in `sound-lab/`:

```python
import numpy as np
from soundlab.io import read_mono_wav
from soundlab.room import Room, shoebox_ir

FS = 48_000

# Load a measured IR
measured, fs = read_mono_wav("dragon-off-sweet-spot.wav")
assert fs == FS

# Model the same room and seat
room = Room(dims=(5.5, 4.0, 2.6), absorption=0.20, max_order=8)  # your dims
listener = (2.75, 2.5, 1.15)                                     # your seat
# Approximate Dragon as one point source — front-centre for now
source = (2.75, 0.30, 0.7)
synth = shoebox_ir(room, source, listener, FS, duration=1.0)

# Line them up on the same time axis
min_len = min(len(measured), len(synth))
measured = measured[:min_len]
synth = synth[:min_len]

# Rough comparison — energy in windowed bands
def band_rms(x, fs, lo, hi, n_fft=8192):
    freqs = np.fft.rfftfreq(n_fft, 1/fs)
    X = np.abs(np.fft.rfft(x[:n_fft]))
    mask = (freqs >= lo) & (freqs <= hi)
    return float(np.sqrt(np.mean(X[mask]**2)))

for lo, hi in [(20, 100), (100, 500), (500, 2000), (2000, 8000)]:
    m = band_rms(measured, FS, lo, hi)
    s = band_rms(synth, FS, lo, hi)
    print(f"  {lo:5}-{hi:5} Hz  measured {20*np.log10(m):+.1f}   synth {20*np.log10(s):+.1f}   Δ {20*np.log10(m/s):+.1f} dB")
```

**Expected finding**: the synthetic and measured IRs will NOT match well.
That's OK — the shoebox model is a single-source, no-directivity,
uniform-absorption approximation of an 11-driver phased-array soundbar.
The interesting question is *how* they diverge:

- **Low-frequency mismatch** → your room has modes the model doesn't
  (image-source method underestimates modal response at low freqs)
- **Missing HF rolloff** → we don't model air absorption or diffusion
- **Reverb tail too long** → your Dragon + room is more absorbing than
  our default `absorption=0.20`; tune the model's `absorption` up until
  RT60 matches, note the value

Write down what you observed. That gap is where the model needs work.

---

## 6. Corrector loop

Now with the measured IR in hand, run the corrector against it.

```python
from soundlab.corrector import (
    derive_correction, build_correction_filter, apply_correction
)
from scipy.io import wavfile

# Reference: model's anechoic-at-seat response (direct path only)
anechoic_room = Room(dims=room.dims, absorption=1.0, max_order=0)
reference = shoebox_ir(anechoic_room, source, listener, FS, duration=0.1)

# Derive correction that pulls measured → reference in spectral shape
freqs, gain = derive_correction(measured, reference, FS, level_match=True)
# NOTE: order matters — derive_correction(ref, meas). We want to boost
# measured toward reference:
freqs, gain = derive_correction(reference, measured, FS, level_match=True)
taps = build_correction_filter(freqs, gain, FS, n_taps=2047)

# Save the FIR as a wav REW can load and inject during playback
from soundlab.io import write_wav
write_wav(f"correction-sweet-spot.wav", taps, FS, normalise=False)

print(f"Correction: max {20*np.log10(gain.max()):+.1f} dB, "
      f"min {20*np.log10(gain.min()):+.1f} dB")
```

Then to test it end-to-end:

7. Play the same reference material (a familiar track, or Dolby's
   `L-R-C-Sub` test loop) through the Dragon → measure at the same seat
   in REW → save as `dragon-off-raw-<seat>.wav`.
8. Convolve the reference material with `taps` **offline** (in Audacity,
   Reaper, or via `soundlab.corrector.apply_correction`) → play the
   convolved version through the Dragon → measure → save as
   `dragon-off-corrected-<seat>.wav`.
9. Compare the two spectra. If the corrector helped, the corrected
   measurement should be closer to the reference in the bands your
   correction targeted.

---

## 7. Dragon SSE comparison

Now the "does our correction beat theirs" question:

- **Round A** — Dragon SSE OFF, no correction. You already have this from
  step 4.
- **Round B** — Dragon SSE OFF, your correction FIR applied to source.
  You have this from step 6.
- **Round C** — Dragon SSE ON, no external correction. Measure fresh.
- **Round D** — Dragon SSE ON, your correction FIR ON TOP. Measure fresh.
  (This one is where you're most likely to see interaction: two EQs
  fighting each other.)

For each round, at the sweet-spot seat, capture the frequency response
and note:
- Total spectral tilt (dB slope from 100 Hz to 8 kHz)
- Any peaks > +3 dB or nulls > -6 dB
- Perceived "quality" listening to a familiar track (subjective but
  useful — you're the eventual customer of this thing)

---

## 8. Results log

Fill this in as you go. Keeping the numbers next to the file paths is
half the value of the exercise.

| Seat | Round | RT60 (500 Hz) | Peak-to-null (100–500 Hz) | Corr max dB | Corr min dB | Subjective (0–5) | Notes |
|------|-------|--------------:|--------------------------:|------------:|------------:|-----------------:|-------|
| sweet-spot | A: SSE off, no corr |               |                          | —           | —           |                  |       |
| sweet-spot | B: SSE off, our corr |              |                          |             |             |                  |       |
| sweet-spot | C: SSE on, no corr  |              |                          | —           | —           |                  |       |
| sweet-spot | D: SSE on, our corr |               |                          |             |             |                  |       |
| off-axis   | A |                              |                          | —           | —           |                  |       |
| off-axis   | B |                              |                          |             |             |                  |       |
| back-couch | A |                              |                          | —           | —           |                  |       |
| back-couch | B |                              |                          |             |             |                  |       |

---

## 9. Gotchas we've hit

- **Sample-rate drift** — plug/unplug USB devices, macOS silently resets
  audio to 44.1 kHz. Check before each session, or REW's IR looks
  time-stretched.
- **Bluetooth / AirPlay** — never use these for measurement. They add
  variable latency and lossy compression. Wired only.
- **HVAC** — one 20 dB SPL fan cycle destroys a low-frequency
  measurement. Kill the AC/heat for the session.
- **The Dragon might refuse a "raw" mode.** Some modes still apply
  virtual surround. Test with a mono pink-noise track: sound should come
  primarily from the front centre, not "everywhere." If it comes from
  everywhere, the mode you picked is upmixing.
- **Correction FIR applied twice.** If Dragon SSE is on, your correction
  is fighting it. Compare rounds A vs. C first to see if SSE is doing
  anything useful before you layer.

---

## 10. What to send back

If you want the sim tuned to match your room, drop the following into
this repo (or share separately):

- `dragon-off-<seat>.wav` for each seat (measured IRs)
- Your room dimensions + Dragon position + seat positions
- The results log filled in
- A one-paragraph "here's what I heard" for each round

The next step is using those measured IRs to substitute for
`shoebox_ir` in the renderer — that's a two-line code change and gets
us out of "synthesised room" and into "your room."
