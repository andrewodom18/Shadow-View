#!/usr/bin/env python3
"""Run the project checks used before handing off Shadow View changes."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_APP_ROOT = PROJECT_ROOT / "web_app"


def run_check(label: str, command: list[str], cwd: Path = PROJECT_ROOT) -> int:
    print(f"\n== {label} ==", flush=True)
    completed = subprocess.run(command, cwd=cwd, check=False)
    return completed.returncode


def main() -> int:
    checks = [
        (
            "Python unit tests",
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-q"],
            PROJECT_ROOT,
        ),
        ("Web smoke test", ["npm", "test"], WEB_APP_ROOT),
        ("Web production build", ["npm", "run", "build"], WEB_APP_ROOT),
        ("Git whitespace check", ["git", "diff", "--check"], PROJECT_ROOT),
    ]

    failed = False
    for label, command, cwd in checks:
        if run_check(label, command, cwd) != 0:
            failed = True

    if failed:
        print("\nOne or more checks failed.")
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
