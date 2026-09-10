#!/usr/bin/env python3
"""Reject unintended Struder extrusion cycling in Dobot Lua programs."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ALLOW_MARKER = "ALLOW_EXTRUSION_CYCLING: true"


def validate_source(source: str) -> list[str]:
    """Return invariant violations; extrusion cycling is forbidden by default."""
    if ALLOW_MARKER in source:
        return []

    pen_on_count = len(re.findall(r"\bPenOn\s*\(", source))
    pen_off_count = len(re.findall(r"\bPenOff\s*\(", source))
    direct_off_count = len(
        re.findall(r"\bDO\s*\(\s*PEN_DO\s*,\s*0\s*\)", source)
    )

    errors: list[str] = []
    if pen_on_count != 1:
        errors.append(
            f"expected exactly one PenOn() call, found {pen_on_count}"
        )
    if pen_off_count != 1:
        errors.append(
            "expected exactly one initial PenOff() call; "
            f"found {pen_off_count}"
        )
    if direct_off_count > 1:
        errors.append(
            "expected at most one direct final extruder-off command; "
            f"found {direct_off_count}"
        )

    return errors


def validate_file(path: Path) -> list[str]:
    return validate_source(path.read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: validate_struder_lua.py <src.lua> [...]", file=sys.stderr)
        return 2

    failed = False
    for name in argv[1:]:
        path = Path(name)
        errors = validate_file(path)
        for error in errors:
            print(f"{path}: {error}", file=sys.stderr)
        failed = failed or bool(errors)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
