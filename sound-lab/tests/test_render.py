import numpy as np
import pytest

from soundlab.render import PositionedStem, render_at_seat
from soundlab.room import SPEED_OF_SOUND, Room


FS = 48_000


def _click(n_samples: int = 8) -> np.ndarray:
    x = np.zeros(n_samples, dtype=np.float64)
    x[0] = 1.0
    return x


def test_click_arrives_at_expected_delay():
    # Direct-path only room (no reflections). A click should show up at the
    # listener delayed by distance/c, scaled by 1/distance.
    room = Room(dims=(20.0, 20.0, 5.0), absorption=1.0, max_order=0)
    stem = PositionedStem(label="click", audio=_click(), position=(10.0, 10.0, 2.5))
    out = render_at_seat([stem], room, listener=(10.0, 13.43, 2.5), fs=FS)

    expected_delay = int(round(3.43 / SPEED_OF_SOUND * FS))
    assert int(np.argmax(np.abs(out))) == expected_delay
    assert float(np.max(np.abs(out))) == pytest.approx(1.0 / 3.43, rel=1e-6)


def test_two_stems_sum_linearly():
    room = Room(dims=(20.0, 20.0, 5.0), absorption=1.0, max_order=0)
    listener = (10.0, 15.0, 2.5)
    a = PositionedStem("a", _click(), position=(10.0, 12.0, 2.5))   # 3.0 m
    b = PositionedStem("b", _click(), position=(10.0, 18.0, 2.5))   # 3.0 m

    only_a = render_at_seat([a], room, listener, FS)
    only_b = render_at_seat([b], room, listener, FS)
    both = render_at_seat([a, b], room, listener, FS)

    n = min(len(only_a), len(only_b), len(both))
    assert np.allclose(both[:n], only_a[:n] + only_b[:n])


def test_rejects_empty_stem_list():
    room = Room(dims=(4.0, 4.0, 3.0))
    with pytest.raises(ValueError, match="at least one stem"):
        render_at_seat([], room, (2.0, 2.0, 1.5), FS)


def test_rejects_stereo_stem():
    stereo = np.zeros((100, 2))
    with pytest.raises(ValueError, match="mono"):
        PositionedStem("bad", stereo, position=(1.0, 1.0, 1.0))
