# Hardware for testing sound-lab

The prototype in this repo is a numerical simulator — synthesised scenes,
synthesised rooms. To validate any of it against reality (does the shoebox
model match a real room? does the corrector actually help in a real seat?)
you need to measure and to play back. Prices are ballpark USD, mid-2026.

## What each tier lets you do

| Tier               | Approx. cost | Unlocks                                                                                                       |
| ------------------ | -----------: | ------------------------------------------------------------------------------------------------------------- |
| **Minimum viable** |     ~$150    | Capture a real room's impulse response. Feed measured IRs into the renderer instead of synthetic ones.        |
| **Practical**      |     ~$500    | Both mono and stereo binaural measurement. Compare "sim vs. real" at a seat. Prototype the corrector in-room. |
| **Serious**        |    ~$2000+   | Multi-position measurement, per-seat correction, real HRTF acquisition, tactile/subwoofer testing.            |

Everything below plugs into open-source measurement software: **Room EQ
Wizard (REW)** — free, standard in the acoustics world, handles sine-sweep
measurement, spectra, impulse response, RT60. The wavs it produces load
straight into the renderer as measured IRs.

## Tier 1 — Minimum viable (~$150)

Enough to capture a real room IR and start comparing against the synthetic
one.

- **miniDSP UMIK-1** (~$100) — USB measurement microphone, comes with an
  individual calibration file. Omnidirectional, plug into a laptop, works
  directly with REW. Not audiophile-grade but genuinely calibrated. The
  UMIK-2 is $220 with slightly better low-noise floor if you can stretch.
- **Mic stand + boom** (~$30) — any music-shop stand works. You want to
  place the mic at ear height at each measurement position.
- **A laptop that can run REW** — anything modern.

What you can do:
- Sine-sweep measurement of a room's mono IR at each seat
- Compare the measured decay time to what our shoebox model predicts
- Substitute measured IRs for synthetic ones in the renderer

What you can't yet:
- Binaural anything — UMIK-1 is a single mic
- Any real playback validation without a known-flat monitor

## Tier 2 — Practical (~$500)

Adds binaural capture and a reference monitor so you can close the loop:
measure → correct → re-measure.

- **UMIK-1** (~$100) — as above
- **In-ear binaural microphones**, e.g. **Roland CS-10EM** (~$100) — worn
  in your own ears; captures what YOU actually hear at that seat, HRTF
  and all. Only works with a recorder that has 3.5 mm mic input and
  plug-in power (not phantom). Cheaper than a dummy head; less repeatable.
  A `MovingStem` recorded through these becomes ground-truth for
  binaural-model comparison.
- **Small handheld recorder**, e.g. **Zoom H5** (~$270) — for the binaural
  mics; also handy for on-the-go stem capture without a laptop.
- **A pair of neutral open-back headphones**, e.g. **Sennheiser HD650**
  (~$400, or used $200) or **Beyerdynamic DT880** (~$180). Open-back
  matters because closed-back adds its own cavity resonance to what
  you're evaluating. This is the "headphone reference" side of the
  headphones-vs-theatre comparison.
- **Mic stand** — as Tier 1

What you can do:
- Compare the sim's binaural render at a seat vs. what your ears actually
  measured at that seat (via CS-10EM). This is the real test of whether
  the model is telling the truth.
- Derive a real correction filter from a real measurement and apply it
  during offline playback

What you can't yet:
- Trust the reference monitors (you don't have ones you calibrated)
- Test subwoofer/tactile behaviour meaningfully

## Tier 3 — Serious (~$2000+)

Enough to do repeatable measurements, per-seat correction, and real
subwoofer/haptic testing. Only worth reaching for once the prototype has
earned the investment.

Measurement:
- **UMIK-2** (~$220) or a **Dayton EMM-6** (~$100) with a proper interface
- **A dummy head**, e.g. the **3dio Free Space Pro II** (~$800) — silicon
  ears with mics, USB or XLR. Repeatable binaural capture that a person's
  head can't match because the person moves. **Neumann KU100** is the
  studio standard (~$8k, out of scope here).
- **USB audio interface with phantom power**, e.g. **Focusrite Scarlett
  2i2** (~$180) — needed for any XLR mic
- Two extra mic stands + XLR cables

Playback / reference:
- **Neutral studio monitors**, e.g. **Adam Audio T5V** (~$250 each) or
  **Genelec 8010A** (~$400 each). Both channels needed for stereo
  measurement.
- **A subwoofer for LFE testing**, e.g. **SVS SB-1000 Pro** (~$600) —
  can it hit the 40 Hz thump the demo scene tries to reproduce?
- **A tactile transducer** (bass shaker), e.g. **ButtKicker Mini LFE**
  (~$300 with amp) — the whole reason the original conversation started.
  Wire it to the LFE channel; feel the thump that a mic can't record and
  a headphone can't reproduce.

## The theatre-specific bit

Measuring in an actual cinema is a different problem than measuring at
home:

- **Permission first.** Cinemas don't let you play sweeps during a
  screening; you need booking a screen for measurement, which usually
  means talking to the projection tech.
- **Portable everything.** Battery-powered recorder + USB mic + laptop,
  no mains cables running through the aisle.
- **Multiple seats.** A single centre-seat measurement is useless — the
  interesting story is the variance across seats. Plan the seat grid
  before you show up.
- **Quiet operation.** HVAC, projector fans, and any residual audience
  raise the noise floor. Ideally you measure with the room cold and empty.
- **The playback source is what the theatre normally uses.** Piping your
  own laptop into the theatre's system defeats the purpose of measuring
  that theatre's system.

## What we're not buying (yet)

- **Individual HRTF measurement.** Real per-person HRTFs are a huge upgrade
  over the spherical head, but capturing your own is a two-day project
  with a turntable and calibrated setup. Cheaper path: pay a company
  (~$500) to measure yours in their rig, get a SOFA file, load it via
  the `HeadModel` interface the code already has room for.
- **Anechoic chamber time.** Nice for baseline speaker measurement but not
  necessary for what we're doing.
- **A full Atmos processor.** For rendering actual .adm/.wav Atmos masters
  as they'd be delivered — later, if we go that direction.

## Software (free) you'll pair with the hardware

- **Room EQ Wizard (REW)** — sweep generation, IR capture, spectrum analysis
- **Audacity** or **Reaper** — recording and editing captures
- **Our own `soundlab` package** — loads any wav-based IR via
  `soundlab.io.read_mono_wav`; drop it in place of `shoebox_ir` in the
  render pipeline. That's the plug point where measured data meets the
  simulator.
