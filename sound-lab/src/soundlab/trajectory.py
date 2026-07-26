"""Time-varying source positions.

A ``Trajectory`` is a list of keyframes; positions between them are
linearly interpolated. Before the first keyframe the source is clamped
to the first position; after the last, to the last — so a trajectory
can be shorter than the audio and the source just "parks."
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Keyframe:
    t: float                                          # seconds
    position: tuple[float, float, float]              # metres


@dataclass(frozen=True)
class Trajectory:
    keyframes: tuple[Keyframe, ...]

    def __post_init__(self) -> None:
        if not self.keyframes:
            raise ValueError("trajectory needs at least one keyframe")
        for a, b in zip(self.keyframes, self.keyframes[1:]):
            if b.t < a.t:
                raise ValueError(
                    f"keyframes must be sorted by t; got {a.t} then {b.t}"
                )

    def position_at(self, t: float) -> tuple[float, float, float]:
        kfs = self.keyframes
        if t <= kfs[0].t:
            return kfs[0].position
        if t >= kfs[-1].t:
            return kfs[-1].position
        # Linear scan is fine — keyframe counts are small (dozens).
        for a, b in zip(kfs, kfs[1:]):
            if a.t <= t <= b.t:
                span = b.t - a.t
                if span == 0.0:
                    return a.position
                alpha = (t - a.t) / span
                return (
                    a.position[0] * (1 - alpha) + b.position[0] * alpha,
                    a.position[1] * (1 - alpha) + b.position[1] * alpha,
                    a.position[2] * (1 - alpha) + b.position[2] * alpha,
                )
        return kfs[-1].position   # unreachable when kfs is sorted

    @classmethod
    def circle_xy(
        cls,
        center_xy: tuple[float, float],
        radius: float,
        height: float,
        duration: float,
        *,
        n_points: int = 32,
        start_angle_rad: float = 0.0,
        clockwise: bool = False,
    ) -> "Trajectory":
        """One full loop in the horizontal (x, y) plane at fixed ``height``.

        ``n_points`` keyframes evenly spaced in time over ``duration``, with
        the last keyframe landing exactly at ``2π`` so the loop closes.
        """
        if n_points < 2:
            raise ValueError(f"n_points must be >= 2, got {n_points}")
        sign = -1.0 if clockwise else 1.0
        cx, cy = center_xy
        kfs = []
        for i in range(n_points):
            angle = start_angle_rad + sign * 2.0 * np.pi * i / (n_points - 1)
            x = cx + radius * float(np.cos(angle))
            y = cy + radius * float(np.sin(angle))
            t = duration * i / (n_points - 1)
            kfs.append(Keyframe(t=t, position=(x, y, height)))
        return cls(keyframes=tuple(kfs))
