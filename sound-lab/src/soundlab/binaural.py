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

from .room import SPEED_OF_SOUND, Room, iter_image_sources


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

    Iterates the same image sources the mono path uses, then splits each
    arrival across the two ears via ``head.per_ear_offsets``.
    """
    n = int(duration * fs)
    left = np.zeros(n, dtype=np.float64)
    right = np.zeros(n, dtype=np.float64)
    listener_arr = np.asarray(listener, dtype=float)

    for img in iter_image_sources(room, source, listener):
        direction = (img.position - listener_arr) / img.distance
        az, el = world_to_listener_angles(direction, listener_forward)
        (l_off, l_gain), (r_off, r_gain) = head.per_ear_offsets(az, el, fs)
        base = int(round(img.distance / SPEED_OF_SOUND * fs))
        l_idx = base + l_off
        r_idx = base + r_off
        if 0 <= l_idx < n:
            left[l_idx] += img.amplitude * l_gain
        if 0 <= r_idx < n:
            right[r_idx] += img.amplitude * r_gain

    return left, right
