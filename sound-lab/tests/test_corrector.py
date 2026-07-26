import numpy as np
import pytest
from scipy.signal import butter, lfilter

from soundlab.corrector import (
    apply_correction,
    build_correction_filter,
    derive_correction,
    smooth_fractional_octave,
    spectrum_of,
)


FS = 48_000


def _white_noise(seconds: float = 4.0, fs: int = FS, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.standard_normal(int(seconds * fs))


# ------------------------------------------------------------------ spectrum

def test_spectrum_of_rejects_stereo():
    with pytest.raises(ValueError, match="mono"):
        spectrum_of(np.zeros((100, 2)), FS)


def test_spectrum_peak_lands_at_sine_frequency():
    freq = 1000.0
    t = np.arange(FS) / FS
    tone = 0.5 * np.sin(2 * np.pi * freq * t)
    freqs, mag = spectrum_of(tone, FS)
    peak_bin = int(np.argmax(mag))
    assert abs(freqs[peak_bin] - freq) < FS / 4096   # within one bin


# --------------------------------------------------------------- smoothing

def test_smoothing_flattens_a_narrow_spike():
    freqs = np.linspace(0, FS / 2, 1024)
    mag = np.ones_like(freqs)
    mag[500] = 100.0   # single-bin spike
    smoothed = smooth_fractional_octave(freqs, mag, octaves=1.0)
    # Smoothed value at the spike should be much lower than the raw spike.
    assert smoothed[500] < mag[500] / 5
    # Smoothed value should be higher than 1 (spike energy spread nearby).
    assert smoothed[500] > 1.0


def test_smoothing_zero_octaves_is_identity():
    freqs = np.linspace(0, FS / 2, 1024)
    mag = np.abs(np.random.default_rng(0).standard_normal(1024))
    smoothed = smooth_fractional_octave(freqs, mag, octaves=0.0)
    assert np.array_equal(smoothed, mag)


# ------------------------------------------------------------- derivation

def test_derive_identity_input_gives_flat_gain():
    x = _white_noise()
    _, gain = derive_correction(x, x, FS)
    # Every bin should be ~1.0 (0 dB).
    assert np.allclose(gain, 1.0, atol=1e-6)


def test_derive_clamps_gain_to_specified_range():
    # Reference is 100x larger than measured — un-clamped gain would be ~100 (+40 dB).
    ref = _white_noise() * 100.0
    meas = _white_noise(seed=1)
    _, gain = derive_correction(ref, meas, FS, clamp_db=6.0)
    max_db = 20 * np.log10(gain.max())
    assert max_db <= 6.0 + 1e-6


def test_derive_level_match_ignores_overall_loudness_difference():
    # Same shape, different level: without level_match the correction is a
    # constant boost; with level_match it comes out ~flat at 0 dB.
    x = _white_noise()
    ref = x * 4.0                   # +12 dB louder
    _, gain_raw = derive_correction(ref, x, FS)
    _, gain_matched = derive_correction(ref, x, FS, level_match=True)
    assert np.mean(20 * np.log10(gain_raw)) > 10.0        # ~+12 dB across the band
    assert abs(np.mean(20 * np.log10(gain_matched))) < 1.0  # ~0 dB


def test_derive_cuts_bins_where_reference_is_quieter():
    # Measured is white noise; reference is the same noise low-passed at 2 kHz.
    # Correction should be ~0 dB in the passband and strongly negative in
    # the stopband (the reference has no energy there).
    meas = _white_noise()
    b, a = butter(4, 2000 / (FS / 2), btype="low")
    ref = lfilter(b, a, meas)
    freqs, gain = derive_correction(ref, meas, FS)
    gain_db = 20 * np.log10(gain)
    passband_idx = int(np.argmin(np.abs(freqs - 500)))
    stopband_idx = int(np.argmin(np.abs(freqs - 10_000)))
    assert abs(gain_db[passband_idx]) < 1.5     # unchanged in passband
    assert gain_db[stopband_idx] < -6.0         # cut hard in the stopband


# ------------------------------------------------- filter design + apply

def test_build_filter_rejects_even_taps():
    with pytest.raises(ValueError, match="odd for linear phase"):
        build_correction_filter(np.array([0.0, 24000.0]), np.array([1.0, 1.0]), FS, n_taps=1024)


def test_apply_correction_stereo_uses_per_ear_taps():
    n_taps = 63
    taps_l = np.zeros(n_taps); taps_l[n_taps // 2] = 1.0        # identity
    taps_r = np.zeros(n_taps); taps_r[n_taps // 2] = 0.5        # -6 dB
    per_ear = np.stack([taps_l, taps_r], axis=1)
    audio = np.stack([_white_noise(), _white_noise(seed=2)], axis=1)
    out = apply_correction(audio, per_ear)
    # Right ear should be attenuated ~6 dB in RMS relative to input's right.
    ratio_db = 20 * np.log10(np.sqrt(np.mean(out[:, 1] ** 2))
                             / np.sqrt(np.mean(audio[:, 1] ** 2)))
    assert -7.0 < ratio_db < -5.0


def test_end_to_end_correction_moves_spectrum_toward_reference():
    """Boost bass in reference vs. measured; after correction, measured's
    spectrum in the bass band should be closer to reference than raw.
    """
    meas = _white_noise(seconds=6.0)
    b, a = butter(4, 200 / (FS / 2), btype="low")
    ref = meas + 3.0 * lfilter(b, a, meas)                       # bass-boosted target

    freqs, gain = derive_correction(ref, meas, FS)
    taps = build_correction_filter(freqs, gain, FS, n_taps=1023)
    corrected = apply_correction(meas, taps)

    # Distance in dB between measured/corrected spectrum and reference,
    # restricted to the low-frequency band where the boost lives.
    _, ref_mag = spectrum_of(ref, FS)
    _, meas_mag = spectrum_of(meas, FS)
    _, corr_mag = spectrum_of(corrected, FS)
    band = (freqs >= 40) & (freqs <= 300)
    err_before = np.mean(np.abs(np.log10(meas_mag[band]) - np.log10(ref_mag[band])))
    err_after = np.mean(np.abs(np.log10(corr_mag[band]) - np.log10(ref_mag[band])))
    assert err_after < err_before
