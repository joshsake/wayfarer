"""Convolve positioned mono stems through per-source room IRs.

Pure: takes arrays and returns arrays. No file paths, no side effects.
The CLI handles disk. Everything here is unit-testable without audio hardware.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import fftconvolve

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
