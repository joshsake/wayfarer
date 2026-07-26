import numpy as np
import pytest

from soundlab.binaural import (
    ITD_MAX_SEC,
    SphericalHead,
    binaural_shoebox_ir,
    world_to_listener_angles,
)
from soundlab.render import PositionedStem, render_at_seat_binaural
from soundlab.room import Room


FS = 48_000
FORWARD_Y = (0.0, 1.0, 0.0)


# ---------------------------------------------------------------- angles ----

def test_angles_forward_is_origin():
    az, el = world_to_listener_angles((0.0, 1.0, 0.0), FORWARD_Y)
    assert az == pytest.approx(0.0, abs=1e-9)
    assert el == pytest.approx(0.0, abs=1e-9)


def test_angles_right_is_plus_ninety():
    az, el = world_to_listener_angles((1.0, 0.0, 0.0), FORWARD_Y)
    assert az == pytest.approx(90.0, abs=1e-9)
    assert el == pytest.approx(0.0, abs=1e-9)


def test_angles_left_is_minus_ninety():
    az, el = world_to_listener_angles((-1.0, 0.0, 0.0), FORWARD_Y)
    assert az == pytest.approx(-90.0, abs=1e-9)
    assert el == pytest.approx(0.0, abs=1e-9)


def test_angles_up_is_plus_ninety_elevation():
    _, el = world_to_listener_angles((0.0, 0.0, 1.0), FORWARD_Y)
    assert el == pytest.approx(90.0, abs=1e-9)


def test_angles_behind_is_plus_or_minus_180():
    az, _ = world_to_listener_angles((0.0, -1.0, 0.0), FORWARD_Y)
    assert abs(abs(az) - 180.0) < 1e-9


def test_angles_respect_alternate_forward():
    # Listener facing -y: their right is now -x.
    az, _ = world_to_listener_angles((-1.0, 0.0, 0.0), (0.0, -1.0, 0.0))
    assert az == pytest.approx(90.0, abs=1e-9)


# --------------------------------------------------------- spherical head ---

def test_head_front_source_is_symmetric():
    head = SphericalHead()
    (l_d, l_g), (r_d, r_g) = head.per_ear_offsets(azimuth_deg=0.0, elevation_deg=0.0, fs=FS)
    assert l_d == r_d == 0
    assert l_g == pytest.approx(r_g)


def test_head_right_source_leads_right_ear():
    head = SphericalHead()
    (l_d, l_g), (r_d, r_g) = head.per_ear_offsets(azimuth_deg=90.0, elevation_deg=0.0, fs=FS)
    assert r_d < 0 < l_d              # right ear leads, left lags
    assert r_g > l_g                  # right ear louder (near ear)
    assert r_g == pytest.approx(1.0)   # ipsilateral ear gets full gain
    # ITD magnitude at ±90° should be ~ITD_MAX_SEC (Woodworth peak)
    expected = int(round(ITD_MAX_SEC * FS / 2))
    assert abs(l_d - expected) <= 1
    assert abs(r_d + expected) <= 1


def test_head_left_source_mirrors_right():
    head = SphericalHead()
    (l90, r90) = head.per_ear_offsets(90.0, 0.0, FS)
    (l_minus, r_minus) = head.per_ear_offsets(-90.0, 0.0, FS)
    # Mirror: swap left and right.
    assert l_minus == r90
    assert r_minus == l90


def test_head_overhead_source_is_symmetric():
    head = SphericalHead()
    (l_d, l_g), (r_d, r_g) = head.per_ear_offsets(azimuth_deg=0.0, elevation_deg=90.0, fs=FS)
    assert l_d == r_d == 0
    assert l_g == pytest.approx(r_g)


# --------------------------------------------------------- room + binaural --

def _big_dead_room() -> Room:
    # Absorption=1.0, max_order=0 → only the direct arrival, no reflections.
    return Room(dims=(20.0, 20.0, 5.0), absorption=1.0, max_order=0)


def test_binaural_ir_front_source_is_symmetric():
    head = SphericalHead()
    left, right = binaural_shoebox_ir(
        _big_dead_room(),
        source=(10.0, 15.0, 2.5),      # directly in front of the listener
        listener=(10.0, 10.0, 2.5),
        listener_forward=FORWARD_Y,
        head=head,
        fs=FS,
    )
    assert np.allclose(left, right)


def test_binaural_ir_right_source_arrives_at_right_first():
    head = SphericalHead()
    left, right = binaural_shoebox_ir(
        _big_dead_room(),
        source=(15.0, 10.0, 2.5),      # directly to listener's right
        listener=(10.0, 10.0, 2.5),
        listener_forward=FORWARD_Y,
        head=head,
        fs=FS,
    )
    r_onset = int(np.argmax(np.abs(right)))
    l_onset = int(np.argmax(np.abs(left)))
    assert r_onset < l_onset
    assert float(np.max(np.abs(right))) > float(np.max(np.abs(left)))


def test_binaural_ir_left_source_mirrors_right_source():
    head = SphericalHead()
    right_source = binaural_shoebox_ir(
        _big_dead_room(), (15.0, 10.0, 2.5), (10.0, 10.0, 2.5), FORWARD_Y, head, FS,
    )
    left_source = binaural_shoebox_ir(
        _big_dead_room(), (5.0, 10.0, 2.5),  (10.0, 10.0, 2.5), FORWARD_Y, head, FS,
    )
    # Swapping the source across the median plane should swap the channels.
    assert np.allclose(right_source[0], left_source[1])
    assert np.allclose(right_source[1], left_source[0])


# ------------------------------------------------------- end-to-end render --

def _click(n: int = 8) -> np.ndarray:
    x = np.zeros(n, dtype=np.float64)
    x[0] = 1.0
    return x


def test_binaural_render_output_is_stereo():
    stem = PositionedStem("s", _click(), position=(10.0, 15.0, 2.5))
    out = render_at_seat_binaural(
        [stem], _big_dead_room(), (10.0, 10.0, 2.5), FORWARD_Y, SphericalHead(), FS,
    )
    assert out.ndim == 2 and out.shape[1] == 2


def test_binaural_render_pans_click_to_right_ear():
    stem = PositionedStem("s", _click(), position=(15.0, 10.0, 2.5))   # to the right
    out = render_at_seat_binaural(
        [stem], _big_dead_room(), (10.0, 10.0, 2.5), FORWARD_Y, SphericalHead(), FS,
    )
    left_peak = float(np.max(np.abs(out[:, 0])))
    right_peak = float(np.max(np.abs(out[:, 1])))
    assert right_peak > left_peak


def test_binaural_render_rejects_empty_stems():
    with pytest.raises(ValueError, match="at least one stem"):
        render_at_seat_binaural(
            [], _big_dead_room(), (10.0, 10.0, 2.5), FORWARD_Y, SphericalHead(), FS,
        )
