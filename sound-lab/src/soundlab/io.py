"""Wav read/write and normalisation. Thin wrapper over soundfile."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


def read_mono_wav(path: str | Path) -> tuple[np.ndarray, int]:
    """Read a wav, downmix to mono by averaging channels, return (audio, fs)."""
    audio, fs = sf.read(str(path), always_2d=True)
    mono = audio.mean(axis=1).astype(np.float64)
    return mono, fs


def write_wav(path: str | Path, audio: np.ndarray, fs: int, *, normalise: bool = True) -> None:
    """Write float audio to wav. When ``normalise``, peak-scale to -1 dBFS."""
    out = audio
    if normalise:
        peak = float(np.max(np.abs(out)))
        if peak > 0:
            out = out * (10 ** (-1.0 / 20.0) / peak)
    sf.write(str(path), out.astype(np.float32), fs)
