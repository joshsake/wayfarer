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
from .trajectory import Trajectory


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


@dataclass(frozen=True)
class MovingStem:
    label: str
    audio: np.ndarray                          # mono, float
    trajectory: Trajectory

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


# --- Moving sources ---------------------------------------------------------
#
# Block-wise time-varying convolution. For each hop the source position is
# read at the block's midpoint, a fresh IR is generated there, and the
# windowed block is convolved with it. Overlapping Hann windows at 50% hop
# satisfy constant-overlap-add, so with a static trajectory the result
# equals the direct convolution up to boundary tapers.
#
# Kept separate from the static path because static + fftconvolve is much
# cheaper than block-wise for long stems that don't move.


_MOVING_BLOCK_SIZE = 4096


def _pad_head(block_size: int) -> int:
    # A block_size/2 pre-pad puts the first true audio sample under a fully
    # overlapping pair of Hann windows, avoiding a leading fade-in.
    return block_size // 2


def _iter_moving_blocks(audio: np.ndarray, block_size: int, hop: int):
    """Yield (start_in_padded, windowed_block, pad_head) triples.

    Uses the periodic (not symmetric) Hann window — required for exact COLA
    at 50 % hop. ``np.hanning`` returns the symmetric form and only
    approximately satisfies COLA.
    """
    n = np.arange(block_size)
    win = 0.5 - 0.5 * np.cos(2.0 * np.pi * n / block_size)
    pad = _pad_head(block_size)
    padded = np.concatenate([np.zeros(pad, dtype=audio.dtype), audio])
    n = len(padded)
    for start in range(0, n, hop):
        take = min(block_size, n - start)
        if take <= 0:
            break
        block = np.zeros(block_size, dtype=audio.dtype)
        block[:take] = padded[start : start + take]
        block *= win
        yield start, block, pad


def render_moving_at_seat(
    stem: MovingStem,
    room: Room,
    listener: tuple[float, float, float],
    fs: int,
    *,
    block_size: int = _MOVING_BLOCK_SIZE,
    ir_duration: float = 0.5,
) -> np.ndarray:
    """Mono at-seat render of one moving source.

    Returns a 1-D array whose length matches ``len(stem.audio) + ir_len - 1``,
    the same convention as :func:`render_at_seat`.
    """
    hop = block_size // 2
    pad = _pad_head(block_size)
    ir_len = int(ir_duration * fs)
    out_len_padded = len(stem.audio) + pad + ir_len - 1
    out = np.zeros(out_len_padded, dtype=np.float64)

    for start, block, _pad in _iter_moving_blocks(stem.audio, block_size, hop):
        t_mid = (start + block_size / 2 - pad) / fs
        pos = stem.trajectory.position_at(max(t_mid, 0.0))
        ir = shoebox_ir(room, pos, listener, fs, duration=ir_duration)
        wet = fftconvolve(block, ir)
        end = min(start + len(wet), out_len_padded)
        out[start:end] += wet[: end - start]

    return out[pad:]


def render_moving_at_seat_binaural(
    stem: MovingStem,
    room: Room,
    listener: tuple[float, float, float],
    listener_forward: tuple[float, float, float],
    head: SphericalHead,
    fs: int,
    *,
    block_size: int = _MOVING_BLOCK_SIZE,
    ir_duration: float = 0.5,
) -> np.ndarray:
    """Binaural at-seat render of one moving source. Shape ``(n, 2)``."""
    hop = block_size // 2
    pad = _pad_head(block_size)
    ir_len = int(ir_duration * fs)
    out_len_padded = len(stem.audio) + pad + ir_len - 1
    out = np.zeros((out_len_padded, 2), dtype=np.float64)

    for start, block, _pad in _iter_moving_blocks(stem.audio, block_size, hop):
        t_mid = (start + block_size / 2 - pad) / fs
        pos = stem.trajectory.position_at(max(t_mid, 0.0))
        left_ir, right_ir = binaural_shoebox_ir(
            room, pos, listener, listener_forward, head, fs,
            duration=ir_duration,
        )
        wet_l = fftconvolve(block, left_ir)
        wet_r = fftconvolve(block, right_ir)
        end = min(start + len(wet_l), out_len_padded)
        out[start:end, 0] += wet_l[: end - start]
        out[start:end, 1] += wet_r[: end - start]

    return out[pad:]
