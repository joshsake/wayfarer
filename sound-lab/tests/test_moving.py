import numpy as np
import pytest

from soundlab.binaural import SphericalHead
from soundlab.render import (
    MovingStem,
    PositionedStem,
    render_at_seat,
    render_moving_at_seat,
    render_moving_at_seat_binaural,
)
from soundlab.room import Room
from soundlab.trajectory import Keyframe, Trajectory


FS = 48_000
FORWARD_Y = (0.0, 1.0, 0.0)


def _big_dead_room() -> Room:
    return Room(dims=(20.0, 20.0, 5.0), absorption=1.0, max_order=0)


def _tone(freq: float, seconds: float, fs: int) -> np.ndarray:
    t = np.arange(int(seconds * fs)) / fs
    return 0.3 * np.sin(2 * np.pi * freq * t)


def test_moving_render_rejects_stereo_stem():
    stereo = np.zeros((100, 2))
    traj = Trajectory((Keyframe(0.0, (1.0, 1.0, 1.0)),))
    with pytest.raises(ValueError, match="mono"):
        MovingStem("bad", stereo, traj)


def test_static_trajectory_matches_static_render_in_middle():
    """A trajectory with a single keyframe should render identically to the
    static path — check the middle of the signal where overlap-add is exact.
    """
    room = _big_dead_room()
    pos = (10.0, 15.0, 2.5)
    audio = _tone(freq=440.0, seconds=0.5, fs=FS)   # short enough to run fast

    static = render_at_seat(
        [PositionedStem("s", audio, pos)], room, (10.0, 10.0, 2.5), FS,
        ir_duration=0.1,
    )
    moving = render_moving_at_seat(
        MovingStem("m", audio, Trajectory((Keyframe(0.0, pos),))),
        room, (10.0, 10.0, 2.5), FS, ir_duration=0.1, block_size=1024,
    )
    # Compare a middle window — first/last ~block_size samples get boundary
    # tapering that COLA doesn't fully cover.
    n = min(len(static), len(moving))
    mid_start = 2048
    mid_end = n - 2048
    assert np.allclose(static[mid_start:mid_end], moving[mid_start:mid_end],
                       atol=1e-6)


def test_moving_binaural_pans_right_to_left_over_time():
    """Source moves from the right side to the left side over the audio's
    duration; verify the early portion is louder on the right channel and
    the late portion is louder on the left.
    """
    room = _big_dead_room()
    listener = (10.0, 10.0, 2.5)
    duration = 1.0
    audio = _tone(freq=1000.0, seconds=duration, fs=FS)

    traj = Trajectory((
        Keyframe(0.0, (15.0, 10.0, 2.5)),   # to listener's right
        Keyframe(duration, (5.0, 10.0, 2.5)),  # to listener's left
    ))
    out = render_moving_at_seat_binaural(
        MovingStem("heli", audio, traj), room, listener, FORWARD_Y,
        SphericalHead(), FS, ir_duration=0.1, block_size=2048,
    )

    n = int(duration * FS)
    q = n // 4
    early = out[q : 2 * q]                 # roughly t=0.25..0.5s (still on right)
    late = out[2 * q : 3 * q]              # t=0.5..0.75s (moving through left)

    early_r_over_l_db = 20 * np.log10(
        np.sqrt(np.mean(early[:, 1] ** 2)) / np.sqrt(np.mean(early[:, 0] ** 2))
    )
    late_r_over_l_db = 20 * np.log10(
        np.sqrt(np.mean(late[:, 1] ** 2)) / np.sqrt(np.mean(late[:, 0] ** 2))
    )
    # Early: right ear should be louder → positive.
    assert early_r_over_l_db > 1.0
    # Late: left ear should be louder → negative.
    assert late_r_over_l_db < -1.0


def test_moving_output_length_matches_static_convention():
    room = _big_dead_room()
    audio = _tone(freq=440.0, seconds=0.3, fs=FS)
    stem = MovingStem(
        "s", audio,
        Trajectory((Keyframe(0.0, (10.0, 12.0, 2.5)),)),
    )
    out = render_moving_at_seat(stem, room, (10.0, 10.0, 2.5), FS,
                                ir_duration=0.2, block_size=1024)
    expected = len(audio) + int(0.2 * FS) - 1
    assert len(out) == expected
