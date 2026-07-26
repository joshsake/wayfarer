"""Binaural rendering — stereo per-ear output.

For now the head model is a rigid sphere: ITD from Woodworth's approximation
and a smooth broadband head-shadow gain for IID. Two dominant localisation
cues covered; pinna filtering (which is what disambiguates elevation and
front/back) is not. Real measured HRTFs from a SOFA file plug in later by
swapping in a different renderer that convolves per-ear kernels instead of
placing scaled impulses.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .room import SPEED_OF_SOUND, Room, image_source_arrays


HEAD_RADIUS_M = 0.0875                                   # ~average human head radius
ITD_MAX_SEC = (HEAD_RADIUS_M / SPEED_OF_SOUND) * (1.0 + np.pi / 2)  # Woodworth max


def world_to_listener_angles(
    direction_world: tuple[float, float, float] | np.ndarray,
    listener_forward: tuple[float, float, float] | np.ndarray,
    listener_up: tuple[float, float, float] | np.ndarray = (0.0, 0.0, 1.0),
) -> tuple[float, float]:
    """Convert a world-frame direction (from listener) to listener-frame (az, el).

    Conventions:
        az = 0° in front, +90° to listener's right, ±180° behind
        el = 0° horizontal, +90° above head, -90° below
    """
    forward = np.asarray(listener_forward, dtype=float)
    forward = forward / np.linalg.norm(forward)
    up = np.asarray(listener_up, dtype=float)
    up = up / np.linalg.norm(up)
    right = np.cross(forward, up)
    right = right / np.linalg.norm(right)

    d = np.asarray(direction_world, dtype=float)
    d_forward = float(np.dot(d, forward))
    d_right = float(np.dot(d, right))
    d_up = float(np.dot(d, up))

    az = float(np.rad2deg(np.arctan2(d_right, d_forward)))
    el = float(np.rad2deg(np.arcsin(np.clip(d_up, -1.0, 1.0))))
    return az, el


@dataclass(frozen=True)
class SphericalHead:
    """Rigid-sphere head model.

    Attributes:
        radius: sphere radius in metres.
        min_contralateral_gain: gain applied to the far ear when the source
            is directly opposite (~ -10 dB by default). The near ear always
            sees gain 1.0; between the two limits the transition is smooth.
    """
    radius: float = HEAD_RADIUS_M
    min_contralateral_gain: float = 0.3

    def per_ear_offsets(
        self,
        azimuth_deg: float,
        elevation_deg: float,
        fs: int,
    ) -> tuple[tuple[int, float], tuple[int, float]]:
        """Return ``((left_delay, left_gain), (right_delay, right_gain))``.

        Delays are integer sample offsets relative to the head-centre arrival —
        negative means the ear leads the centre, positive means it lags.
        """
        az = np.deg2rad(azimuth_deg)
        el = np.deg2rad(elevation_deg)

        # Woodworth ITD, tapered by cos(el). Positive itd → source on right,
        # right ear leads, so its offset is negative.
        itd_sec = ITD_MAX_SEC * float(np.sin(az)) * float(np.cos(el))
        half = itd_sec / 2.0
        left_delay = int(round(+half * fs))
        right_delay = int(round(-half * fs))

        # IID: cos of angle between ear axis and source direction, mapped
        # smoothly to [min_contralateral_gain, 1.0].
        source_dot_right = float(np.sin(az) * np.cos(el))    # +1 at right, -1 at left
        return (
            (left_delay, self._shadow_gain(-source_dot_right)),
            (right_delay, self._shadow_gain(+source_dot_right)),
        )

    def _shadow_gain(self, ear_alignment: float) -> float:
        # ear_alignment ∈ [-1, +1]: +1 source at this ear, -1 at opposite ear.
        t = (ear_alignment + 1.0) / 2.0
        return float(self.min_contralateral_gain + (1.0 - self.min_contralateral_gain) * t)


def binaural_shoebox_ir(
    room: Room,
    source: tuple[float, float, float],
    listener: tuple[float, float, float],
    listener_forward: tuple[float, float, float],
    head: SphericalHead,
    fs: int,
    duration: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Binaural (left, right) IR pair for a shoebox room + head model.

    All arithmetic is vectorised across image sources — one call per
    render block, not one per image source.
    """
    positions, distances, amps = image_source_arrays(room, source, listener)
    n = int(duration * fs)
    left = np.zeros(n, dtype=np.float64)
    right = np.zeros(n, dtype=np.float64)

    listener_arr = np.asarray(listener, dtype=np.float64)
    forward = np.asarray(listener_forward, dtype=np.float64)
    forward = forward / np.linalg.norm(forward)
    up = np.array([0.0, 0.0, 1.0])
    right_vec = np.cross(forward, up)
    right_vec = right_vec / np.linalg.norm(right_vec)

    # Direction from listener to each image source, projected onto the
    # listener's (forward, right, up) basis.
    dirs = (positions - listener_arr) / distances[:, None]     # (N, 3)
    d_forward = dirs @ forward
    d_right = dirs @ right_vec
    d_up = np.clip(dirs @ up, -1.0, 1.0)

    az = np.arctan2(d_right, d_forward)
    el = np.arcsin(d_up)
    cos_el = np.cos(el)
    sin_az = np.sin(az)

    # Woodworth ITD split half-half about the head-centre arrival.
    itd_sec = ITD_MAX_SEC * sin_az * cos_el
    half = itd_sec / 2.0
    left_off = np.round(+half * fs).astype(np.int64)
    right_off = np.round(-half * fs).astype(np.int64)

    # IID: same smooth mapping as SphericalHead._shadow_gain.
    dot_r = sin_az * cos_el                               # +1 = source at right
    t_right = (dot_r + 1.0) / 2.0
    t_left = (-dot_r + 1.0) / 2.0
    gmin = head.min_contralateral_gain
    right_gain = gmin + (1.0 - gmin) * t_right
    left_gain = gmin + (1.0 - gmin) * t_left

    base = np.round(distances / SPEED_OF_SOUND * fs).astype(np.int64)
    l_idx = base + left_off
    r_idx = base + right_off

    lm = (l_idx >= 0) & (l_idx < n)
    rm = (r_idx >= 0) & (r_idx < n)
    np.add.at(left, l_idx[lm], (amps * left_gain)[lm])
    np.add.at(right, r_idx[rm], (amps * right_gain)[rm])
    return left, right
