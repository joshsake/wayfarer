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
from typing import Iterator

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


@dataclass(frozen=True)
class ImageSource:
    """One image source and its arrival at the listener.

    ``position`` is the mirror-source coordinate in world space.
    ``distance`` is the straight-line distance from that image to the listener.
    ``amplitude`` is (β**reflections) / distance — the 1/r spreading loss
    combined with the reflection-coefficient product.
    """
    position: np.ndarray
    distance: float
    amplitude: float


def iter_image_sources(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
) -> Iterator[ImageSource]:
    """Enumerate image sources for the shoebox room.

    Pure geometry — no sample rate, no time-domain rendering. Used by both
    the mono IR path (``shoebox_ir``) and the binaural path so the two
    stay consistent by construction.

    Reference: Allen & Berkley, "Image method for efficiently simulating
    small-room acoustics," JASA 65(4), 1979.
    """
    _assert_inside(room, source, "source")
    _assert_inside(room, listener, "listener")

    L = np.asarray(room.dims, dtype=float)
    s = np.asarray(source, dtype=float)
    r = np.asarray(listener, dtype=float)
    beta = np.sqrt(1.0 - room.absorption)

    order = room.max_order
    for nx, ny, nz in itertools.product(range(-order, order + 1), repeat=3):
        for qx, qy, qz in itertools.product((0, 1), repeat=3):
            img = np.array([
                (1 - 2 * qx) * s[0] + 2 * nx * L[0],
                (1 - 2 * qy) * s[1] + 2 * ny * L[1],
                (1 - 2 * qz) * s[2] + 2 * nz * L[2],
            ])
            dist = float(np.linalg.norm(img - r))
            if dist < 1e-9:
                continue
            reflections = (
                abs(nx - qx) + abs(nx)
                + abs(ny - qy) + abs(ny)
                + abs(nz - qz) + abs(nz)
            )
            amplitude = (beta ** reflections) / dist
            yield ImageSource(position=img, distance=dist, amplitude=amplitude)


def shoebox_ir(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
    fs: int,
    duration: float = 1.0,
) -> np.ndarray:
    """Mono IR by summing scaled impulses at per-image-source delays."""
    n_samples = int(duration * fs)
    ir = np.zeros(n_samples, dtype=np.float64)
    for img in iter_image_sources(room, source, listener):
        delay = int(round(img.distance / SPEED_OF_SOUND * fs))
        if delay < n_samples:
            ir[delay] += img.amplitude
    return ir


def _assert_inside(room: Room, point: tuple[float, float, float], name: str) -> None:
    for axis, (p, L) in enumerate(zip(point, room.dims)):
        if not 0.0 <= p <= L:
            raise ValueError(
                f"{name} axis {axis} = {p} outside room [0, {L}]"
            )
