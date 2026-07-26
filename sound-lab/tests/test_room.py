import numpy as np
import pytest

from soundlab.room import SPEED_OF_SOUND, Room, shoebox_ir


FS = 48_000


def _first_impulse_sample(ir: np.ndarray) -> int:
    return int(np.argmax(np.abs(ir) > 0))


def test_direct_arrival_delay_matches_distance():
    # 3.43 m ~= exactly 480 samples at 48 kHz (3.43 / 343 * 48000).
    room = Room(dims=(20.0, 20.0, 5.0), absorption=1.0, max_order=0)
    ir = shoebox_ir(room, source=(10.0, 10.0, 2.5), listener=(10.0, 13.43, 2.5), fs=FS)
    expected = int(round(3.43 / SPEED_OF_SOUND * FS))
    assert _first_impulse_sample(ir) == expected


def test_direct_arrival_amplitude_falls_as_one_over_distance():
    # With max_order=0 and no walls in play, only the direct-source term
    # survives — its amplitude should be exactly 1/distance.
    room = Room(dims=(30.0, 30.0, 5.0), absorption=1.0, max_order=0)
    for dist in (1.0, 2.0, 5.0, 10.0):
        ir = shoebox_ir(
            room,
            source=(15.0, 15.0, 2.5),
            listener=(15.0, 15.0 + dist, 2.5),
            fs=FS,
        )
        peak = float(np.max(np.abs(ir)))
        assert peak == pytest.approx(1.0 / dist, rel=1e-6)


def test_more_absorption_means_less_energy():
    src = (2.0, 2.0, 1.5)
    lis = (4.0, 3.0, 1.5)
    room_live = Room(dims=(6.0, 4.0, 3.0), absorption=0.05, max_order=8)
    room_dead = Room(dims=(6.0, 4.0, 3.0), absorption=0.9, max_order=8)
    energy_live = float(np.sum(shoebox_ir(room_live, src, lis, FS) ** 2))
    energy_dead = float(np.sum(shoebox_ir(room_dead, src, lis, FS) ** 2))
    assert energy_live > energy_dead


def test_rejects_source_outside_room():
    room = Room(dims=(4.0, 4.0, 3.0))
    with pytest.raises(ValueError, match="source"):
        shoebox_ir(room, source=(5.0, 2.0, 1.5), listener=(2.0, 2.0, 1.5), fs=FS)


def test_rejects_invalid_room():
    with pytest.raises(ValueError, match="dims"):
        Room(dims=(0.0, 4.0, 3.0))
    with pytest.raises(ValueError, match="absorption"):
        Room(dims=(4.0, 4.0, 3.0), absorption=1.5)
