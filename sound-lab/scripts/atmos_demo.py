"""Generate a synthetic 5.1.4 + object scene and render it at two seats.

Every stem here is synthesised in code (sines, filtered noise, envelopes).
Nothing is licensed content — safe to commit and share. The point isn't a
believable helicopter; it's a scene with enough positional variety
(front bed, surrounds, LFE in a corner, an object *circling above* the
bed layer) that the room simulator has something interesting to do.

The helicopter uses the moving-source renderer — its position updates
per block via Trajectory keyframes.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from scipy import signal as sig

from soundlab.binaural import SphericalHead
from soundlab.io import write_wav
from soundlab.render import (
    MovingStem,
    PositionedStem,
    render_at_seat,
    render_at_seat_binaural,
    render_moving_at_seat,
    render_moving_at_seat_binaural,
)
from soundlab.room import Room
from soundlab.trajectory import Trajectory


FS = 48_000
DURATION = 5.0


def synth_bed_music(duration: float, fs: int, root_hz: float) -> np.ndarray:
    """Chord pad — fundamental + fifth + octave, with slow tremolo."""
    t = np.arange(int(duration * fs)) / fs
    partials = [root_hz, root_hz * 1.5, root_hz * 2.0]
    x = sum(0.3 * np.sin(2 * np.pi * f * t) for f in partials)
    env = 0.7 + 0.3 * np.sin(2 * np.pi * 1.5 * t)
    return x * env


def synth_dialogue(duration: float, fs: int) -> np.ndarray:
    """Speech-like: bandpassed noise pulses at a syllable rate."""
    n = int(duration * fs)
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(n)
    b, a = sig.butter(4, [300 / (fs / 2), 3400 / (fs / 2)], btype="band")
    voiced = sig.lfilter(b, a, noise)
    t = np.arange(n) / fs
    syllable_env = np.maximum(0.0, np.sin(2 * np.pi * 4.0 * t)) ** 2
    return voiced * syllable_env * 0.5


def synth_ambience(duration: float, fs: int, seed: int) -> np.ndarray:
    """Low-passed noise — room tone / crowd murmur."""
    n = int(duration * fs)
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    b, a = sig.butter(2, 2000 / (fs / 2), btype="low")
    return sig.lfilter(b, a, noise) * 0.15


def synth_helicopter(duration: float, fs: int) -> np.ndarray:
    """Bandpassed noise + 10 Hz tremolo — the 'rotor' shape."""
    n = int(duration * fs)
    rng = np.random.default_rng(2)
    noise = rng.standard_normal(n)
    b, a = sig.butter(4, [200 / (fs / 2), 800 / (fs / 2)], btype="band")
    rotor = sig.lfilter(b, a, noise)
    t = np.arange(n) / fs
    tremolo = 0.5 + 0.5 * np.sin(2 * np.pi * 10.0 * t)
    return rotor * tremolo * 0.6


def synth_lfe_thump(duration: float, fs: int, at_seconds: float = 2.0) -> np.ndarray:
    """One 40 Hz kick with a fast attack, exponential decay."""
    n = int(duration * fs)
    x = np.zeros(n)
    start = int(at_seconds * fs)
    hit_len = int(0.6 * fs)
    t = np.arange(hit_len) / fs
    x[start : start + hit_len] = np.sin(2 * np.pi * 40 * t) * np.exp(-t * 3.0)
    return x * 0.9


def build_scene(
    fs: int, duration: float
) -> tuple[Room, list[PositionedStem], MovingStem]:
    """5.1.4-ish layout scaled to a 12×8×4 m room, plus a circling object.

    Returns ``(room, static_stems, moving_stem)``. The helicopter orbits
    room-centre at ceiling height in the (x, y) plane over ``duration``
    seconds so the loop closes back to its start.
    """
    room = Room(dims=(12.0, 8.0, 4.0), absorption=0.25, max_order=6)
    static = [
        PositionedStem("bed-fl", synth_bed_music(duration, fs, 220.0),        (2.0, 0.3, 1.6)),
        PositionedStem("bed-fr", synth_bed_music(duration, fs, 220.0 * 1.25), (10.0, 0.3, 1.6)),
        PositionedStem("bed-c",  synth_dialogue(duration, fs),                (6.0, 0.3, 1.6)),
        PositionedStem("bed-sl", synth_ambience(duration, fs, seed=10),       (0.3, 5.0, 1.6)),
        PositionedStem("bed-sr", synth_ambience(duration, fs, seed=11),       (11.7, 5.0, 1.6)),
        PositionedStem("lfe",    synth_lfe_thump(duration, fs),               (0.3, 0.3, 0.3)),
    ]
    heli = MovingStem(
        label="obj-heli",
        audio=synth_helicopter(duration, fs),
        trajectory=Trajectory.circle_xy(
            center_xy=(6.0, 4.0), radius=3.0, height=3.7,
            duration=duration, n_points=32,
        ),
    )
    return room, static, heli


def _write_scaled(path: Path, audio: np.ndarray, fs: int, scale: float) -> None:
    """Bypass write_wav's per-file normalisation so cross-seat outputs keep
    their relative level — otherwise every file ends up at -1 dBFS and the
    interesting delta vanishes. Handles mono (1-D) and stereo ((n,2)).
    """
    import soundfile as sf
    sf.write(str(path), (audio * scale).astype(np.float32), fs)


# Listener faces the front wall (y=0), so forward = -y in world coordinates.
LISTENER_FORWARD = (0.0, -1.0, 0.0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="demos")
    parser.add_argument("--duration", type=float, default=DURATION)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    room, static_stems, heli = build_scene(FS, args.duration)
    head = SphericalHead()

    seats = {
        "sweet-spot":  (6.0, 5.0, 1.2),   # centre of the room, mid-hall
        "back-corner": (10.5, 7.5, 1.2),  # rear-right, close to two walls
    }

    mono: dict[str, np.ndarray] = {}
    binaural: dict[str, np.ndarray] = {}
    for name, pos in seats.items():
        static_mono = render_at_seat(static_stems, room, pos, FS, ir_duration=0.5)
        static_bin = render_at_seat_binaural(
            static_stems, room, pos, LISTENER_FORWARD, head, FS, ir_duration=0.5,
        )
        heli_mono = render_moving_at_seat(heli, room, pos, FS, ir_duration=0.5)
        heli_bin = render_moving_at_seat_binaural(
            heli, room, pos, LISTENER_FORWARD, head, FS, ir_duration=0.5,
        )
        # Static and moving paths use the same length convention, so a
        # straight-through add works.
        mono[name] = static_mono + heli_mono
        binaural[name] = static_bin + heli_bin

    # One scale factor for mono outputs, one for binaural — so within each
    # format seats stay comparable, but mono vs. stereo levels aren't forced
    # onto a shared reference (they'd have very different peak statistics).
    mono_peak = max(float(np.max(np.abs(x))) for x in mono.values())
    bin_peak = max(float(np.max(np.abs(x))) for x in binaural.values())
    if mono_peak <= 0 or bin_peak <= 0:
        raise RuntimeError("rendered scene is silent — bug in scene setup")
    ceil = 10 ** (-1.0 / 20.0)                 # -1 dBFS
    mono_scale = ceil / mono_peak
    bin_scale = ceil / bin_peak

    for name, audio in mono.items():
        path = out_dir / f"seat-{name}.wav"
        _write_scaled(path, audio, FS, mono_scale)
        peak = float(np.max(np.abs(audio)))
        rms = float(np.sqrt(np.mean(audio ** 2)))
        print(f"  mono/{name:<11}  peak {20*np.log10(peak):+.1f} dB  rms {20*np.log10(rms):+.1f} dB  → {path}")

    for name, audio in binaural.items():
        path = out_dir / f"seat-{name}-binaural.wav"
        _write_scaled(path, audio, FS, bin_scale)
        peak = float(np.max(np.abs(audio)))
        # Per-ear RMS ratio hints at how much the render leans one way.
        rms_l = float(np.sqrt(np.mean(audio[:, 0] ** 2)))
        rms_r = float(np.sqrt(np.mean(audio[:, 1] ** 2)))
        lr_balance_db = 20 * np.log10(rms_r / rms_l) if rms_l > 0 else float("inf")
        print(
            f"  bin/ {name:<11}  peak {20*np.log10(peak):+.1f} dB  "
            f"L/R balance {lr_balance_db:+.2f} dB (R relative to L)  → {path}"
        )

    # Dry stem sum — the "no-room, no-distance" reference (mono).
    all_stems = static_stems + [heli]
    dry_len = max(len(s.audio) for s in all_stems)
    dry = np.zeros(dry_len)
    for s in all_stems:
        dry[: len(s.audio)] += s.audio
    write_wav(out_dir / "reference-dry-sum.wav", dry, FS)
    print(f"  reference-dry-sum   → {out_dir / 'reference-dry-sum.wav'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
