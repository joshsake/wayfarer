"""Synthetic room impulse responses via the image-source method.

Only shoebox (rectangular) rooms for now, with a single scalar absorption
coefficient applied uniformly to all six walls. That's the simplest useful
model — enough to prove the convolution pipeline and to compare "small
dead room" vs. "large live room" at the DSP level. Frequency-dependent
absorption and non-rectangular geometry are extensions on top.
"""

from __future__ import annotations

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


def image_source_arrays(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorised image-source enumeration.

    Returns three arrays of length N (N = valid image sources):
      positions:  (N, 3) world coordinates
      distances:  (N,)   straight-line distance to listener
      amplitudes: (N,)   ``(β**reflections) / distance``

    Hot path for both the mono and binaural renderers. Removes the per-image
    Python overhead that made moving-source rendering unusably slow.

    Reference: Allen & Berkley, "Image method for efficiently simulating
    small-room acoustics," JASA 65(4), 1979.
    """
    _assert_inside(room, source, "source")
    _assert_inside(room, listener, "listener")

    L = np.asarray(room.dims, dtype=np.float64)
    s = np.asarray(source, dtype=np.float64)
    r = np.asarray(listener, dtype=np.float64)
    beta = np.sqrt(1.0 - room.absorption)
    order = room.max_order

    n_axis = np.arange(-order, order + 1, dtype=np.int64)          # (2M+1,)
    q_axis = np.array([0, 1], dtype=np.int64)                       # (2,)
    # Grid of (nx, ny, nz, qx, qy, qz) — 6-D lattice.
    nx, ny, nz, qx, qy, qz = np.meshgrid(
        n_axis, n_axis, n_axis, q_axis, q_axis, q_axis, indexing="ij"
    )

    img_x = (1 - 2 * qx) * s[0] + 2 * nx * L[0]
    img_y = (1 - 2 * qy) * s[1] + 2 * ny * L[1]
    img_z = (1 - 2 * qz) * s[2] + 2 * nz * L[2]

    dx = img_x - r[0]
    dy = img_y - r[1]
    dz = img_z - r[2]
    distances = np.sqrt(dx * dx + dy * dy + dz * dz)

    reflections = (
        np.abs(nx - qx) + np.abs(nx)
        + np.abs(ny - qy) + np.abs(ny)
        + np.abs(nz - qz) + np.abs(nz)
    )
    amps = (beta ** reflections) / np.maximum(distances, 1e-12)

    positions = np.stack([img_x, img_y, img_z], axis=-1).reshape(-1, 3)
    distances = distances.reshape(-1)
    amps = amps.reshape(-1)

    valid = distances > 1e-9
    return positions[valid], distances[valid], amps[valid]


def iter_image_sources(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
) -> Iterator[ImageSource]:
    """Iterator wrapper around :func:`image_source_arrays` for anyone who
    wants per-image access. Not on the hot path — the renderers work with
    the raw arrays for speed.
    """
    positions, distances, amps = image_source_arrays(room, source, listener)
    for pos, dist, amp in zip(positions, distances, amps):
        yield ImageSource(position=pos, distance=float(dist), amplitude=float(amp))


def shoebox_ir(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
    fs: int,
    duration: float = 1.0,
) -> np.ndarray:
    """Mono IR by summing scaled impulses at per-image-source delays."""
    _, distances, amps = image_source_arrays(room, source, listener)
    n_samples = int(duration * fs)
    delays = np.round(distances / SPEED_OF_SOUND * fs).astype(np.int64)
    mask = delays < n_samples
    ir = np.zeros(n_samples, dtype=np.float64)
    np.add.at(ir, delays[mask], amps[mask])
    return ir


def _assert_inside(room: Room, point: tuple[float, float, float], name: str) -> None:
    for axis, (p, L) in enumerate(zip(point, room.dims)):
        if not 0.0 <= p <= L:
            raise ValueError(
                f"{name} axis {axis} = {p} outside room [0, {L}]"
            )
