"""Synthetic room impulse responses via the image-source method.

Only shoebox (rectangular) rooms for now, with a single scalar absorption
coefficient applied uniformly to all six walls. That's the simplest useful
model — enough to prove the convolution pipeline and to compare "small
dead room" vs. "large live room" at the DSP level. Frequency-dependent
absorption and non-rectangular geometry are extensions on top.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np

SPEED_OF_SOUND = 343.0  # m/s at ~20°C


@dataclass(frozen=True)
class Room:
    dims: tuple[float, float, float]     # (Lx, Ly, Lz) in metres
    absorption: float = 0.3              # 0 = perfect mirror, 1 = anechoic
    max_order: int = 10                  # image-source reflection order

    def __post_init__(self) -> None:
        if any(d <= 0 for d in self.dims):
            raise ValueError(f"room dims must be positive, got {self.dims}")
        if not 0.0 <= self.absorption <= 1.0:
            raise ValueError(f"absorption must be in [0, 1], got {self.absorption}")
        if self.max_order < 0:
            raise ValueError(f"max_order must be >= 0, got {self.max_order}")


def shoebox_ir(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
    fs: int,
    duration: float = 1.0,
) -> np.ndarray:
    """Image-source method IR for a shoebox room.

    Returns a mono impulse response of length ``int(duration * fs)`` samples.
    Reflections that would land past the end of the IR are dropped, which is
    fine as long as ``duration`` exceeds the room's effective reverb time.

    Reference: Allen & Berkley, "Image method for efficiently simulating
    small-room acoustics," JASA 65(4), 1979.
    """
    _assert_inside(room, source, "source")
    _assert_inside(room, listener, "listener")

    L = np.asarray(room.dims, dtype=float)
    s = np.asarray(source, dtype=float)
    r = np.asarray(listener, dtype=float)
    beta = np.sqrt(1.0 - room.absorption)

    n_samples = int(duration * fs)
    ir = np.zeros(n_samples, dtype=np.float64)

    order = room.max_order
    for nx, ny, nz in itertools.product(range(-order, order + 1), repeat=3):
        for qx, qy, qz in itertools.product((0, 1), repeat=3):
            # Image source position for this (cell, quadrant) pair.
            img = np.array([
                (1 - 2 * qx) * s[0] + 2 * nx * L[0],
                (1 - 2 * qy) * s[1] + 2 * ny * L[1],
                (1 - 2 * qz) * s[2] + 2 * nz * L[2],
            ])
            dist = float(np.linalg.norm(img - r))
            if dist < 1e-9:
                # Source coincident with listener; skip the singular term.
                continue
            delay = int(round(dist / SPEED_OF_SOUND * fs))
            if delay >= n_samples:
                continue
            reflections = (
                abs(nx - qx) + abs(nx)
                + abs(ny - qy) + abs(ny)
                + abs(nz - qz) + abs(nz)
            )
            amp = (beta ** reflections) / dist
            ir[delay] += amp

    return ir


def _assert_inside(room: Room, point: tuple[float, float, float], name: str) -> None:
    for axis, (p, L) in enumerate(zip(point, room.dims)):
        if not 0.0 <= p <= L:
            raise ValueError(
                f"{name} axis {axis} = {p} outside room [0, {L}]"
            )
