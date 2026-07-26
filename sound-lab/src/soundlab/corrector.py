"""Derive a per-ear EQ that pulls a room-rendered signal back toward a
headphone-like reference.

The reference is usually the *same* binaural render but with the room set
anechoic (``absorption=1.0, max_order=0``) — same seat, same head, no
reflections. The delta between the two spectra is the room's contribution;
inverting it (with smoothing and gain limits) gives a correction filter.

What this CAN do:
  - restore tonal balance lost to sub roll-off, seat-to-speaker distance,
    and modal peaks
  - do it per-ear so off-axis seats can get asymmetric correction

What this can NOT do:
  - add bass frequencies the source never contained (inverting a null with
    a huge boost just amplifies noise — the ``clamp_db`` guard exists for
    that)
  - restore transient timing eaten by long reverb
  - reproduce near-field / tactile bass — that's transducers, not filters
"""

from __future__ import annotations

import numpy as np
from scipy.signal import firwin2, fftconvolve, welch


DEFAULT_NPERSEG = 4096
DEFAULT_SMOOTHING_OCTAVES = 1.0 / 3.0
DEFAULT_CLAMP_DB = 12.0
DEFAULT_N_TAPS = 1023                                       # linear-phase FIR


def spectrum_of(audio: np.ndarray, fs: int, nperseg: int = DEFAULT_NPERSEG
                 ) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(frequencies, magnitude)`` via Welch's method.

    ``magnitude`` is sqrt(PSD) — an amplitude estimate whose ratio with
    another spectrum is the desired correction gain.
    """
    if audio.ndim != 1:
        raise ValueError(f"spectrum_of expects mono audio, got shape {audio.shape}")
    freqs, psd = welch(audio, fs=fs, nperseg=min(nperseg, len(audio)))
    return freqs, np.sqrt(np.maximum(psd, 0.0) + 1e-20)


def smooth_fractional_octave(
    freqs: np.ndarray,
    mag: np.ndarray,
    octaves: float,
) -> np.ndarray:
    """Rolling geometric-mean-ish smoothing over ``octaves`` fractional bands.

    Each output bin averages the input bins whose frequency lies within
    ``[f / 2^(octaves/2), f * 2^(octaves/2)]``. Bin 0 (DC) is passed
    through unchanged since it has no log-frequency neighbours.
    """
    if octaves <= 0:
        return mag.copy()
    factor = 2.0 ** (octaves / 2.0)
    out = np.zeros_like(mag)
    for i, f in enumerate(freqs):
        if f <= 0.0:
            out[i] = mag[i]
            continue
        lo, hi = f / factor, f * factor
        mask = (freqs >= lo) & (freqs <= hi)
        out[i] = float(np.mean(mag[mask])) if mask.any() else mag[i]
    return out


def derive_correction(
    reference: np.ndarray,
    measured: np.ndarray,
    fs: int,
    *,
    nperseg: int = DEFAULT_NPERSEG,
    smoothing_octaves: float = DEFAULT_SMOOTHING_OCTAVES,
    clamp_db: float = DEFAULT_CLAMP_DB,
    level_match: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(frequencies, gain_linear)`` mapping ``measured`` → ``reference``.

    Both signals must be mono; run per-ear at the call site for stereo.

    When ``level_match`` is True, ``measured``'s spectrum is scaled so its
    total energy matches ``reference`` before the ratio is taken. Use this
    when the reference and measured differ in absolute level for reasons
    the corrector shouldn't try to fix (e.g. seat-to-speaker distance): the
    resulting gain curve describes spectral **shape**, not loudness.
    """
    freqs, ref_mag = spectrum_of(reference, fs, nperseg)
    _, meas_mag = spectrum_of(measured, fs, nperseg)

    if level_match:
        ref_energy = float(np.sqrt(np.sum(ref_mag ** 2)))
        meas_energy = float(np.sqrt(np.sum(meas_mag ** 2)))
        if meas_energy > 0:
            meas_mag = meas_mag * (ref_energy / meas_energy)

    raw_gain = ref_mag / np.maximum(meas_mag, 1e-10)
    smoothed = smooth_fractional_octave(freqs, raw_gain, smoothing_octaves)

    gain_db = 20.0 * np.log10(np.maximum(smoothed, 1e-10))
    gain_db = np.clip(gain_db, -clamp_db, +clamp_db)
    return freqs, 10.0 ** (gain_db / 20.0)


def build_correction_filter(
    freqs: np.ndarray,
    gain_linear: np.ndarray,
    fs: int,
    n_taps: int = DEFAULT_N_TAPS,
) -> np.ndarray:
    """Design a linear-phase FIR whose magnitude response matches
    ``gain_linear`` at ``freqs``. ``n_taps`` must be odd for the filter
    to have exactly linear phase.
    """
    if n_taps % 2 == 0:
        raise ValueError(f"n_taps must be odd for linear phase, got {n_taps}")
    nyquist = fs / 2.0
    normalised = freqs / nyquist
    # firwin2 requires the frequency grid to include 0 and 1.
    if normalised[0] > 0.0:
        normalised = np.concatenate([[0.0], normalised])
        gain_linear = np.concatenate([[gain_linear[0]], gain_linear])
    if normalised[-1] < 1.0:
        normalised = np.concatenate([normalised, [1.0]])
        gain_linear = np.concatenate([gain_linear, [gain_linear[-1]]])
    return firwin2(n_taps, normalised, gain_linear)


def apply_correction(audio: np.ndarray, taps: np.ndarray) -> np.ndarray:
    """Convolve ``audio`` with ``taps`` (mono FIR). Preserves input length.

    For stereo input, apply per-channel — either with the same taps or with
    a ``(n_taps, 2)`` array carrying per-ear taps.
    """
    if audio.ndim == 1:
        return fftconvolve(audio, taps, mode="same")
    if taps.ndim == 1:
        return np.stack(
            [fftconvolve(audio[:, c], taps, mode="same") for c in range(audio.shape[1])],
            axis=1,
        )
    if taps.shape[1] != audio.shape[1]:
        raise ValueError(
            f"per-channel taps shape {taps.shape} incompatible with audio {audio.shape}"
        )
    return np.stack(
        [fftconvolve(audio[:, c], taps[:, c], mode="same") for c in range(audio.shape[1])],
        axis=1,
    )
