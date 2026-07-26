"""Convolve positioned mono stems through per-source room IRs.

Pure: takes arrays and returns arrays. No file paths, no side effects.
The CLI handles disk. Everything here is unit-testable without audio hardware.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import fftconvolve

from .binaural import SphericalHead, binaural_shoebox_ir
from .room import Room, shoebox_ir


@dataclass(frozen=True)
class PositionedStem:
    label: str
    audio: np.ndarray                          # mono, float
    position: tuple[float, float, float]       # metres

    def __post_init__(self) -> None:
        if self.audio.ndim != 1:
            raise ValueError(
                f"stem {self.label!r} must be mono (1-D), got shape {self.audio.shape}"
            )


def render_at_seat(
    stems: list[PositionedStem],
    room: Room,
    listener: tuple[float, float, float],
    fs: int,
    ir_duration: float = 1.0,
) -> np.ndarray:
    """Render every stem through its source-to-listener IR and sum.

    Returns a mono float array of length ``max(len(stem) + len(ir) - 1)``
    across stems. Caller normalises for output.
    """
    if not stems:
        raise ValueError("need at least one stem to render")

    ir_len = int(ir_duration * fs)
    out_len = max(len(stem.audio) for stem in stems) + ir_len - 1
    out = np.zeros(out_len, dtype=np.float64)

    for stem in stems:
        ir = shoebox_ir(room, stem.position, listener, fs, duration=ir_duration)
        wet = fftconvolve(stem.audio, ir)
        out[: len(wet)] += wet

    return out


def render_at_seat_binaural(
    stems: list[PositionedStem],
    room: Room,
    listener: tuple[float, float, float],
    listener_forward: tuple[float, float, float],
    head: SphericalHead,
    fs: int,
    ir_duration: float = 1.0,
) -> np.ndarray:
    """Stereo per-ear render. Returns shape ``(n_samples, 2)`` interleaved as
    ``[:, 0] = left`` and ``[:, 1] = right`` — the layout ``soundfile.write``
    treats as stereo.
    """
    if not stems:
        raise ValueError("need at least one stem to render")

    ir_len = int(ir_duration * fs)
    out_len = max(len(stem.audio) for stem in stems) + ir_len - 1
    out = np.zeros((out_len, 2), dtype=np.float64)

    for stem in stems:
        left_ir, right_ir = binaural_shoebox_ir(
            room, stem.position, listener, listener_forward, head, fs,
            duration=ir_duration,
        )
        wet_l = fftconvolve(stem.audio, left_ir)
        wet_r = fftconvolve(stem.audio, right_ir)
        out[: len(wet_l), 0] += wet_l
        out[: len(wet_r), 1] += wet_r

    return out
