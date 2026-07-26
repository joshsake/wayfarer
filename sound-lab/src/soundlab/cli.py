"""Command-line entry: files in, wav out.

Only I/O and arg parsing live here — the DSP is in :mod:`soundlab.render`
and :mod:`soundlab.room` so it stays testable.
"""

from __future__ import annotations

import argparse
import sys

from .io import read_mono_wav, write_wav
from .render import PositionedStem, render_at_seat
from .room import Room


def _parse_vec3(text: str, name: str) -> tuple[float, float, float]:
    parts = text.split(",")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(f"{name} must be x,y,z, got {text!r}")
    try:
        x, y, z = (float(p) for p in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{name} components must be numbers: {exc}")
    return x, y, z


def _parse_stem_arg(text: str) -> tuple[str, str, tuple[float, float, float]]:
    parts = text.split(":")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(
            f"--stem must be label:path:x,y,z, got {text!r}"
        )
    label, path, pos_text = parts
    return label, path, _parse_vec3(pos_text, f"stem {label!r} position")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="soundlab", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    render = sub.add_parser("render", help="render positioned stems at a seat")
    render.add_argument(
        "--stem", action="append", required=True, type=_parse_stem_arg,
        help="label:path:x,y,z  (repeat for each stem)",
    )
    render.add_argument("--room", required=True, type=lambda t: _parse_vec3(t, "--room"))
    render.add_argument("--seat", required=True, type=lambda t: _parse_vec3(t, "--seat"))
    render.add_argument("--absorption", type=float, default=0.3)
    render.add_argument("--max-order", type=int, default=10)
    render.add_argument("--ir-duration", type=float, default=1.0)
    render.add_argument("--out", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.cmd == "render":
        stems = []
        fs: int | None = None
        for label, path, pos in args.stem:
            audio, stem_fs = read_mono_wav(path)
            if fs is None:
                fs = stem_fs
            elif stem_fs != fs:
                print(
                    f"error: stem {label!r} is {stem_fs} Hz but earlier stems are {fs} Hz",
                    file=sys.stderr,
                )
                return 2
            stems.append(PositionedStem(label=label, audio=audio, position=pos))

        room = Room(dims=args.room, absorption=args.absorption, max_order=args.max_order)
        assert fs is not None
        out = render_at_seat(stems, room, args.seat, fs, ir_duration=args.ir_duration)
        write_wav(args.out, out, fs)
        print(f"wrote {args.out}  ({len(out)} samples @ {fs} Hz)")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
