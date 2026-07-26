import numpy as np
import pytest

from soundlab.trajectory import Keyframe, Trajectory


def test_single_keyframe_is_static():
    traj = Trajectory(keyframes=(Keyframe(0.0, (1.0, 2.0, 3.0)),))
    assert traj.position_at(0.0) == (1.0, 2.0, 3.0)
    assert traj.position_at(-5.0) == (1.0, 2.0, 3.0)   # clamped before
    assert traj.position_at(100.0) == (1.0, 2.0, 3.0)  # clamped after


def test_linear_interpolation_between_keyframes():
    traj = Trajectory((
        Keyframe(0.0, (0.0, 0.0, 0.0)),
        Keyframe(1.0, (10.0, 20.0, -4.0)),
    ))
    x, y, z = traj.position_at(0.25)
    assert x == pytest.approx(2.5)
    assert y == pytest.approx(5.0)
    assert z == pytest.approx(-1.0)


def test_clamps_before_first_and_after_last():
    traj = Trajectory((
        Keyframe(1.0, (1.0, 0.0, 0.0)),
        Keyframe(3.0, (5.0, 0.0, 0.0)),
    ))
    assert traj.position_at(0.0) == (1.0, 0.0, 0.0)
    assert traj.position_at(10.0) == (5.0, 0.0, 0.0)


def test_rejects_empty_keyframes():
    with pytest.raises(ValueError, match="at least one keyframe"):
        Trajectory(keyframes=())


def test_rejects_unsorted_keyframes():
    with pytest.raises(ValueError, match="sorted by t"):
        Trajectory((
            Keyframe(1.0, (0.0, 0.0, 0.0)),
            Keyframe(0.5, (0.0, 0.0, 0.0)),
        ))


def test_circle_xy_closes_and_stays_at_radius():
    traj = Trajectory.circle_xy(
        center_xy=(5.0, 5.0), radius=2.0, height=3.0,
        duration=4.0, n_points=16,
    )
    first, last = traj.keyframes[0].position, traj.keyframes[-1].position
    # First and last keyframes should coincide (loop closes).
    for a, b in zip(first, last):
        assert a == pytest.approx(b, abs=1e-9)
    # All keyframes at fixed z and constant distance from centre.
    for kf in traj.keyframes:
        x, y, z = kf.position
        assert z == pytest.approx(3.0)
        assert np.hypot(x - 5.0, y - 5.0) == pytest.approx(2.0, abs=1e-9)


def test_circle_xy_hits_full_duration():
    traj = Trajectory.circle_xy((0.0, 0.0), 1.0, 0.0, duration=5.0, n_points=8)
    assert traj.keyframes[-1].t == pytest.approx(5.0)
